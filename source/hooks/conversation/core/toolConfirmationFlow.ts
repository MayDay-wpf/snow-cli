import type {ToolCall} from '../../../utils/execution/toolExecutor.js';
import type {ConfirmationResult} from '../../../ui/components/tools/ToolConfirmation.js';
import type {Message} from '../../../ui/components/chat/MessageList.js';
import {filterToolsBySensitivity} from '../../../utils/execution/yoloPermissionChecker.js';
import {connectionManager} from '../../../utils/connection/ConnectionManager.js';
import {handleToolRejection} from './toolRejectionHandler.js';

export type ToolConfirmationFlowOptions = {
	receivedToolCalls: ToolCall[];
	isToolAutoApproved: (toolName: string) => boolean;
	sessionApprovedTools: Set<string>;
	yoloMode: boolean;
	requestToolConfirmation: (
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	) => Promise<ConfirmationResult>;
	addMultipleToAlwaysApproved: (toolNames: string[]) => void;
	conversationMessages: any[];
	accumulatedUsage: any;
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setIsStreaming?: (isStreaming: boolean) => void;
	freeEncoder: () => void;
	abortSignal?: AbortSignal;
};

export type ToolConfirmationFlowResult =
	| {type: 'approved'; approvedTools: ToolCall[]}
	| {type: 'rejected'; shouldContinue: boolean; accumulatedUsage: any};

async function notifyAndRequestConfirmation(
	tools: ToolCall[],
	requestToolConfirmation: ToolConfirmationFlowOptions['requestToolConfirmation'],
	abortSignal?: AbortSignal,
): Promise<ConfirmationResult> {
	const firstTool = tools[0]!;
	const allTools = tools.length > 1 ? tools : undefined;

	if (connectionManager.isConnected()) {
		await connectionManager.notifyToolConfirmationNeeded(
			firstTool.function.name,
			firstTool.function.arguments,
			firstTool.id,
			allTools?.map(t => ({
				name: t.function.name,
				arguments: t.function.arguments,
			})),
		);
	}

	// Check abort before showing confirmation
	if (abortSignal?.aborted) {
		return 'reject';
	}

	// Race between confirmation and abort signal
	return Promise.race([
		requestToolConfirmation(firstTool, undefined, allTools),
		new Promise<never>((_, reject) => {
			if (abortSignal) {
				const onAbort = () => reject(new Error('Tool confirmation aborted'));
				if (abortSignal.aborted) {
					onAbort();
				} else {
					abortSignal.addEventListener('abort', onAbort, {once: true});
				}
			}
		}),
	]).catch(error => {
		if (error.message === 'Tool confirmation aborted') {
			return 'reject';
		}
		throw error;
	});
}

function isRejection(confirmation: ConfirmationResult): boolean {
	return (
		confirmation === 'reject' ||
		(typeof confirmation === 'object' &&
			confirmation.type === 'reject_with_reply')
	);
}

/**
 * Classify tool calls into auto-approved and needs-confirmation buckets,
 * then resolve confirmation with the user (or auto-approve in YOLO mode).
 */
export async function resolveToolConfirmations(
	options: ToolConfirmationFlowOptions,
): Promise<ToolConfirmationFlowResult> {
	const {
		receivedToolCalls,
		isToolAutoApproved,
		sessionApprovedTools,
		yoloMode,
		requestToolConfirmation,
		addMultipleToAlwaysApproved,
		abortSignal,
	} = options;

	// Check abort at the start
	if (abortSignal?.aborted) {
		return {
			type: 'rejected',
			shouldContinue: false,
			accumulatedUsage: options.accumulatedUsage,
		};
	}

	// Classify each tool call
	const toolsNeedingConfirmation: ToolCall[] = [];
	const autoApprovedTools: ToolCall[] = [];

	for (const toolCall of receivedToolCalls) {
		const isApproved =
			isToolAutoApproved(toolCall.function.name) ||
			sessionApprovedTools.has(toolCall.function.name);

		let isSensitiveCommand = false;
		if (toolCall.function.name === 'terminal-execute') {
			try {
				const args = JSON.parse(toolCall.function.arguments);
				const {isSensitiveCommand: checkSensitiveCommand} = await import(
					'../../../utils/execution/sensitiveCommandManager.js'
				).then(m => ({isSensitiveCommand: m.isSensitiveCommand}));
				const sensitiveCheck = checkSensitiveCommand(args.command);
				isSensitiveCommand = sensitiveCheck.isSensitive;
			} catch {
				// treat as normal command
			}
		}

		if (isSensitiveCommand) {
			toolsNeedingConfirmation.push(toolCall);
		} else if (isApproved) {
			autoApprovedTools.push(toolCall);
		} else {
			toolsNeedingConfirmation.push(toolCall);
		}
	}

	const approvedTools: ToolCall[] = [...autoApprovedTools];

	// YOLO mode: auto-approve non-sensitive, confirm sensitive only
	if (yoloMode) {
		const {sensitiveTools, nonSensitiveTools} = await filterToolsBySensitivity(
			toolsNeedingConfirmation,
			yoloMode,
		);

		approvedTools.push(...nonSensitiveTools);

		if (sensitiveTools.length > 0) {
			const confirmation = await notifyAndRequestConfirmation(
				sensitiveTools,
				requestToolConfirmation,
				abortSignal,
			);

			if (isRejection(confirmation)) {
				const result = await handleToolRejection({
					confirmation,
					toolsNeedingConfirmation: sensitiveTools,
					autoApprovedTools,
					nonSensitiveTools,
					conversationMessages: options.conversationMessages,
					accumulatedUsage: options.accumulatedUsage,
					saveMessage: options.saveMessage,
					setMessages: options.setMessages,
					setIsStreaming: options.setIsStreaming,
					freeEncoder: options.freeEncoder,
				});
				return {
					type: 'rejected',
					shouldContinue: result.shouldContinue,
					accumulatedUsage: result.accumulatedUsage,
				};
			}

			approvedTools.push(...sensitiveTools);
		}
	} else if (toolsNeedingConfirmation.length > 0) {
		const confirmation = await notifyAndRequestConfirmation(
			toolsNeedingConfirmation,
			requestToolConfirmation,
			abortSignal,
		);

		if (isRejection(confirmation)) {
			const result = await handleToolRejection({
				confirmation,
				toolsNeedingConfirmation,
				autoApprovedTools,
				conversationMessages: options.conversationMessages,
				accumulatedUsage: options.accumulatedUsage,
				saveMessage: options.saveMessage,
				setMessages: options.setMessages,
				setIsStreaming: options.setIsStreaming,
				freeEncoder: options.freeEncoder,
			});
			return {
				type: 'rejected',
				shouldContinue: result.shouldContinue,
				accumulatedUsage: result.accumulatedUsage,
			};
		}

		if (confirmation === 'approve_always') {
			const toolNamesToAdd = toolsNeedingConfirmation.map(t => t.function.name);
			addMultipleToAlwaysApproved(toolNamesToAdd);
			toolNamesToAdd.forEach(name => sessionApprovedTools.add(name));
		}

		approvedTools.push(...toolsNeedingConfirmation);
	}

	return {type: 'approved', approvedTools};
}
