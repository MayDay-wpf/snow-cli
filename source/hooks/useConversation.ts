import { encoding_for_model } from 'tiktoken';
import { createStreamingChatCompletion, type ChatMessage } from '../api/chat.js';
import { createStreamingResponse } from '../api/responses.js';
import { SYSTEM_PROMPT } from '../api/systemPrompt.js';
import { collectAllMCPTools, getTodoService } from '../utils/mcpToolsManager.js';
import { executeToolCalls, type ToolCall } from '../utils/toolExecutor.js';
import { getOpenAiConfig } from '../utils/apiConfig.js';
import { sessionManager } from '../utils/sessionManager.js';
import { formatTodoContext } from '../utils/todoPreprocessor.js';
import type { Message } from '../ui/components/MessageList.js';
import { formatToolCallMessage } from '../utils/messageFormatter.js';

export type ConversationHandlerOptions = {
	userContent: string;
	imageContents: Array<{type: 'image', data: string, mimeType: string}> | undefined;
	controller: AbortController;
	messages: Message[];
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setStreamTokenCount: React.Dispatch<React.SetStateAction<number>>;
	setCurrentTodos: React.Dispatch<React.SetStateAction<Array<{id: string; content: string; status: 'pending' | 'in_progress' | 'completed'}>>>;
	requestToolConfirmation: (toolCall: ToolCall, batchToolNames?: string) => Promise<string>;
	isToolAutoApproved: (toolName: string) => boolean;
	addMultipleToAlwaysApproved: (toolNames: string[]) => void;
	yoloMode: boolean;
	setContextUsage: React.Dispatch<React.SetStateAction<any>>;
	useBasicModel?: boolean; // Optional flag to use basicModel instead of advancedModel
	getPendingMessages?: () => string[]; // Get pending user messages
	clearPendingMessages?: () => void; // Clear pending messages after insertion
};

/**
 * Handle conversation with streaming and tool calls
 */
