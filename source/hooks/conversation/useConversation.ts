import {encoding_for_model} from 'tiktoken';
import {
	createStreamingChatCompletion,
	type ChatMessage,
} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {getSystemPrompt} from '../../api/systemPrompt.js';
import {
	collectAllMCPTools,
	getTodoService,
} from '../../utils/execution/mcpToolsManager.js';
import {
	executeToolCalls,
	type ToolCall,
} from '../../utils/execution/toolExecutor.js';
import {getOpenAiConfig} from '../../utils/config/apiConfig.js';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {formatTodoContext} from '../../utils/core/todoPreprocessor.js';
import {unifiedHooksExecutor} from '../../utils/execution/unifiedHooksExecutor.js';
import type {Message} from '../../ui/components/MessageList.js';
import {filterToolsBySensitivity} from '../../utils/execution/yoloPermissionChecker.js';
import {formatToolCallMessage} from '../../utils/ui/messageFormatter.js';
import {resourceMonitor} from '../../utils/core/resourceMonitor.js';
import {isToolNeedTwoStepDisplay} from '../../utils/config/toolDisplayConfig.js';
import type {ConfirmationResult} from '../../ui/components/ToolConfirmation.js';
import {
	shouldAutoCompress,
	performAutoCompression,
} from '../../utils/core/autoCompress.js';

export type UserQuestionResult = {
	selected: string;
	customInput?: string;
};

export type ConversationHandlerOptions = {
	userContent: string;
	imageContents:
		| Array<{type: 'image'; data: string; mimeType: string}>
		| undefined;
	controller: AbortController;
	messages: Message[];
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setStreamTokenCount: React.Dispatch<React.SetStateAction<number>>;
	requestToolConfirmation: (
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	) => Promise<ConfirmationResult>;
	requestUserQuestion: (
		question: string,
		options: string[],
		toolCall: ToolCall,
	) => Promise<UserQuestionResult>;
	isToolAutoApproved: (toolName: string) => boolean;
	addMultipleToAlwaysApproved: (toolNames: string[]) => void;
	yoloMode: boolean;
	setContextUsage: React.Dispatch<React.SetStateAction<any>>;
	useBasicModel?: boolean; // Optional flag to use basicModel instead of advancedModel
	getPendingMessages?: () => Array<{
		text: string;
		images?: Array<{data: string; mimeType: string}>;
	}>; // Get pending user messages
	clearPendingMessages?: () => void; // Clear pending messages after insertion
	setIsStreaming?: React.Dispatch<React.SetStateAction<boolean>>; // Control streaming state
	setIsReasoning?: React.Dispatch<React.SetStateAction<boolean>>; // Control reasoning state (Responses API only)
	setRetryStatus?: React.Dispatch<
		React.SetStateAction<{
			isRetrying: boolean;
			attempt: number;
			nextDelay: number;
			remainingSeconds?: number;
			errorMessage?: string;
		} | null>
	>; // Retry status
	clearSavedMessages?: () => void; // Clear saved messages for auto-compression
	setRemountKey?: React.Dispatch<React.SetStateAction<number>>; // Remount key for auto-compression
	getCurrentContextPercentage?: () => number; // Get current context percentage from ChatInput
};

/**
 * Handle conversation with streaming and tool calls
 * Returns the usage data collected during the conversation
 */
