import type {ChatMessage} from '../../api/chat.js';
import {getOpenAiConfig} from '../../utils/config/apiConfig.js';
import type {Message} from '../../ui/components/chat/MessageList.js';
import {connectionManager} from '../../utils/connection/ConnectionManager.js';
import {extractThinkingContent} from './utils/thinkingExtractor.js';
import {EncoderManager} from './core/encoderManager.js';
import {
	appendUserMessageAndSyncContext,
	prepareConversationSetup,
} from './core/conversationSetup.js';
import {processStreamRound} from './core/streamProcessor.js';
import {handleToolCallRound} from './core/toolCallRoundHandler.js';
import {handleOnStopHooks} from './core/onStopHookHandler.js';
import type {
	ConversationHandlerOptions,
	ConversationUsage,
} from './core/conversationTypes.js';

export type {
	ConversationHandlerOptions,
	UserQuestionResult,
} from './core/conversationTypes.js';

/**
 * Handle conversation with streaming and tool calls.
 * Returns the usage data collected during the conversation.
 */
export async function handleConversationWithTools(
	options: ConversationHandlerOptions,
): Promise<{usage: ConversationUsage | null}> {
	const {
		userContent,
		editorContext,
		imageContents,
		controller,
		saveMessage,
		setMessages,
		setStreamTokenCount,
		requestToolConfirmation,
		requestUserQuestion,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		yoloModeRef,
		setContextUsage,
		setIsReasoning,
		setRetryStatus,
	} = options;

	const addToAlwaysApproved = (toolName: string) => {
		addMultipleToAlwaysApproved([toolName]);
	};

	const {
		conversationMessages,
		activeTools,
		discoveredToolNames,
		useToolSearch,
	} = await prepareConversationSetup({
		planMode: options.planMode,
		vulnerabilityHuntingMode: options.vulnerabilityHuntingMode,
		toolSearchDisabled: options.toolSearchDisabled,
	});

	await appendUserMessageAndSyncContext({
		conversationMessages,
		userContent,
		editorContext,
		imageContents,
		saveMessage,
	});

	const encoderManager = new EncoderManager();
	const freeEncoder = () => {
		encoderManager.free();
	};

	setStreamTokenCount(0);

	const config = getOpenAiConfig();
	const model = options.useBasicModel
		? config.basicModel || config.advancedModel || 'gpt-5'
		: config.advancedModel || 'gpt-5';

	options.setCurrentModel?.(model);

	let accumulatedUsage: ConversationUsage | null = null;
	const sessionApprovedTools = new Set<string>();

	try {
		while (true) {
			if (controller.signal.aborted) {
				freeEncoder();
				break;
			}

			const streamResult = await processStreamRound({
				config,
				model,
				conversationMessages,
				activeTools,
				controller,
				encoder: encoderManager,
				setStreamTokenCount,
				setMessages,
				setIsReasoning,
				setRetryStatus,
				setContextUsage,
				options,
			});

			setStreamTokenCount(0);
			accumulatedUsage = mergeUsage(accumulatedUsage, streamResult.roundUsage);

			if (
				streamResult.receivedToolCalls &&
				streamResult.receivedToolCalls.length > 0
			) {
				const toolLoopResult = await handleToolCallRound({
					streamResult,
					conversationMessages,
					activeTools,
					discoveredToolNames,
					useToolSearch,
					controller,
					encoder: encoderManager,
					accumulatedUsage,
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
					streamingEnabled: config.streamingDisplay !== false,
					options,
				});

				if (toolLoopResult.type === 'break') {
					if (toolLoopResult.accumulatedUsage !== undefined) {
						accumulatedUsage = toolLoopResult.accumulatedUsage;
					}
					freeEncoder();
					break;
				}

				if (toolLoopResult.type === 'return') {
					return {usage: toolLoopResult.accumulatedUsage};
				}

				if (toolLoopResult.accumulatedUsage !== undefined) {
					accumulatedUsage = toolLoopResult.accumulatedUsage;
				}
				continue;
			}

			if (streamResult.streamedContent.trim()) {
				if (!streamResult.hasStreamedLines) {
					const finalAssistantMessage: Message = {
						role: 'assistant',
						content: streamResult.streamedContent.trim(),
						streaming: false,
						discontinued: controller.signal.aborted,
						thinking: extractThinkingContent(
							streamResult.receivedThinking,
							streamResult.receivedReasoning,
							streamResult.receivedReasoningContent,
						),
					};
					setMessages(prev => [...prev, finalAssistantMessage]);
				}

				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: streamResult.streamedContent.trim(),
					reasoning: streamResult.receivedReasoning,
					thinking: streamResult.receivedThinking,
					reasoning_content: streamResult.receivedReasoningContent,
				};
				conversationMessages.push(assistantMessage);
				saveMessage(assistantMessage).catch(error => {
					console.error('Failed to save assistant message:', error);
				});
			}

			if (!controller.signal.aborted) {
				const hookResult = await handleOnStopHooks({
					conversationMessages,
					saveMessage,
					setMessages,
				});
				if (hookResult.shouldContinue) {
					continue;
				}
			}

			break;
		}

		freeEncoder();
	} finally {
		options.setIsStreaming?.(false);

		try {
			await connectionManager.notifyMessageProcessingCompleted();
		} catch {
			// Ignore notification errors
		}

		try {
			const {clearConversationContext} = await import(
				'../../utils/codebase/conversationContext.js'
			);
			clearConversationContext();
		} catch {
			// Ignore errors during cleanup
		}

		freeEncoder();
	}

	return {usage: accumulatedUsage};
}

function mergeUsage(
	accumulated: ConversationUsage | null,
	round: ConversationUsage | null,
): ConversationUsage | null {
	if (!round) {
		return accumulated;
	}
	if (!accumulated) {
		return round;
	}

	return {
		prompt_tokens: accumulated.prompt_tokens + (round.prompt_tokens || 0),
		completion_tokens:
			accumulated.completion_tokens + (round.completion_tokens || 0),
		total_tokens: accumulated.total_tokens + (round.total_tokens || 0),
		cache_creation_input_tokens:
			round.cache_creation_input_tokens !== undefined
				? (accumulated.cache_creation_input_tokens || 0) +
				  round.cache_creation_input_tokens
				: accumulated.cache_creation_input_tokens,
		cache_read_input_tokens:
			round.cache_read_input_tokens !== undefined
				? (accumulated.cache_read_input_tokens || 0) +
				  round.cache_read_input_tokens
				: accumulated.cache_read_input_tokens,
		cached_tokens:
			round.cached_tokens !== undefined
				? (accumulated.cached_tokens || 0) + round.cached_tokens
				: accumulated.cached_tokens,
	};
}