export async function handleConversationWithTools(options: ConversationHandlerOptions) {
	const {
		userContent,
		imageContents,
		controller,
		messages,
		saveMessage,
		setMessages,
		setStreamTokenCount,
		setCurrentTodos,
		requestToolConfirmation,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		yoloMode,
		setContextUsage
	} = options;

	// Step 1: Ensure session exists and get existing TODOs
	let currentSession = sessionManager.getCurrentSession();
	if (!currentSession) {
		currentSession = await sessionManager.createNewSession();
	}
	const todoService = getTodoService();

	// Get existing TODO list
	const existingTodoList = await todoService.getTodoList(currentSession.id);

	// Update UI state
	if (existingTodoList) {
		setCurrentTodos(existingTodoList.todos);
	}

	// Collect all MCP tools
	const mcpTools = await collectAllMCPTools();

	// Build conversation history with TODO context as pinned user message
	let conversationMessages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT }
	];

	// If there are TODOs, add pinned context message at the front
	if (existingTodoList && existingTodoList.todos.length > 0) {
		const todoContext = formatTodoContext(existingTodoList.todos);
		conversationMessages.push({
			role: 'user',
			content: todoContext
		});
	}

	// Add history messages
	conversationMessages.push(
		...messages.filter(msg => msg.role !== 'command').map(msg => ({
			role: msg.role as 'user' | 'assistant',
			content: msg.content,
			images: msg.images
		}))
	);

	// Add current user message
	conversationMessages.push({
		role: 'user',
		content: userContent,
		images: imageContents
	});

	// Save user message (directly save API format message)
	saveMessage({
		role: 'user',
		content: userContent,
		images: imageContents
	}).catch(error => {
		console.error('Failed to save user message:', error);
	});

	// Initialize token encoder
	let encoder;
	try {
		encoder = encoding_for_model('gpt-4');
	} catch (e) {
		encoder = encoding_for_model('gpt-3.5-turbo');
	}
	setStreamTokenCount(0);

	const config = getOpenAiConfig();
	const model = options.useBasicModel
		? (config.basicModel || config.advancedModel || 'gpt-4.1')
		: (config.advancedModel || 'gpt-4.1');

	// Tool calling loop (no limit on rounds)
	let finalAssistantMessage: Message | null = null;

	// Local set to track approved tools in this conversation (solves async setState issue)
	const sessionApprovedTools = new Set<string>();

	try {
		while (true) {
			if (controller.signal.aborted) break;

			let streamedContent = '';
			let receivedToolCalls: ToolCall[] | undefined;

			// Stream AI response - choose API based on config
			let toolCallAccumulator = ''; // Accumulate tool call deltas for token counting
			let reasoningAccumulator = ''; // Accumulate reasoning summary deltas for token counting (Responses API only)

			// Get or create session for cache key
			const currentSession = sessionManager.getCurrentSession();
			// Use session ID as cache key to ensure same session requests share cache
			const cacheKey = currentSession?.id;

			const streamGenerator = config.requestMethod === 'responses'
				? createStreamingResponse({
					model,
					messages: conversationMessages,
					temperature: 0,
					tools: mcpTools.length > 0 ? mcpTools : undefined,
					prompt_cache_key: cacheKey // Use session ID as cache key
				}, controller.signal)
				: createStreamingChatCompletion({
					model,
					messages: conversationMessages,
					temperature: 0,
					tools: mcpTools.length > 0 ? mcpTools : undefined
				}, controller.signal);

			for await (const chunk of streamGenerator) {
				if (controller.signal.aborted) break;

				if (chunk.type === 'content' && chunk.content) {
					// Accumulate content and update token count
					streamedContent += chunk.content;
					try {
						const tokens = encoder.encode(streamedContent + toolCallAccumulator + reasoningAccumulator);
						setStreamTokenCount(tokens.length);
					} catch (e) {
						// Ignore encoding errors
					}
				} else if (chunk.type === 'tool_call_delta' && chunk.delta) {
					// Accumulate tool call deltas and update token count in real-time
					toolCallAccumulator += chunk.delta;
					try {
						const tokens = encoder.encode(streamedContent + toolCallAccumulator + reasoningAccumulator);
						setStreamTokenCount(tokens.length);
					} catch (e) {
						// Ignore encoding errors
					}
				} else if (chunk.type === 'reasoning_delta' && chunk.delta) {
					// Accumulate reasoning summary deltas for token counting (Responses API only)
					// Note: reasoning content is NOT sent back to AI, only counted for display
					reasoningAccumulator += chunk.delta;
					try {
						const tokens = encoder.encode(streamedContent + toolCallAccumulator + reasoningAccumulator);
						setStreamTokenCount(tokens.length);
					} catch (e) {
						// Ignore encoding errors
					}
				} else if (chunk.type === 'tool_calls' && chunk.tool_calls) {
					receivedToolCalls = chunk.tool_calls;
				} else if (chunk.type === 'usage' && chunk.usage) {
					// Capture usage information
					setContextUsage(chunk.usage);
				}
			}

			// Reset token count after stream ends
			setStreamTokenCount(0);

			// If aborted during streaming, exit the loop
			// (discontinued message already added by ChatScreen ESC handler)
			if (controller.signal.aborted) {
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
							arguments: tc.function.arguments
						}
					}))
				} as any;
				conversationMessages.push(assistantMessage);

				// Save assistant message with tool calls
				saveMessage(assistantMessage).catch(error => {
					console.error('Failed to save assistant message:', error);
				});

				// Display tool calls in UI with pending status
				for (const toolCall of receivedToolCalls) {
					const toolDisplay = formatToolCallMessage(toolCall);
					let toolArgs;
					try {
						toolArgs = JSON.parse(toolCall.function.arguments);
					} catch (e) {
						toolArgs = {};
					}

					setMessages(prev => [...prev, {
						role: 'assistant',
						content: `⚡ ${toolDisplay.toolName}`,
						streaming: false,
						toolCall: {
							name: toolCall.function.name,
							arguments: toolArgs
						},
						toolDisplay,
						toolCallId: toolCall.id, // Store tool call ID for later update
						toolPending: true // Mark as pending execution
					}]);
				}

				// Filter tools that need confirmation (not in always-approved list OR session-approved list)
				const toolsNeedingConfirmation: ToolCall[] = [];
				const autoApprovedTools: ToolCall[] = [];

				for (const toolCall of receivedToolCalls) {
					// Check both global approved list and session-approved list
					if (isToolAutoApproved(toolCall.function.name) || sessionApprovedTools.has(toolCall.function.name)) {
						autoApprovedTools.push(toolCall);
					} else {
						toolsNeedingConfirmation.push(toolCall);
					}
				}

				// Request confirmation only once for all tools needing confirmation
				let approvedTools: ToolCall[] = [...autoApprovedTools];

				// In YOLO mode, auto-approve all tools
				if (yoloMode) {
					approvedTools.push(...toolsNeedingConfirmation);
				} else if (toolsNeedingConfirmation.length > 0) {
					// Show all tools needing confirmation as a batch
					const toolNames = toolsNeedingConfirmation.map(t => t.function.name).join(', ');
					const firstTool = toolsNeedingConfirmation[0]!; // Safe: length > 0 guarantees this exists

					// Use first tool for confirmation UI, but apply result to all
					const confirmation = await requestToolConfirmation(firstTool, toolNames);

					if (confirmation === 'reject') {
						// User rejected - end conversation
						setMessages(prev => [...prev, {
							role: 'assistant',
							content: 'Tool call rejected, session ended',
							streaming: false
						}]);

						// End streaming
						encoder.free();
						return; // Exit the conversation loop
					}

					// If approved_always, add ALL these tools to both global and session-approved sets
					if (confirmation === 'approve_always') {
						const toolNamesToAdd = toolsNeedingConfirmation.map(t => t.function.name);
						// Add to global state (async, for future sessions)
						addMultipleToAlwaysApproved(toolNamesToAdd);
						// Add to local session set (sync, for this conversation)
						toolNamesToAdd.forEach(name => sessionApprovedTools.add(name));
					}

					// Add all tools to approved list
					approvedTools.push(...toolsNeedingConfirmation);
				}

				// Execute approved tools
				const toolResults = await executeToolCalls(approvedTools);

				// Check if there are TODO related tool calls, if yes refresh TODO list
				// Only show TODO panel for todo-get and todo-update, not for todo-create or todo-add
				const shouldShowTodoPanel = approvedTools.some(t =>
					t.function.name === 'todo-get' || t.function.name === 'todo-update'
				);
				const hasTodoTools = approvedTools.some(t => t.function.name.startsWith('todo-'));

				if (hasTodoTools) {
					const session = sessionManager.getCurrentSession();
					if (session) {
						const updatedTodoList = await todoService.getTodoList(session.id);
						if (updatedTodoList) {
							setCurrentTodos(updatedTodoList.todos);

							// Only show TODO panel for get/update operations
							if (shouldShowTodoPanel) {
								// Remove any existing TODO tree messages and add a new one
								setMessages(prev => {
									// Filter out previous TODO tree messages
									const withoutTodoTree = prev.filter(m => !m.showTodoTree);
									// Add new TODO tree message
									return [...withoutTodoTree, {
										role: 'assistant',
										content: '[TODO List Updated]',
										streaming: false,
										showTodoTree: true
									}];
								});
							}
						}
					}
				}

				// Update existing tool call messages with results
				for (const result of toolResults) {
					const toolCall = receivedToolCalls.find(tc => tc.id === result.tool_call_id);
					if (toolCall) {
						const isError = result.content.startsWith('Error:');
						const statusIcon = isError ? '✗' : '✓';
						const statusText = isError ? `\n  └─ ${result.content}` : '';

						// Check if this is an edit tool with diff data
						let editDiffData: {oldContent?: string; newContent?: string; filename?: string} | undefined;
						if (toolCall.function.name === 'filesystem-edit' && !isError) {
							try {
								const resultData = JSON.parse(result.content);
								if (resultData.oldContent && resultData.newContent) {
									editDiffData = {
										oldContent: resultData.oldContent,
										newContent: resultData.newContent,
										filename: JSON.parse(toolCall.function.arguments).filePath
									};
								}
							} catch (e) {
								// If parsing fails, just show regular result
							}
						}

						// Check if this is a terminal execution result
						let terminalResultData: {stdout?: string; stderr?: string; exitCode?: number; command?: string} | undefined;
						if (toolCall.function.name === 'terminal-execute' && !isError) {
							try {
								const resultData = JSON.parse(result.content);
								if (resultData.command !== undefined) {
									terminalResultData = {
										stdout: resultData.stdout || '',
										stderr: resultData.stderr || '',
										exitCode: resultData.exitCode || 0,
										command: resultData.command
									};
								}
							} catch (e) {
								// If parsing fails, just show regular result
							}
						}

						// Update the existing pending message instead of adding a new one
						setMessages(prev => prev.map(msg => {
							if (msg.toolCallId === toolCall.id && msg.toolPending) {
								return {
									...msg,
									content: `${statusIcon} ${toolCall.function.name}${statusText}`,
									toolPending: false,
									toolCall: editDiffData ? {
										name: toolCall.function.name,
										arguments: editDiffData
									} : terminalResultData ? {
										name: toolCall.function.name,
										arguments: terminalResultData
									} : msg.toolCall,
									// Store tool result for preview rendering
									toolResult: !isError ? result.content : undefined
								};
							}
							return msg;
						}));
					}

					// Add tool result to conversation history and save
					conversationMessages.push(result as any);
					saveMessage(result).catch(error => {
						console.error('Failed to save tool result:', error);
					});
				}

				// Check if there are pending user messages to insert
				if (options.getPendingMessages && options.clearPendingMessages) {
					const pendingMessages = options.getPendingMessages();
					if (pendingMessages.length > 0) {
						// Clear pending messages
						options.clearPendingMessages();

						// Combine multiple pending messages into one
						const combinedMessage = pendingMessages.join('\n\n');

						// Add user message to UI
						const userMessage: Message = { role: 'user', content: combinedMessage };
						setMessages(prev => [...prev, userMessage]);

						// Add user message to conversation history
						conversationMessages.push({
							role: 'user',
							content: combinedMessage
						});

						// Save user message
						saveMessage({
							role: 'user',
							content: combinedMessage
						}).catch(error => {
							console.error('Failed to save pending user message:', error);
						});
					}
				}

				// Continue loop to get next response
				continue;
			}

			// No tool calls - display text content if any
			if (streamedContent.trim()) {
				finalAssistantMessage = {
					role: 'assistant',
					content: streamedContent.trim(),
					streaming: false,
					discontinued: controller.signal.aborted
				};
				setMessages(prev => [...prev, finalAssistantMessage!]);

				// Add to conversation history and save
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: streamedContent.trim()
				};
				conversationMessages.push(assistantMessage);
				saveMessage(assistantMessage).catch(error => {
					console.error('Failed to save assistant message:', error);
				});
			}

			// Conversation complete
			break;
		}

		// Free encoder
		encoder.free();
	} catch (error) {
		encoder.free();
		throw error;
	}
}