export async function handleConversationWithTools(
	options: ConversationHandlerOptions,
): Promise<{usage: any | null}> {
	const {
		userContent,
		imageContents,
		controller,
		// messages, // No longer used - we load from session instead to get complete history with tool calls
		saveMessage,
		setMessages,
		setStreamTokenCount,
		requestToolConfirmation,
		requestUserQuestion,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		yoloMode,
		setContextUsage,
		setIsReasoning,
		setRetryStatus,
	} = options;

	// Create a wrapper function for adding single tool to always-approved list
	const addToAlwaysApproved = (toolName: string) => {
		addMultipleToAlwaysApproved([toolName]);
	};

	// Step 1: Ensure session exists and get existing TODOs
	let currentSession = sessionManager.getCurrentSession();
	if (!currentSession) {
		// Check if running in task mode (temporary session)
		const isTaskMode = process.env['SNOW_TASK_MODE'] === 'true';

		currentSession = await sessionManager.createNewSession(isTaskMode);
	}
	const todoService = getTodoService();

	// Get existing TODO list
	const existingTodoList = await todoService.getTodoList(currentSession.id);

	// Collect all MCP tools
	const mcpTools = await collectAllMCPTools();
	// Build conversation history with TODO context as pinned user message
	let conversationMessages: ChatMessage[] = [
		{role: 'system', content: getSystemPrompt()},
	];

	// If there are TODOs, add pinned context message at the front
	if (existingTodoList && existingTodoList.todos.length > 0) {
		const todoContext = formatTodoContext(existingTodoList.todos);
		conversationMessages.push({
			role: 'user',
			content: todoContext,
		});
	}

	// Add history messages from session (includes tool_calls and tool results)
	// Load from session to get complete conversation history with tool interactions
	// Filter out internal sub-agent messages (marked with subAgentInternal: true)
	const session = sessionManager.getCurrentSession();
	if (session && session.messages.length > 0) {
		// Use session messages directly (they are already in API format)
		// Filter out sub-agent internal messages before sending to API
		const filteredMessages = session.messages.filter(
			msg => !msg.subAgentInternal,
		);
		conversationMessages.push(...filteredMessages);
	}

	// Add current user message
	conversationMessages.push({
		role: 'user',
		content: userContent,
		images: imageContents,
	});

	// Save user message (directly save API format message)
	// IMPORTANT: await to ensure message is saved before continuing
	// This prevents loss of user message if conversation is interrupted (ESC)
	try {
		await saveMessage({
			role: 'user',
			content: userContent,
			images: imageContents,
		});
	} catch (error) {
		console.error('Failed to save user message:', error);
	}

	// Initialize token encoder with proper cleanup tracking
	let encoder: any;
	let encoderFreed = false;
	const freeEncoder = () => {
		if (!encoderFreed && encoder) {
			try {
				encoder.free();
				encoderFreed = true;
				resourceMonitor.trackEncoderFreed();
			} catch (e) {
				console.error('Failed to free encoder:', e);
			}
		}
	};

	try {
		encoder = encoding_for_model('gpt-5');
		resourceMonitor.trackEncoderCreated();
	} catch (e) {
		encoder = encoding_for_model('gpt-3.5-turbo');
		resourceMonitor.trackEncoderCreated();
	}
	setStreamTokenCount(0);

	const config = getOpenAiConfig();
	const model = options.useBasicModel
		? config.basicModel || config.advancedModel || 'gpt-5'
		: config.advancedModel || 'gpt-5';

	// Tool calling loop (no limit on rounds)
	let finalAssistantMessage: Message | null = null;
	// Accumulate usage data across all rounds
	let accumulatedUsage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
		cached_tokens?: number; // Keep for UI display
	} | null = null;

	// Local set to track approved tools in this conversation (solves async setState issue)
	const sessionApprovedTools = new Set<string>();

	try {
		while (true) {
			if (controller.signal.aborted) {
				freeEncoder();
				break;
			}

			let streamedContent = '';
			let receivedToolCalls: ToolCall[] | undefined;
			let receivedReasoning:
				| {
						summary?: Array<{type: 'summary_text'; text: string}>;
						content?: any;
						encrypted_content?: string;
				  }
				| undefined;
			let receivedThinking:
				| {type: 'thinking'; thinking: string; signature?: string}
				| undefined; // Accumulate thinking content from all platforms
			let hasStartedReasoning = false; // Track if reasoning has started (for Gemini thinking)

			// Stream AI response - choose API based on config
			let toolCallAccumulator = ''; // Accumulate tool call deltas for token counting
			let reasoningAccumulator = ''; // Accumulate reasoning summary deltas for token counting (Responses API only)
			let chunkCount = 0; // Track number of chunks received (to delay clearing retry status)

			// Get or create session for cache key
			const currentSession = sessionManager.getCurrentSession();
			// Use session ID as cache key to ensure same session requests share cache
			const cacheKey = currentSession?.id;

			// 重试回调函数
			const onRetry = (error: Error, attempt: number, nextDelay: number) => {
				if (setRetryStatus) {
					setRetryStatus({
						isRetrying: true,
						attempt,
						nextDelay,
						errorMessage: error.message,
					});
				}
			};

			const streamGenerator =
				config.requestMethod === 'anthropic'
					? createStreamingAnthropicCompletion(
							{
								model,
								messages: conversationMessages,
								temperature: 0,
								max_tokens: config.maxTokens || 4096,
								tools: mcpTools.length > 0 ? mcpTools : undefined,
								sessionId: currentSession?.id,
								// Disable thinking for basicModel (e.g., init command)
								disableThinking: options.useBasicModel,
							},
							controller.signal,
							onRetry,
					  )
					: config.requestMethod === 'gemini'
					? createStreamingGeminiCompletion(
							{
								model,
								messages: conversationMessages,
								temperature: 0,
								tools: mcpTools.length > 0 ? mcpTools : undefined,
							},
							controller.signal,
							onRetry,
					  )
					: config.requestMethod === 'responses'
					? createStreamingResponse(
							{
								model,
								messages: conversationMessages,
								temperature: 0,
								tools: mcpTools.length > 0 ? mcpTools : undefined,
								tool_choice: 'auto',
								prompt_cache_key: cacheKey, // Use session ID as cache key
								// Don't pass reasoning for basicModel (small models may not support it)
								// Pass null to explicitly disable reasoning in API call
								reasoning: options.useBasicModel ? null : undefined,
							},
							controller.signal,
							onRetry,
					  )
					: createStreamingChatCompletion(
							{
								model,
								messages: conversationMessages,
								temperature: 0,
								tools: mcpTools.length > 0 ? mcpTools : undefined,
							},
							controller.signal,
							onRetry,
					  );

			for await (const chunk of streamGenerator) {
				if (controller.signal.aborted) break;

				// Clear retry status after a delay when first chunk arrives
				// This gives users time to see the retry message (500ms delay)
				chunkCount++;
				if (setRetryStatus && chunkCount === 1) {
					setTimeout(() => {
						setRetryStatus(null);
					}, 500);
				}

				if (chunk.type === 'reasoning_started') {
					// Reasoning started (Responses API only) - set reasoning state
					setIsReasoning?.(true);
				} else if (chunk.type === 'reasoning_delta' && chunk.delta) {
					// Handle reasoning delta from Gemini thinking
					// When reasoning_delta is received, set reasoning state if not already set
					if (!hasStartedReasoning) {
						setIsReasoning?.(true);
						hasStartedReasoning = true;
					}
					// Note: reasoning content is NOT sent back to AI, only counted for display
					reasoningAccumulator += chunk.delta;
					try {
						const tokens = encoder.encode(
							streamedContent + toolCallAccumulator + reasoningAccumulator,
						);
						setStreamTokenCount(tokens.length);
					} catch (e) {
						// Ignore encoding errors
					}
				} else if (chunk.type === 'content' && chunk.content) {
					// Accumulate content and update token count
					// When content starts, reasoning is done
					setIsReasoning?.(false);
					streamedContent += chunk.content;
					try {
						const tokens = encoder.encode(
							streamedContent + toolCallAccumulator + reasoningAccumulator,
						);
						setStreamTokenCount(tokens.length);
					} catch (e) {
						// Ignore encoding errors
					}
				} else if (chunk.type === 'tool_call_delta' && chunk.delta) {
					// Accumulate tool call deltas and update token count in real-time
					// When tool calls start, reasoning is done (OpenAI generally doesn't output text content during tool calls)
					setIsReasoning?.(false);
					toolCallAccumulator += chunk.delta;
					try {
						const tokens = encoder.encode(
							streamedContent + toolCallAccumulator + reasoningAccumulator,
						);
						setStreamTokenCount(tokens.length);
					} catch (e) {
						// Ignore encoding errors
					}
				} else if (chunk.type === 'tool_calls' && chunk.tool_calls) {
					receivedToolCalls = chunk.tool_calls;
				} else if (chunk.type === 'reasoning_data' && chunk.reasoning) {
					// Capture reasoning data from Responses API
					receivedReasoning = chunk.reasoning;
				} else if (chunk.type === 'done' && (chunk as any).thinking) {
					// Capture thinking content from Anthropic only (includes signature)
					receivedThinking = (chunk as any).thinking;
				} else if (chunk.type === 'usage' && chunk.usage) {
					// Capture usage information both in state and locally
					setContextUsage(chunk.usage);

					// Note: Usage is now saved at API layer (chat.ts, anthropic.ts, etc.)
					// No need to call onUsageUpdate here to avoid duplicate saves

					// Accumulate for final return (UI display purposes)
					if (!accumulatedUsage) {
						accumulatedUsage = {
							prompt_tokens: chunk.usage.prompt_tokens || 0,
							completion_tokens: chunk.usage.completion_tokens || 0,
							total_tokens: chunk.usage.total_tokens || 0,
							cache_creation_input_tokens:
								chunk.usage.cache_creation_input_tokens,
							cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
							cached_tokens: chunk.usage.cached_tokens,
						};
					} else {
						// Add to existing usage for UI display
						accumulatedUsage.prompt_tokens += chunk.usage.prompt_tokens || 0;
						accumulatedUsage.completion_tokens +=
							chunk.usage.completion_tokens || 0;
						accumulatedUsage.total_tokens += chunk.usage.total_tokens || 0;

						if (chunk.usage.cache_creation_input_tokens !== undefined) {
							accumulatedUsage.cache_creation_input_tokens =
								(accumulatedUsage.cache_creation_input_tokens || 0) +
								chunk.usage.cache_creation_input_tokens;
						}
						if (chunk.usage.cache_read_input_tokens !== undefined) {
							accumulatedUsage.cache_read_input_tokens =
								(accumulatedUsage.cache_read_input_tokens || 0) +
								chunk.usage.cache_read_input_tokens;
						}
						if (chunk.usage.cached_tokens !== undefined) {
							accumulatedUsage.cached_tokens =
								(accumulatedUsage.cached_tokens || 0) +
								chunk.usage.cached_tokens;
						}
					}
				}
			}

			// Reset token count after stream ends
			setStreamTokenCount(0);

			// If aborted during streaming, exit the loop
			// (discontinued message already added by ChatScreen ESC handler)
			if (controller.signal.aborted) {
				freeEncoder();
				break;
			}

			// If there are tool calls, we need to handle them specially
			if (receivedToolCalls && receivedToolCalls.length > 0) {
				// Add assistant message with tool_calls to conversation (OpenAI requires this format)
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: streamedContent || '',
					tool_calls: receivedToolCalls.map(tc => ({
						id: tc.id,
						type: 'function' as const,
						function: {
							name: tc.function.name,
							arguments: tc.function.arguments,
						},
					})),
					reasoning: receivedReasoning, // Include reasoning data for caching (Responses API)
					thinking: receivedThinking, // Include thinking content (Anthropic/OpenAI)
				} as any;
				conversationMessages.push(assistantMessage);

				// Save assistant message with tool calls
				saveMessage(assistantMessage).catch(error => {
					console.error('Failed to save assistant message:', error);
				});

				// If there's text content before tool calls, display it first
				if (streamedContent && streamedContent.trim()) {
					setMessages(prev => [
						...prev,
						{
							role: 'assistant',
							content: streamedContent.trim(),
							streaming: false,
						},
					]);
				}

				// Display tool calls in UI - 只有耗时工具才显示进行中状态
				// Generate parallel group ID when there are multiple tools
				const parallelGroupId =
					receivedToolCalls.length > 1
						? `parallel-${Date.now()}-${Math.random()}`
						: undefined;

				for (const toolCall of receivedToolCalls) {
					const toolDisplay = formatToolCallMessage(toolCall);
					let toolArgs;
					try {
						toolArgs = JSON.parse(toolCall.function.arguments);
					} catch (e) {
						toolArgs = {};
					}

					// 只有耗时工具才在动态区显示进行中状态
					if (isToolNeedTwoStepDisplay(toolCall.function.name)) {
						setMessages(prev => [
							...prev,
							{
								role: 'assistant',
								content: `⚡ ${toolDisplay.toolName}`,
								streaming: false,
								toolCall: {
									name: toolCall.function.name,
									arguments: toolArgs,
								},
								toolDisplay,
								toolCallId: toolCall.id, // Store tool call ID for later update
								toolPending: true, // Mark as pending execution
								// Mark parallel group for ALL tools (time-consuming or not)
								parallelGroup: parallelGroupId,
							},
						]);
					}
				}

				// Check if there are any askuser tools - they need special handling
				const askUserTool = receivedToolCalls.find(tc =>
					tc.function.name.startsWith('askuser-'),
				);

				// If there's an askuser tool, intercept and handle with UI component
				if (askUserTool) {
					// Remove pending messages
					setMessages(prev => prev.filter(msg => !msg.toolPending));

					// Parse tool arguments to get question and options
					let question = 'Please select an option:';
					let options: string[] = ['Yes', 'No'];

					try {
						const args = JSON.parse(askUserTool.function.arguments);
						if (args.question) question = args.question;
						if (args.options && Array.isArray(args.options)) {
							options = args.options;
						}
					} catch (error) {
						console.error('Failed to parse askuser tool arguments:', error);
					}

					// Request user input via UI component
					const userAnswer = await requestUserQuestion(
						question,
						options,
						askUserTool,
					);

					// Format the user's answer as tool result
					const answerText = userAnswer.customInput
						? `${userAnswer.selected}: ${userAnswer.customInput}`
						: userAnswer.selected;

					// Create tool result message and add to conversation
					const toolResultMessage: ChatMessage = {
						role: 'tool',
						tool_call_id: askUserTool.id,
						content: JSON.stringify({
							answer: answerText,
							selected: userAnswer.selected,
							customInput: userAnswer.customInput,
						}),
					};

					conversationMessages.push(toolResultMessage);

					// Save tool result to session
					await saveMessage(toolResultMessage);

					// Display user's answer in UI
					setMessages(prev => [
						...prev,
						{
							role: 'assistant',
							content: `✓ ${askUserTool.function.name}\n  └─ User answered: ${answerText}`,
							streaming: false,
							toolResult: answerText,
						},
					]);

					// Now filter out the askuser tool from receivedToolCalls
					// so it doesn't get executed again below
					const remainingTools = receivedToolCalls.filter(
						tc => tc.id !== askUserTool.id,
					);

					// If there are no more tools to execute, continue to next AI turn
					// The askuser tool result is already in the conversation
					// AI will receive it in the next iteration of the while loop
					if (remainingTools.length === 0) {
						continue;
					}

					// Otherwise, continue with remaining tools
					// Update receivedToolCalls to exclude askuser
					receivedToolCalls = remainingTools;
				}

				// Filter tools that need confirmation (not in always-approved list OR session-approved list)
				const toolsNeedingConfirmation: ToolCall[] = [];
				const autoApprovedTools: ToolCall[] = [];

				for (const toolCall of receivedToolCalls) {
					// Check both global approved list and session-approved list
					const isApproved =
						isToolAutoApproved(toolCall.function.name) ||
						sessionApprovedTools.has(toolCall.function.name);

					// Check if this is a sensitive command (terminal-execute with sensitive pattern)
					let isSensitiveCommand = false;
					if (toolCall.function.name === 'terminal-execute') {
						try {
							const args = JSON.parse(toolCall.function.arguments);
							const {isSensitiveCommand: checkSensitiveCommand} = await import(
								'../../utils/execution/sensitiveCommandManager.js'
							).then(m => ({
								isSensitiveCommand: m.isSensitiveCommand,
							}));
							const sensitiveCheck = checkSensitiveCommand(args.command);
							isSensitiveCommand = sensitiveCheck.isSensitive;
						} catch {
							// If parsing fails, treat as normal command
						}
					}

					// If sensitive command, always require confirmation regardless of approval status
					if (isSensitiveCommand) {
						toolsNeedingConfirmation.push(toolCall);
					} else if (isApproved) {
						autoApprovedTools.push(toolCall);
					} else {
						toolsNeedingConfirmation.push(toolCall);
					}
				}

				// Request confirmation only once for all tools needing confirmation
				let approvedTools: ToolCall[] = [...autoApprovedTools];

				// In YOLO mode, auto-approve all tools EXCEPT sensitive commands
				if (yoloMode) {
					// Use the unified permission checker to filter tools
					const {sensitiveTools, nonSensitiveTools} =
						await filterToolsBySensitivity(toolsNeedingConfirmation, yoloMode);

					// Auto-approve non-sensitive tools
					approvedTools.push(...nonSensitiveTools);

					// If there are sensitive tools, still need confirmation even in YOLO mode
					if (sensitiveTools.length > 0) {
						const firstTool = sensitiveTools[0]!;
						const allTools =
							sensitiveTools.length > 1 ? sensitiveTools : undefined;

						const confirmation = await requestToolConfirmation(
							firstTool,
							undefined,
							allTools,
						);

						if (
							confirmation === 'reject' ||
							(typeof confirmation === 'object' &&
								confirmation.type === 'reject_with_reply')
						) {
							setMessages(prev => prev.filter(msg => !msg.toolPending));

							const rejectMessage =
								typeof confirmation === 'object'
									? `Tool execution rejected by user: ${confirmation.reason}`
									: 'Error: Tool execution rejected by user';

							// Create UI messages for rejected tools
							const rejectedToolUIMessages: Message[] = [];

							// Handle sensitive tools that needed confirmation
							for (const toolCall of sensitiveTools) {
								const rejectionMessage = {
									role: 'tool' as const,
									tool_call_id: toolCall.id,
									content: rejectMessage,
								};
								conversationMessages.push(rejectionMessage);
								saveMessage(rejectionMessage).catch(error => {
									console.error(
										'Failed to save tool rejection message:',
										error,
									);
								});

								// Add UI message for each rejected tool
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
								});
							}

							// Also handle auto-approved tools (including TODO tools) - they weren't executed either
							for (const toolCall of [
								...autoApprovedTools,
								...nonSensitiveTools,
							]) {
								const rejectionMessage = {
									role: 'tool' as const,
									tool_call_id: toolCall.id,
									content: rejectMessage,
								};
								conversationMessages.push(rejectionMessage);
								saveMessage(rejectionMessage).catch(error => {
									console.error(
										'Failed to save auto-approved tool rejection message:',
										error,
									);
								});

								// No UI message for auto-approved tools since they were meant to be silent
							}

							// Add rejected tool messages to UI
							if (rejectedToolUIMessages.length > 0) {
								setMessages(prev => [...prev, ...rejectedToolUIMessages]);
							}

							// If reject_with_reply, continue the conversation instead of ending
							if (
								typeof confirmation === 'object' &&
								confirmation.type === 'reject_with_reply'
							) {
								// Continue to next iteration - AI will see the rejection message and respond
								continue;
							} else {
								// Original reject behavior - end session
								setMessages(prev => [
									...prev,
									{
										role: 'assistant',
										content: 'Tool call rejected, session ended',
										streaming: false,
									},
								]);

								if (options.setIsStreaming) {
									options.setIsStreaming(false);
								}
								freeEncoder();
								return {usage: accumulatedUsage};
							}
						}

						// Approved, add sensitive tools to approved list
						approvedTools.push(...sensitiveTools);
					}
				} else if (toolsNeedingConfirmation.length > 0) {
					const firstTool = toolsNeedingConfirmation[0]!;
					const allTools =
						toolsNeedingConfirmation.length > 1
							? toolsNeedingConfirmation
							: undefined;

					const confirmation = await requestToolConfirmation(
						firstTool,
						undefined,
						allTools,
					);

					if (
						confirmation === 'reject' ||
						(typeof confirmation === 'object' &&
							confirmation.type === 'reject_with_reply')
					) {
						setMessages(prev => prev.filter(msg => !msg.toolPending));

						const rejectMessage =
							typeof confirmation === 'object'
								? `Tool execution rejected by user: ${confirmation.reason}`
								: 'Error: Tool execution rejected by user';

						// Create UI messages for rejected tools
						const rejectedToolUIMessages: Message[] = [];

						// Handle tools that needed confirmation
						for (const toolCall of toolsNeedingConfirmation) {
							const rejectionMessage = {
								role: 'tool' as const,
								tool_call_id: toolCall.id,
								content: rejectMessage,
							};
							conversationMessages.push(rejectionMessage);
							saveMessage(rejectionMessage).catch(error => {
								console.error('Failed to save tool rejection message:', error);
							});

							// Add UI message for each rejected tool
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
							});
						}

						// Also handle auto-approved tools (including TODO tools) - they weren't executed either
						for (const toolCall of autoApprovedTools) {
							const rejectionMessage = {
								role: 'tool' as const,
								tool_call_id: toolCall.id,
								content: rejectMessage,
							};
							conversationMessages.push(rejectionMessage);
							saveMessage(rejectionMessage).catch(error => {
								console.error(
									'Failed to save auto-approved tool rejection message:',
									error,
								);
							});

							// No UI message for auto-approved tools since they were meant to be silent
						}

						// Add rejected tool messages to UI
						if (rejectedToolUIMessages.length > 0) {
							setMessages(prev => [...prev, ...rejectedToolUIMessages]);
						}

						// If reject_with_reply, continue the conversation instead of ending
						if (
							typeof confirmation === 'object' &&
							confirmation.type === 'reject_with_reply'
						) {
							// Continue to next iteration - AI will see the rejection message and respond
							continue;
						} else {
							// Original reject behavior - end session
							setMessages(prev => [
								...prev,
								{
									role: 'assistant',
									content: 'Tool call rejected, session ended',
									streaming: false,
								},
							]);

							if (options.setIsStreaming) {
								options.setIsStreaming(false);
							}
							freeEncoder();
							return {usage: accumulatedUsage};
						}
					}

					// If approved_always, add ALL these tools to both global and session-approved sets
					if (confirmation === 'approve_always') {
						const toolNamesToAdd = toolsNeedingConfirmation.map(
							t => t.function.name,
						);
						// Add to global state (async, for future sessions)
						addMultipleToAlwaysApproved(toolNamesToAdd);
						// Add to local session set (sync, for this conversation)
						toolNamesToAdd.forEach(name => sessionApprovedTools.add(name));
					}

					// Add all tools to approved list
					approvedTools.push(...toolsNeedingConfirmation);
				}

				// Execute approved tools with sub-agent message callback and terminal output callback
				// Track sub-agent content for token counting
				let subAgentContentAccumulator = '';
				const toolResults = await executeToolCalls(
					approvedTools,
					controller.signal,
					setStreamTokenCount,

					async subAgentMessage => {
						// Handle sub-agent messages - display and save to session
						setMessages(prev => {
							// Handle tool calls from sub-agent
							if (subAgentMessage.message.type === 'tool_calls') {
								const toolCalls = subAgentMessage.message.tool_calls;
								if (toolCalls && toolCalls.length > 0) {
									// Add tool call messages for each tool (only for time-consuming tools)
									const toolMessages = toolCalls
										.filter((toolCall: any) =>
											isToolNeedTwoStepDisplay(toolCall.function.name),
										)
										.map((toolCall: any) => {
											const toolDisplay = formatToolCallMessage(toolCall);
											let toolArgs;
											try {
												toolArgs = JSON.parse(toolCall.function.arguments);
											} catch (e) {
												toolArgs = {};
											}

											const uiMsg = {
												role: 'subagent' as const,
												content: `\x1b[38;2;184;122;206m⚇⚡ ${toolDisplay.toolName}\x1b[0m`,
												streaming: false,
												toolCall: {
													name: toolCall.function.name,
													arguments: toolArgs,
												},
												// Don't include toolDisplay for sub-agent tools to avoid showing parameters
												toolCallId: toolCall.id,
												toolPending: true,
												subAgent: {
													agentId: subAgentMessage.agentId,
													agentName: subAgentMessage.agentName,
													isComplete: false,
												},
												subAgentInternal: true, // Mark as internal sub-agent message
											};

											return uiMsg;
										});

									// Save all tool calls to session (regardless of display type)
									const sessionMsg = {
										role: 'assistant' as const,
										content: toolCalls
											.map((tc: any) => {
												const display = formatToolCallMessage(tc);
												return `⚇⚡ ${display.toolName}`;
											})
											.join(', '),
										subAgentInternal: true,
										tool_calls: toolCalls,
									};
									saveMessage(sessionMsg).catch(err =>
										console.error('Failed to save sub-agent tool call:', err),
									);

									return [...prev, ...toolMessages];
								}
							}

							// Handle tool results from sub-agent
							if (subAgentMessage.message.type === 'tool_result') {
								const msg = subAgentMessage.message as any;
								const isError = msg.content.startsWith('Error:');
								const statusIcon = isError ? '✗' : '✓';
								const statusText = isError ? `\n  └─ ${msg.content}` : '';

								// For terminal-execute, try to extract terminal result data
								let terminalResultData:
									| {
											stdout?: string;
											stderr?: string;
											exitCode?: number;
											command?: string;
									  }
									| undefined;
								if (msg.tool_name === 'terminal-execute' && !isError) {
									try {
										const resultData = JSON.parse(msg.content);
										if (
											resultData.stdout !== undefined ||
											resultData.stderr !== undefined
										) {
											terminalResultData = {
												stdout: resultData.stdout,
												stderr: resultData.stderr,
												exitCode: resultData.exitCode,
												command: resultData.command,
											};
										}
									} catch (e) {
										// If parsing fails, just show regular result
									}
								}

								// Create completed tool result message for UI
								const uiMsg = {
									role: 'subagent' as const,
									content: `\x1b[38;2;0;186;255m⚇${statusIcon} ${msg.tool_name}\x1b[0m${statusText}`,
									streaming: false,
									toolResult: !isError ? msg.content : undefined,
									terminalResult: terminalResultData,
									toolCall: terminalResultData
										? {
												name: msg.tool_name,
												arguments: terminalResultData,
										  }
										: undefined,
									subAgent: {
										agentId: subAgentMessage.agentId,
										agentName: subAgentMessage.agentName,
										isComplete: false,
									},
									subAgentInternal: true,
								};

								// Save to session as 'tool' role for API compatibility
								const sessionMsg = {
									role: 'tool' as const,
									tool_call_id: msg.tool_call_id,
									content: msg.content,
									subAgentInternal: true,
								};
								saveMessage(sessionMsg).catch(err =>
									console.error('Failed to save sub-agent tool result:', err),
								);

								// Add completed tool result message
								return [...prev, uiMsg];
							}

							// Check if we already have a message for this agent
							const existingIndex = prev.findIndex(
								m =>
									m.role === 'subagent' &&
									m.subAgent?.agentId === subAgentMessage.agentId &&
									!m.subAgent?.isComplete &&
									!m.toolCall, // Don't match tool call messages
							);

							// Extract content from the sub-agent message
							let content = '';
							if (subAgentMessage.message.type === 'content') {
								content = subAgentMessage.message.content;
								// Update token count for sub-agent content
								subAgentContentAccumulator += content;
								try {
									const tokens = encoder.encode(subAgentContentAccumulator);
									setStreamTokenCount(tokens.length);
								} catch (e) {
									// Ignore encoding errors
								}
							} else if (subAgentMessage.message.type === 'done') {
								// Mark as complete and reset token counter
								subAgentContentAccumulator = '';
								setStreamTokenCount(0);
								if (existingIndex !== -1) {
									const updated = [...prev];
									const existing = updated[existingIndex];
									if (existing && existing.subAgent) {
										updated[existingIndex] = {
											...existing,
											subAgent: {
												...existing.subAgent,
												isComplete: true,
											},
										};
									}
									return updated;
								}
								return prev;
							}

							if (existingIndex !== -1) {
								// Update existing message
								const updated = [...prev];
								const existing = updated[existingIndex];
								if (existing) {
									updated[existingIndex] = {
										...existing,
										content: (existing.content || '') + content,
										streaming: true,
									};
								}
								return updated;
							} else if (content) {
								// Add new sub-agent message
								return [
									...prev,
									{
										role: 'subagent' as const,
										content,
										streaming: true,
										subAgent: {
											agentId: subAgentMessage.agentId,
											agentName: subAgentMessage.agentName,
											isComplete: false,
										},
									},
								];
							}

							return prev;
						});
					},
					requestToolConfirmation,
					isToolAutoApproved,
					yoloMode,
					addToAlwaysApproved,
					// Add onUserInteractionNeeded callback for sub-agent askuser tool
					async (question: string, options: string[]) => {
						return await requestUserQuestion(question, options, {
							id: 'fake-tool-call',
							type: 'function' as const,
							function: {
								name: 'askuser',
								arguments: '{}',
							},
						});
					},
				);

				// Check if aborted during tool execution
				if (controller.signal.aborted) {
					// Need to add tool results for all pending tool calls to complete conversation history
					// This is critical for sub-agents and any tools that were being executed
					if (receivedToolCalls && receivedToolCalls.length > 0) {
						// CRITICAL FIX: If assistant message with tool_calls hasn't been saved yet,
						// we must save it first to avoid orphaned tool results in the session
						const assistantMsgWithTools = conversationMessages.find(
							msg =>
								msg.role === 'assistant' &&
								msg.tool_calls &&
								msg.tool_calls.some(tc =>
									receivedToolCalls!.some(rtc => rtc.id === tc.id),
								),
						);

						// If assistant message exists in memory but might not be in session yet,
						// wait for it to be saved before adding aborted tool results
						if (assistantMsgWithTools) {
							try {
								// Ensure assistant message is persisted first
								await saveMessage(assistantMsgWithTools);
							} catch (error) {
								console.error(
									'Failed to save assistant message before abort:',
									error,
								);
							}
						}

						// Now add aborted tool results
						for (const toolCall of receivedToolCalls) {
							const abortedResult = {
								role: 'tool' as const,
								tool_call_id: toolCall.id,
								content: 'Error: Tool execution aborted by user',
							};
							conversationMessages.push(abortedResult);
							saveMessage(abortedResult).catch(error => {
								console.error('Failed to save aborted tool result:', error);
							});
						}
					}
					freeEncoder();
					break;
				}

				// Check if any hook failed during tool execution
				const hookFailedResult = toolResults.find(r => r.hookFailed);
				if (hookFailedResult) {
					// Add tool results to conversation and break the loop
					for (const result of toolResults) {
						const {hookFailed, ...resultWithoutFlag} = result;
						conversationMessages.push(resultWithoutFlag);
						saveMessage(resultWithoutFlag).catch(error => {
							console.error('Failed to save tool result:', error);
						});
					}

					// Display hook error using HookErrorDisplay component
					setMessages(prev => [
						...prev,
						{
							role: 'assistant',
							content: '', // Content will be rendered by HookErrorDisplay
							streaming: false,
							hookError: hookFailedResult.hookErrorDetails,
						},
					]);

					if (options.setIsStreaming) {
						options.setIsStreaming(false);
					}
					freeEncoder();
					break;
				}

				// 在工具执行完成后、发送结果到AI前，检查是否需要压缩
				const config = getOpenAiConfig();
				if (
					config.enableAutoCompress !== false &&
					options.getCurrentContextPercentage &&
					shouldAutoCompress(options.getCurrentContextPercentage())
				) {
					try {
						// 显示压缩提示消息
						const compressingMessage: Message = {
							role: 'assistant',
							content:
								'✵ Auto-compressing context before sending tool results...',
							streaming: false,
						};
						setMessages(prev => [...prev, compressingMessage]);

						const compressionResult = await performAutoCompression();

						// Check if beforeCompress hook failed
						if (compressionResult && (compressionResult as any).hookFailed) {
							// Hook failed, display error and abort AI flow
							setMessages(prev => [
								...prev,
								{
									role: 'assistant',
									content: '', // Content will be rendered by HookErrorDisplay
									streaming: false,
									hookError: (compressionResult as any).hookErrorDetails,
								},
							]);

							if (options.setIsStreaming) {
								options.setIsStreaming(false);
							}
							freeEncoder();
							break; // Abort AI flow
						}

						if (compressionResult && options.clearSavedMessages) {
							// 更新UI和token使用情况
							options.clearSavedMessages();
							setMessages(compressionResult.uiMessages);
							if (options.setRemountKey) {
								options.setRemountKey(prev => prev + 1);
							}

							// Only update usage if compressionResult has usage field
							if (compressionResult.usage) {
								options.setContextUsage(compressionResult.usage);
								// 更新累计的usage为压缩后的usage
								accumulatedUsage = compressionResult.usage;
							}

							// 压缩后需要重新构建conversationMessages
							conversationMessages = [];
							const session = sessionManager.getCurrentSession();
							if (session && session.messages.length > 0) {
								conversationMessages.push(...session.messages);
							}
						}
					} catch (error) {
						console.error(
							'Auto-compression after tool execution failed:',
							error,
						);
						// 即使压缩失败也继续处理工具结果
					}
				}

				// Remove only streaming sub-agent content messages (not tool-related messages)
				// Keep sub-agent tool call and tool result messages for display
				setMessages(prev =>
					prev.filter(
						m =>
							m.role !== 'subagent' ||
							m.toolCall !== undefined ||
							m.toolResult !== undefined ||
							m.subAgentInternal === true,
					),
				);

				// Update existing tool call messages with results
				// Collect all result messages first, then add them in batch
				const resultMessages: any[] = [];

				for (const result of toolResults) {
					const toolCall = receivedToolCalls.find(
						tc => tc.id === result.tool_call_id,
					);
					if (toolCall) {
						// Special handling for sub-agent tools - show completion message
						// Pass the full JSON result to ToolResultPreview for proper parsing
						if (toolCall.function.name.startsWith('subagent-')) {
							const isError = result.content.startsWith('Error:');
							const statusIcon = isError ? '✗' : '✓';
							const statusText = isError ? `\n  └─ ${result.content}` : '';

							// Parse sub-agent result to extract usage information
							let usage: any = undefined;
							if (!isError) {
								try {
									const subAgentResult = JSON.parse(result.content);
									usage = subAgentResult.usage;
								} catch (e) {
									// Ignore parsing errors
								}
							}

							resultMessages.push({
								role: 'assistant',
								content: `${statusIcon} ${toolCall.function.name}${statusText}`,
								streaming: false,
								// Pass the full result.content for ToolResultPreview to parse
								toolResult: !isError ? result.content : undefined,
								subAgentUsage: usage,
							});

							// Save the tool result to conversation history
							conversationMessages.push(result as any);
							saveMessage(result).catch(error => {
								console.error('Failed to save tool result:', error);
							});
							continue;
						}

						const isError = result.content.startsWith('Error:');
						const statusIcon = isError ? '✗' : '✓';
						const statusText = isError ? `\n  └─ ${result.content}` : '';

						// Check if this is an edit tool with diff data
						let editDiffData:
							| {
									oldContent?: string;
									newContent?: string;
									filename?: string;
									completeOldContent?: string;
									completeNewContent?: string;
									contextStartLine?: number;
									batchResults?: any[];
									isBatch?: boolean;
							  }
							| undefined;
						if (
							(toolCall.function.name === 'filesystem-edit' ||
								toolCall.function.name === 'filesystem-edit_search') &&
							!isError
						) {
							try {
								const resultData = JSON.parse(result.content);
								// Handle single file edit
								if (resultData.oldContent && resultData.newContent) {
									editDiffData = {
										oldContent: resultData.oldContent,
										newContent: resultData.newContent,
										filename: JSON.parse(toolCall.function.arguments).filePath,
										completeOldContent: resultData.completeOldContent,
										completeNewContent: resultData.completeNewContent,
										contextStartLine: resultData.contextStartLine,
									};
								}
								// Handle batch edit
								else if (
									resultData.results &&
									Array.isArray(resultData.results)
								) {
									editDiffData = {
										batchResults: resultData.results,
										isBatch: true,
									};
								}
							} catch (e) {
								// If parsing fails, just show regular result
							}
						}

						// 处理工具执行结果的显示
						// - 耗时工具(两步显示):完成消息追加到静态区，之前的进行中消息已包含参数
						// - 普通工具(单步显示):完成消息需要包含参数和结果，使用 toolDisplay

						// 获取工具参数的格式化信息
						const toolDisplay = formatToolCallMessage(toolCall);
						const isNonTimeConsuming = !isToolNeedTwoStepDisplay(
							toolCall.function.name,
						);

						resultMessages.push({
							role: 'assistant',
							content: `${statusIcon} ${toolCall.function.name}${statusText}`,
							streaming: false,
							toolCall: editDiffData
								? {
										name: toolCall.function.name,
										arguments: editDiffData,
								  }
								: undefined,
							// 为普通工具添加参数显示（耗时工具在进行中状态已经显示过参数）
							toolDisplay: isNonTimeConsuming ? toolDisplay : undefined,
							// Store tool result for preview rendering
							toolResult: !isError ? result.content : undefined,
							// Mark parallel group for ALL tools (time-consuming or not)
							parallelGroup: parallelGroupId,
						});
					}

					// Add tool result to conversation history and save (skip if already saved above)
					if (toolCall && !toolCall.function.name.startsWith('subagent-')) {
						conversationMessages.push(result as any);
						saveMessage(result).catch(error => {
							console.error('Failed to save tool result:', error);
						});
					}
				}

				// Add all result messages in batch to avoid intermediate renders
				if (resultMessages.length > 0) {
					setMessages(prev => [...prev, ...resultMessages]);
				}

				// Check if there are pending user messages to insert
				if (options.getPendingMessages && options.clearPendingMessages) {
					const pendingMessages = options.getPendingMessages();
					if (pendingMessages.length > 0) {
						// 检查 token 占用，如果 >= 80% 先执行自动压缩
						const config = getOpenAiConfig();
						if (
							config.enableAutoCompress !== false &&
							options.getCurrentContextPercentage &&
							shouldAutoCompress(options.getCurrentContextPercentage())
						) {
							try {
								// 显示压缩提示消息
								const compressingMessage: Message = {
									role: 'assistant',
									content:
										'✵ Auto-compressing context before processing pending messages...',
									streaming: false,
								};
								setMessages(prev => [...prev, compressingMessage]);

								const compressionResult = await performAutoCompression();

								// Check if beforeCompress hook failed
								if (
									compressionResult &&
									(compressionResult as any).hookFailed
								) {
									// Hook failed, display error and abort AI flow
									setMessages(prev => [
										...prev,
										{
											role: 'assistant',
											content: '', // Content will be rendered by HookErrorDisplay
											streaming: false,
											hookError: (compressionResult as any).hookErrorDetails,
										},
									]);

									if (options.setIsStreaming) {
										options.setIsStreaming(false);
									}
									freeEncoder();
									break; // Abort AI flow
								}

								if (compressionResult && options.clearSavedMessages) {
									// 更新UI和token使用情况
									options.clearSavedMessages();
									setMessages(compressionResult.uiMessages);
									if (options.setRemountKey) {
										options.setRemountKey(prev => prev + 1);
									}

									// Only update usage if compressionResult has usage field
									if (compressionResult.usage) {
										options.setContextUsage(compressionResult.usage);
										// 更新累计的usage为压缩后的usage
										accumulatedUsage = compressionResult.usage;
									}

									// 压缩后需要重新构建conversationMessages
									conversationMessages = [];
									const session = sessionManager.getCurrentSession();
									if (session && session.messages.length > 0) {
										conversationMessages.push(...session.messages);
									}
								}
							} catch (error) {
								console.error(
									'Auto-compression before pending messages failed:',
									error,
								);
								// 即使压缩失败也继续处理pending消息
							}
						}

						// Clear pending messages
						options.clearPendingMessages();

						// Combine multiple pending messages into one
						const combinedMessage = pendingMessages
							.map(m => m.text)
							.join('\n\n');

						// Collect all images from pending messages
						const allPendingImages = pendingMessages
							.flatMap(m => m.images || [])
							.map(img => ({
								type: 'image' as const,
								data: img.data,
								mimeType: img.mimeType,
							}));

						// Add user message to UI
						const userMessage: Message = {
							role: 'user',
							content: combinedMessage,
							images:
								allPendingImages.length > 0 ? allPendingImages : undefined,
						};
						setMessages(prev => [...prev, userMessage]);

						// Add user message to conversation history (using images field for image data)
						conversationMessages.push({
							role: 'user',
							content: combinedMessage,
							images:
								allPendingImages.length > 0 ? allPendingImages : undefined,
						});

						// Save user message
						saveMessage({
							role: 'user',
							content: combinedMessage,
							images:
								allPendingImages.length > 0 ? allPendingImages : undefined,
						}).catch(error => {
							console.error('Failed to save pending user message:', error);
						});
					}
				}

				// Continue loop to get next response
				continue;
			}

			// No tool calls - conversation is complete
			// Display text content if any
			if (streamedContent.trim()) {
				finalAssistantMessage = {
					role: 'assistant',
					content: streamedContent.trim(),
					streaming: false,
					discontinued: controller.signal.aborted,
				};
				setMessages(prev => [...prev, finalAssistantMessage!]);

				// Add to conversation history and save
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: streamedContent.trim(),
					reasoning: receivedReasoning, // Include reasoning data for caching (Responses API)
					thinking: receivedThinking, // Include thinking content (Anthropic/OpenAI)
				};
				conversationMessages.push(assistantMessage);
				saveMessage(assistantMessage).catch(error => {
					console.error('Failed to save assistant message:', error);
				});
			}

			// ✅ 执行 onStop 钩子（在会话结束前，非用户中断）
			if (!controller.signal.aborted) {
				try {
					const hookResult = await unifiedHooksExecutor.executeHooks('onStop', {
						messages: conversationMessages,
					});

					// 处理钩子返回结果
					if (hookResult.results && hookResult.results.length > 0) {
						let shouldContinue = false;
						for (const result of hookResult.results) {
							if (result.type === 'command' && !result.success) {
								if (result.exitCode === 1) {
									// exitCode 1: 警告，显示给用户
									console.log(
										'[WARN] onStop hook warning:',
										result.error || result.output || '',
									);
								} else if (result.exitCode >= 2) {
									// exitCode >= 2: 错误，发送给 AI 继续处理
									const errorMessage: ChatMessage = {
										role: 'user',
										content: result.error || result.output || '未知错误',
									};
									conversationMessages.push(errorMessage);
									await saveMessage(errorMessage);
									setMessages(prev => [
										...prev,
										{
											role: 'user',
											content: errorMessage.content,
											streaming: false,
										},
									]);
									shouldContinue = true;
								}
							} else if (result.type === 'prompt' && result.response) {
								// 处理 prompt 类型
								if (result.response.ask === 'ai' && result.response.continue) {
									// 发送给 AI 继续处理
									const promptMessage: ChatMessage = {
										role: 'user',
										content: result.response.message,
									};
									conversationMessages.push(promptMessage);
									await saveMessage(promptMessage);
									setMessages(prev => [
										...prev,
										{
											role: 'user',
											content: promptMessage.content,
											streaming: false,
										},
									]);
									shouldContinue = true;
								} else if (
									result.response.ask === 'user' &&
									!result.response.continue
								) {
									// 显示给用户
									setMessages(prev => [
										...prev,
										{
											role: 'assistant',
											content: result.response!.message,
											streaming: false,
										},
									]);
								}
							}
						}

						// 如果需要继续，则不 break，让循环继续
						if (shouldContinue) {
							continue;
						}
					}
				} catch (error) {
					console.error('onStop hook execution failed:', error);
				}
			}

			// Conversation complete - exit the loop
			break;
		}

		// Free encoder
		freeEncoder();
	} catch (error) {
		throw error;
	} finally {
		// ✅ 确保总是释放encoder资源，避免资源泄漏
		freeEncoder();
	}

	// Return the accumulated usage data
	return {usage: accumulatedUsage};
}
