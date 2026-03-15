import {
	executeToolCalls,
	type ToolCall,
} from '../../../utils/execution/toolExecutor.js';
import {toolSearchService} from '../../../utils/execution/toolSearchService.js';
import type {Message} from '../../../ui/components/chat/MessageList.js';
import {extractThinkingContent} from '../utils/thinkingExtractor.js';
import {processToolCallsAfterStream} from './toolCallProcessor.js';
import {resolveToolConfirmations} from './toolConfirmationFlow.js';
import {handleAutoCompression} from './autoCompressHandler.js';
import {buildToolResultMessages} from './toolResultDisplay.js';
import {SubAgentUIHandler} from './subAgentMessageHandler.js';
import {handlePendingMessages} from './pendingMessagesHandler.js';
import {connectionManager} from '../../../utils/connection/ConnectionManager.js';
import type {
	ConversationHandlerOptions,
	StreamRoundResult,
	ToolCallRoundResult,
	UserQuestionResult,
	ConversationUsage,
	TokenEncoder,
} from './conversationTypes.js';
import type {MCPTool} from '../../../utils/execution/mcpToolsManager.js';
import type {ConfirmationResult} from '../../../ui/components/tools/ToolConfirmation.js';

export async function handleToolCallRound(ctx: {
	streamResult: StreamRoundResult;
	conversationMessages: any[];
	activeTools: MCPTool[];
	discoveredToolNames: Set<string>;
	useToolSearch: boolean;
	controller: AbortController;
	encoder: TokenEncoder;
	accumulatedUsage: ConversationUsage | null;
	sessionApprovedTools: Set<string>;
	freeEncoder: () => void;
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setStreamTokenCount: React.Dispatch<React.SetStateAction<number>>;
	setContextUsage: React.Dispatch<React.SetStateAction<any>>;
	requestToolConfirmation: (
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	) => Promise<ConfirmationResult>;
	requestUserQuestion: (
		question: string,
		options: string[],
		toolCall: ToolCall,
		multiSelect?: boolean,
	) => Promise<UserQuestionResult>;
	isToolAutoApproved: (toolName: string) => boolean;
	addMultipleToAlwaysApproved: (toolNames: string[]) => void;
	addToAlwaysApproved: (toolName: string) => void;
	yoloModeRef: React.MutableRefObject<boolean>;
	streamingEnabled: boolean;
	options: ConversationHandlerOptions;
}): Promise<ToolCallRoundResult> {
	const {
		streamResult,
		conversationMessages,
		activeTools,
		discoveredToolNames,
		useToolSearch,
		controller,
		encoder,
		sessionApprovedTools,
		freeEncoder,
		saveMessage,
		setMessages,
		setStreamTokenCount,
		setContextUsage,
		requestToolConfirmation,
		requestUserQuestion,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		addToAlwaysApproved,
		yoloModeRef,
		streamingEnabled,
		options,
	} = ctx;
	let {accumulatedUsage} = ctx;

	const receivedToolCalls = streamResult.receivedToolCalls!;

	const {parallelGroupId} = await processToolCallsAfterStream({
		receivedToolCalls,
		streamedContent: streamResult.streamedContent,
		receivedReasoning: streamResult.receivedReasoning,
		receivedThinking: streamResult.receivedThinking,
		receivedReasoningContent: streamResult.receivedReasoningContent,
		conversationMessages,
		saveMessage,
		setMessages,
		extractThinkingContent,
		hasStreamedLines: streamResult.hasStreamedLines,
	});

	const confirmResult = await resolveToolConfirmations({
		receivedToolCalls,
		isToolAutoApproved,
		sessionApprovedTools,
		yoloMode: yoloModeRef.current,
		requestToolConfirmation,
		addMultipleToAlwaysApproved,
		conversationMessages,
		accumulatedUsage,
		saveMessage,
		setMessages,
		setIsStreaming: options.setIsStreaming
			? (value: boolean) => options.setIsStreaming!(value)
			: undefined,
		freeEncoder,
		abortSignal: controller.signal,
	});

	if (confirmResult.type === 'rejected') {
		if (confirmResult.shouldContinue) {
			return {type: 'continue'};
		}
		return {type: 'return', accumulatedUsage: confirmResult.accumulatedUsage};
	}

	const approvedTools = confirmResult.approvedTools;

	if (controller.signal.aborted) {
		for (const toolCall of approvedTools) {
			const abortedResult = {
				role: 'tool' as const,
				tool_call_id: toolCall.id,
				content: 'Tool execution aborted by user',
				messageStatus: 'error' as const,
			};
			conversationMessages.push(abortedResult);
			await saveMessage(abortedResult);
		}
		freeEncoder();
		return {type: 'break'};
	}

	const subAgentHandler = new SubAgentUIHandler(
		encoder,
		setStreamTokenCount,
		saveMessage,
		options.setIsReasoning
			? (isReasoning: boolean) => options.setIsReasoning!(isReasoning)
			: undefined,
		streamingEnabled,
	);

	const toolResults = await executeToolCalls(
		approvedTools,
		controller.signal,
		setStreamTokenCount,
		async subAgentMessage => {
			setMessages(prev => subAgentHandler.handleMessage(prev, subAgentMessage));
		},
		async (toolCall, batchToolNames, allTools) => {
			if (connectionManager.isConnected()) {
				await connectionManager.notifyToolConfirmationNeeded(
					toolCall.function.name,
					toolCall.function.arguments,
					toolCall.id,
					allTools?.map(tool => ({
						name: tool.function.name,
						arguments: tool.function.arguments,
					})),
				);
			}
			return requestToolConfirmation(toolCall, batchToolNames, allTools);
		},
		isToolAutoApproved,
		yoloModeRef.current,
		addToAlwaysApproved,
		async (question: string, opts: string[], multiSelect?: boolean) => {
			if (connectionManager.isConnected()) {
				await connectionManager.notifyUserInteractionNeeded(
					question,
					opts,
					'fake-tool-call',
					multiSelect,
				);
			}
			return requestUserQuestion(
				question,
				opts,
				{
					id: 'fake-tool-call',
					type: 'function',
					function: {name: 'askuser', arguments: '{}'},
				},
				multiSelect,
			);
		},
	);

	if (controller.signal.aborted) {
		for (const toolCall of receivedToolCalls) {
			const abortedResult = {
				role: 'tool' as const,
				tool_call_id: toolCall.id,
				content: 'Error: Tool execution aborted by user',
				messageStatus: 'error' as const,
			};
			conversationMessages.push(abortedResult);
			try {
				await saveMessage(abortedResult);
			} catch (error) {
				console.error('Failed to save aborted tool result:', error);
			}
		}
		freeEncoder();
		return {type: 'break'};
	}

	const hookFailedResult = toolResults.find(result => result.hookFailed);
	if (hookFailedResult) {
		for (const result of toolResults) {
			const {hookFailed, ...resultWithoutFlag} = result;
			conversationMessages.push(resultWithoutFlag);
			saveMessage(resultWithoutFlag).catch(error => {
				console.error('Failed to save tool result:', error);
			});
		}
		setMessages(prev => [
			...prev,
			{
				role: 'assistant',
				content: '',
				streaming: false,
				hookError: hookFailedResult.hookErrorDetails,
			},
		]);
		options.setIsStreaming?.(false);
		freeEncoder();
		return {type: 'break'};
	}

	if (useToolSearch) {
		for (const toolCall of receivedToolCalls) {
			if (toolCall.function.name !== 'tool_search') {
				continue;
			}

			try {
				const searchArgs = JSON.parse(toolCall.function.arguments || '{}');
				const {matchedToolNames} = toolSearchService.search(
					searchArgs.query || '',
				);
				for (const name of matchedToolNames) {
					if (discoveredToolNames.has(name)) {
						continue;
					}
					discoveredToolNames.add(name);
					const tool = toolSearchService.getToolByName(name);
					if (tool) {
						activeTools.push(tool);
					}
				}
			} catch {
				// Ignore parse errors
			}
		}
	}

	for (const result of toolResults) {
		const isError = result.content.startsWith('Error:');
		const resultToSave = {
			...result,
			messageStatus: isError ? 'error' : 'success',
		};
		conversationMessages.push(resultToSave as any);
		try {
			await saveMessage(resultToSave as any);
		} catch (error) {
			console.error('Failed to save tool result before compression:', error);
		}
	}

	const autoCompressOpts = {
		getCurrentContextPercentage: options.getCurrentContextPercentage,
		setMessages,
		clearSavedMessages: options.clearSavedMessages,
		setRemountKey: options.setRemountKey,
		setContextUsage,
		setSnapshotFileCount: options.setSnapshotFileCount,
		setIsStreaming: options.setIsStreaming,
		freeEncoder,
		compressingLabel:
			'✵ Auto-compressing context before sending tool results...',
		onCompressionStatus: options.onCompressionStatus,
		setIsAutoCompressing: options.setIsAutoCompressing,
	};

	const compressResult = await handleAutoCompression(autoCompressOpts);
	if (compressResult.hookFailed) {
		setMessages(prev => [
			...prev,
			{
				role: 'assistant',
				content: '',
				streaming: false,
				hookError: compressResult.hookErrorDetails,
			},
		]);
		options.setIsStreaming?.(false);
		freeEncoder();
		return {type: 'break'};
	}

	if (compressResult.compressed && compressResult.updatedConversationMessages) {
		conversationMessages.length = 0;
		conversationMessages.push(...compressResult.updatedConversationMessages);
		if (compressResult.accumulatedUsage) {
			accumulatedUsage = compressResult.accumulatedUsage;
		}
	}

	setMessages(prev =>
		prev.filter(
			message =>
				message.role !== 'subagent' ||
				message.toolCall !== undefined ||
				message.toolResult !== undefined ||
				message.subAgentInternal === true,
		),
	);

	const resultMessages = buildToolResultMessages(
		toolResults,
		receivedToolCalls,
		parallelGroupId,
	);
	if (resultMessages.length > 0) {
		setMessages(prev => [...prev, ...resultMessages]);
	}

	try {
		const {runningSubAgentTracker} = await import(
			'../../../utils/execution/runningSubAgentTracker.js'
		);
		const spawnedResults = runningSubAgentTracker.drainSpawnedResults();
		if (spawnedResults.length > 0) {
			for (const spawnedResult of spawnedResults) {
				const statusIcon = spawnedResult.success ? '✓' : '✗';
				const resultSummary = spawnedResult.success
					? spawnedResult.result.length > 500
						? spawnedResult.result.substring(0, 500) + '...'
						: spawnedResult.result
					: spawnedResult.error || 'Unknown error';
				const spawnedContent = `[Spawned Sub-Agent Result] ${statusIcon} ${spawnedResult.agentName} (${spawnedResult.agentId}) — spawned by ${spawnedResult.spawnedBy.agentName}\nPrompt: ${spawnedResult.prompt}\nResult: ${resultSummary}`;

				conversationMessages.push({role: 'user', content: spawnedContent});
				try {
					await saveMessage({role: 'user', content: spawnedContent});
				} catch (error) {
					console.error('Failed to save spawned agent result:', error);
				}

				const uiMessage: Message = {
					role: 'subagent',
					content: `\x1b[38;2;150;120;255m⚇${statusIcon} Spawned ${spawnedResult.agentName}\x1b[0m (by ${spawnedResult.spawnedBy.agentName}): ${spawnedResult.success ? 'completed' : 'failed'}`,
					streaming: false,
					messageStatus: spawnedResult.success ? 'success' : 'error',
					subAgent: {
						agentId: spawnedResult.agentId,
						agentName: spawnedResult.agentName,
						isComplete: true,
					},
					subAgentInternal: true,
				};
				setMessages(prev => [...prev, uiMessage]);
			}
		}
	} catch (error) {
		console.error('Failed to process spawned agent results:', error);
	}

	const pendingResult = await handlePendingMessages({
		getPendingMessages: options.getPendingMessages,
		clearPendingMessages: options.clearPendingMessages,
		conversationMessages,
		saveMessage,
		setMessages,
		autoCompressOptions: autoCompressOpts,
	});

	if (pendingResult.hookFailed) {
		setMessages(prev => [
			...prev,
			{
				role: 'assistant',
				content: '',
				streaming: false,
				hookError: pendingResult.hookErrorDetails,
			},
		]);
		options.setIsStreaming?.(false);
		freeEncoder();
		return {type: 'break'};
	}

	if (pendingResult.accumulatedUsage) {
		accumulatedUsage = pendingResult.accumulatedUsage;
	}

	return {type: 'continue', accumulatedUsage};
}
