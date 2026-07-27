import type {ChatMessage} from '../../api/chat.js';
import {getSnowConfig} from '../../utils/config/apiConfig.js';
import type {Message} from '../../ui/components/chat/MessageList.js';
import {connectionManager} from '../../utils/connection/ConnectionManager.js';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {recordTurnContent, withTurnSpan} from '../../utils/telemetry/otel.js';
import {getCompanion, isCompanionMuted} from '../../buddy/companion.js';
import {
	generateBuddyContextReply,
	generateBuddyInProgressReply,
	shouldGenerateBuddyInProgressReply,
} from '../../buddy/buddyAi.js';
import {companionReaction} from '../../buddy/companionEvents.js';
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
	BuddyProgressEvent,
	ConversationHandlerOptions,
	ConversationUsage,
} from './core/conversationTypes.js';

export type {
	ConversationHandlerOptions,
	UserQuestionResult,
} from './core/conversationTypes.js';

const BUDDY_IN_PROGRESS_COOLDOWN_MS = 45_000;
let buddyInProgressActive = false;
let lastBuddyInProgressAt = 0;
let lastBuddyInProgressKey = '';

/**
 * Handle conversation with streaming and tool calls.
 * Returns the usage data collected during the conversation.
 */
export async function handleConversationWithTools(
	options: ConversationHandlerOptions,
): Promise<{usage: ConversationUsage | null}> {
	const config = getSnowConfig();
	const model = options.useBasicModel
		? config.basicModel || config.advancedModel || 'gpt-5'
		: config.advancedModel || 'gpt-5';
	const currentSession = sessionManager.getCurrentSession();
	const turnId = currentSession
		? `${currentSession.id}:${currentSession.messageCount + 1}`
		: undefined;

	return withTurnSpan(
		{
			sessionId: currentSession?.id,
			conversationId: currentSession?.id,
			turnId,
			model,
			requestMethod: config.requestMethod,
			planMode: options.planMode,
			vulnerabilityHuntingMode: options.vulnerabilityHuntingMode,
			teamMode: options.teamMode,
		},
		() => runConversationWithTools(options),
	);
}

async function runConversationWithTools(
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
		teamMode: options.teamMode,
		toolSearchDisabled: options.toolSearchDisabled,
	});

	const onBuddyProgress: ConversationHandlerOptions['onBuddyProgress'] =
		event => {
			void triggerBuddyInProgressReaction(
				conversationMessages,
				controller.signal,
				event,
			);
		};
	const runtimeOptions: ConversationHandlerOptions = {
		...options,
		onBuddyProgress,
	};

	await appendUserMessageAndSyncContext({
		conversationMessages,
		userContent,
		hookApiOnlyContext: options.hookApiOnlyContext,
		editorContext,
		imageContents,
		saveMessage,
		abortSignal: controller.signal,
	});
	recordTurnContent('request', userContent, {
		'snow.content.source': 'user',
		...(imageContents?.length
			? {'snow.content.image_count': imageContents.length}
			: {}),
	});

	const encoderManager = new EncoderManager();
	const freeEncoder = () => {
		encoderManager.free();
	};

	setStreamTokenCount(0);

	const config = getSnowConfig();
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

			// Pause gate: block here if the user has paused the AI loop.
			// The wait resolves when the user resumes or when the abort
			// signal fires (ESC interrupt).
			if (options.pauseGate) {
				await options.pauseGate.waitForResume(controller.signal);
			}

			// Check abort again after pause (user may have ESC'd during pause)
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
				options: runtimeOptions,
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
					options: runtimeOptions,
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
				const assistantContent = streamResult.streamedContent.trim();
				recordTurnContent('response', assistantContent, {
					'snow.content.source': 'assistant',
				});

				if (!streamResult.hasStreamedLines) {
					const finalAssistantMessage: Message = {
						role: 'assistant',
						content: assistantContent,
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
					content: assistantContent,
					reasoning: streamResult.receivedReasoning,
					thinking: streamResult.receivedThinking,
					reasoning_content: streamResult.receivedReasoningContent,
				};
				conversationMessages.push(assistantMessage);
				saveMessage(assistantMessage).catch(error => {
					console.error('Failed to save assistant message:', error);
				});
			}

			// 最终回复已完成：立刻清掉思考态，避免收尾阶段仍显示深度思考。
			setIsReasoning?.(false);
			options.onThinkingStatus?.(null);

			if (!controller.signal.aborted) {
				const hookResult = await handleOnStopHooks({
					conversationMessages,
					saveMessage,
					setMessages,
				});
				if (hookResult.shouldContinue) {
					continue;
				}

				// Buddy 气泡是装饰性二次 LLM 调用，绝不能阻塞主轮次收尾。
				// 以前 await 它会导致 isStreaming 一直 true，UI 卡在“收尾中...”数秒。
				void triggerBuddyContextReaction(
					conversationMessages,
					controller.signal,
				);
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

async function triggerBuddyContextReaction(
	conversationMessages: ChatMessage[],
	abortSignal: AbortSignal,
): Promise<void> {
	if (abortSignal.aborted || isCompanionMuted()) {
		return;
	}

	const companion = getCompanion();
	if (!companion) {
		return;
	}

	try {
		const reply = await generateBuddyContextReply(
			companion,
			conversationMessages,
			abortSignal,
		);
		if (!abortSignal.aborted && !isCompanionMuted() && reply.trim()) {
			companionReaction(reply);
		}
	} catch (error) {
		console.error('Failed to generate buddy context reaction:', error);
	}
}

async function triggerBuddyInProgressReaction(
	conversationMessages: ChatMessage[],
	abortSignal: AbortSignal,
	event: BuddyProgressEvent,
): Promise<void> {
	if (abortSignal.aborted || isCompanionMuted() || buddyInProgressActive) {
		return;
	}

	const eventKey = `${event.stage}:${event.summary ?? ''}`;
	const now = Date.now();
	if (
		eventKey === lastBuddyInProgressKey ||
		now - lastBuddyInProgressAt < BUDDY_IN_PROGRESS_COOLDOWN_MS
	) {
		return;
	}

	const companion = getCompanion();
	if (!companion) {
		return;
	}

	const context = {
		stage: event.stage,
		summary: event.summary,
		conversationMessages,
	};
	if (!shouldGenerateBuddyInProgressReply(companion, context)) {
		return;
	}

	buddyInProgressActive = true;
	try {
		const reply = await generateBuddyInProgressReply(
			companion,
			context,
			abortSignal,
		);
		if (!abortSignal.aborted && !isCompanionMuted() && reply.trim()) {
			lastBuddyInProgressAt = Date.now();
			lastBuddyInProgressKey = eventKey;
			companionReaction(reply);
		}
	} catch (error) {
		console.error('Failed to generate buddy in-progress reaction:', error);
	} finally {
		buddyInProgressActive = false;
	}
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
