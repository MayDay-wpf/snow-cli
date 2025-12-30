import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {ConfirmationResult} from '../../../ui/components/tools/ToolConfirmation.js';
import type {ToolCall} from '../../../utils/execution/toolExecutor.js';
import {formatToolCallMessage} from '../../../utils/ui/messageFormatter.js';

export type ToolRejectionResult = {
	shouldContinue: boolean;
	shouldEndSession: boolean;
	accumulatedUsage: any;
};

export type ToolRejectionHandlerOptions = {
	confirmation: ConfirmationResult;
	toolsNeedingConfirmation: ToolCall[];
	autoApprovedTools: ToolCall[];
	nonSensitiveTools?: ToolCall[];
	conversationMessages: any[];
	accumulatedUsage: any;
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setIsStreaming?: (isStreaming: boolean) => void;
	freeEncoder: () => void;
};

export async function handleToolRejection(
	options: ToolRejectionHandlerOptions,
): Promise<ToolRejectionResult> {
	const {
		confirmation,
		toolsNeedingConfirmation,
		autoApprovedTools,
		nonSensitiveTools = [],
		conversationMessages,
		accumulatedUsage,
		saveMessage,
		setMessages,
		setIsStreaming,
		freeEncoder,
	} = options;

	setMessages(prev => prev.filter(msg => !msg.toolPending));

	const rejectMessage =
		typeof confirmation === 'object'
			? `Tool execution rejected by user: ${confirmation.reason}`
			: 'Error: Tool execution rejected by user';

	const rejectedToolUIMessages: Message[] = [];

	for (const toolCall of toolsNeedingConfirmation) {
		const rejectionMessage = {
			role: 'tool' as const,
			tool_call_id: toolCall.id,
			content: rejectMessage,
			messageStatus: 'error' as const,
		};
		conversationMessages.push(rejectionMessage);
		saveMessage(rejectionMessage).catch(error => {
			console.error('Failed to save tool rejection message:', error);
		});

		const toolDisplay = formatToolCallMessage(toolCall);
		const statusIcon = '✗';
		let statusText = '';

		if (typeof confirmation === 'object' && confirmation.reason) {
			statusText = `\n  └─ Rejection reason: ${confirmation.reason}`;
		} else {
			statusText = `\n  └─ ${rejectMessage}`;
		}

		rejectedToolUIMessages.push({
			role: 'assistant' as const,
			content: `${statusIcon} ${toolDisplay.toolName}${statusText}`,
			streaming: false,
			messageStatus: 'error' as const,
		});
	}

	for (const toolCall of [...autoApprovedTools, ...nonSensitiveTools]) {
		const rejectionMessage = {
			role: 'tool' as const,
			tool_call_id: toolCall.id,
			content: rejectMessage,
			messageStatus: 'error' as const,
		};
		conversationMessages.push(rejectionMessage);
		saveMessage(rejectionMessage).catch(error => {
			console.error(
				'Failed to save auto-approved tool rejection message:',
				error,
			);
		});
	}

	if (rejectedToolUIMessages.length > 0) {
		setMessages(prev => [...prev, ...rejectedToolUIMessages]);
	}

	if (
		typeof confirmation === 'object' &&
		confirmation.type === 'reject_with_reply'
	) {
		return {
			shouldContinue: true,
			shouldEndSession: false,
			accumulatedUsage,
		};
	} else {
		setMessages(prev => [
			...prev,
			{
				role: 'assistant',
				content: 'Tool call rejected, session ended',
				streaming: false,
			},
		]);

		if (setIsStreaming) {
			setIsStreaming(false);
		}
		freeEncoder();

		return {
			shouldContinue: false,
			shouldEndSession: true,
			accumulatedUsage,
		};
	}
}
