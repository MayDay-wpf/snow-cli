import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, Static, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import { encoding_for_model } from 'tiktoken';
import ChatInput from '../components/ChatInput.js';
import { type Message } from '../components/MessageList.js';
import PendingMessages from '../components/PendingMessages.js';
import SessionListScreen from '../components/SessionListScreen.js';
import MCPInfoPanel from '../components/MCPInfoPanel.js';
import MarkdownRenderer from '../components/MarkdownRenderer.js';
import ToolConfirmation, { type ConfirmationResult } from '../components/ToolConfirmation.js';
import DiffViewer from '../components/DiffViewer.js';
import ToolResultPreview from '../components/ToolResultPreview.js';
import TodoTree from '../components/TodoTree.js';
import { createStreamingChatCompletion, type ChatMessage } from '../../api/chat.js';
import { createStreamingResponse } from '../../api/responses.js';
import { SYSTEM_PROMPT } from '../../api/systemPrompt.js';
import { collectAllMCPTools, getTodoService } from '../../utils/mcpToolsManager.js';
import { executeToolCalls, type ToolCall } from '../../utils/toolExecutor.js';
import { getOpenAiConfig } from '../../utils/apiConfig.js';
import { sessionManager } from '../../utils/sessionManager.js';
import { useSessionSave } from '../../hooks/useSessionSave.js';
import { parseAndValidateFileReferences, createMessageWithFileInstructions } from '../../utils/fileUtils.js';
import { formatTodoContext } from '../../utils/todoPreprocessor.js';
// Import commands to register them
import '../../utils/commands/clear.js';
import '../../utils/commands/resume.js';
import '../../utils/commands/mcp.js';
import '../../utils/commands/home.js';
import '../../utils/commands/yolo.js';
import { navigateTo } from '../../hooks/useGlobalNavigation.js';

type Props = {};

type MCPInfoScreenProps = {
	onClose: () => void;
	panelKey: number;
};

function MCPInfoScreen({ onClose, panelKey }: MCPInfoScreenProps) {
	useEffect(() => {
		process.stdout.write('\x1B[?1049h');
		process.stdout.write('\x1B[2J');
		process.stdout.write('\x1B[H');
		return () => {
			process.stdout.write('\x1B[2J');
			process.stdout.write('\x1B[?1049l');
		};
	}, []);

	useInput((_, key) => {
		if (key.escape) {
			onClose();
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1} borderStyle="double" paddingX={2} paddingY={1} borderColor={'cyan'}>
				<Box flexDirection="column">
					<Text color="white" bold>
						<Text color="cyan">❆ </Text>
						MCP Services Overview
					</Text>
					<Text color="gray" dimColor>
						Press ESC to return to the chat
					</Text>
				</Box>
			</Box>
			<MCPInfoPanel key={panelKey} />
		</Box>
	);
}

type SessionListScreenWrapperProps = {
	onBack: () => void;
	onSelectSession: (sessionId: string) => void;
};

function SessionListScreenWrapper({ onBack, onSelectSession }: SessionListScreenWrapperProps) {
	useEffect(() => {
		process.stdout.write('\x1B[?1049h');
		process.stdout.write('\x1B[2J');
		process.stdout.write('\x1B[H');
		return () => {
			process.stdout.write('\x1B[2J');
			process.stdout.write('\x1B[?1049l');
		};
	}, []);

	return (
		<SessionListScreen
			onBack={onBack}
			onSelectSession={onSelectSession}
		/>
	);
}

export default function ChatScreen({ }: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [currentTodos, setCurrentTodos] = useState<Array<{id: string; content: string; status: 'pending' | 'in_progress' | 'completed'}>>([]);
	const [animationFrame, setAnimationFrame] = useState(0);
	const [abortController, setAbortController] = useState<AbortController | null>(null);
	const [pendingMessages, setPendingMessages] = useState<string[]>([]);
	const [showSessionList, setShowSessionList] = useState(false);
	const [remountKey, setRemountKey] = useState(0);
	const [showMcpInfo, setShowMcpInfo] = useState(false);
	const [mcpPanelKey, setMcpPanelKey] = useState(0);
	const [streamTokenCount, setStreamTokenCount] = useState(0);
	const [pendingToolConfirmation, setPendingToolConfirmation] = useState<{
		tool: ToolCall;
		batchToolNames?: string;
		resolve: (result: ConfirmationResult) => void;
	} | null>(null);
	const [alwaysApprovedTools, setAlwaysApprovedTools] = useState<Set<string>>(new Set());
	const [yoloMode, setYoloMode] = useState(false);
	const { stdout } = useStdout();
	const workingDirectory = process.cwd();

	// Use session save hook
	const { saveMessage, clearSavedMessages, initializeFromSession } = useSessionSave();

	// Animation for streaming/saving indicator - only update when actually showing
	useEffect(() => {
		if (!isStreaming && !isSaving) return;

		const interval = setInterval(() => {
			setAnimationFrame(prev => (prev + 1) % 5);
		}, 300);

		return () => {
			clearInterval(interval);
			setAnimationFrame(0);
		};
	}, [isStreaming, isSaving]);

	// Auto-send pending messages when streaming stops
	useEffect(() => {
		if (!isStreaming && pendingMessages.length > 0) {
			// Use setTimeout to ensure state updates are complete
			const timer = setTimeout(() => {
				processPendingMessages();
			}, 100);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [isStreaming, pendingMessages.length]);

	// ESC key handler to interrupt streaming or close overlays
	useInput((_, key) => {
		if (showMcpInfo) {
			if (key.escape) {
				setShowMcpInfo(false);
			}
			return;
		}

		if (key.escape && isStreaming && abortController) {
			abortController.abort();

			// Mark the last streaming message as discontinued
			setMessages(prev => {
				const lastMsg = prev[prev.length - 1];
				if (lastMsg && lastMsg.role === 'assistant') {
					return [...prev.slice(0, -1), {
						...lastMsg,
						streaming: false,
						discontinued: true
					}];
				}
				// If no assistant message, add a discontinued message
				return [...prev, {
					role: 'assistant',
					content: '',
					streaming: false,
					discontinued: true
				}];
			});

			setIsStreaming(false);
			setAbortController(null);
		}
	});

	const handleCommandExecution = (commandName: string, result: any) => {
		if (result.success && result.action === 'clear') {
			if (stdout && typeof stdout.write === 'function') {
				stdout.write('\x1B[3J\x1B[2J\x1B[H');
			}
			// Clear current session and start new one
			sessionManager.clearCurrentSession();
			clearSavedMessages();
			setMessages([]);
			setRemountKey(prev => prev + 1); // Force Static to remount
			// Add command execution feedback
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages([commandMessage]);
		} else if (result.success && result.action === 'resume') {
			// Show session list screen
			setShowSessionList(true);
		} else if (result.success && result.action === 'showMcpInfo') {
			setShowMcpInfo(true);
			setMcpPanelKey(prev => prev + 1);
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages(prev => [...prev, commandMessage]);
		} else if (result.success && result.action === 'goHome') {
			// Navigate back to welcome screen
			navigateTo('welcome');
		} else if (result.success && result.action === 'toggleYolo') {
			// Toggle YOLO mode
			setYoloMode(prev => !prev);
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages(prev => [...prev, commandMessage]);
		}
	};

	const handleSessionSelect = async (sessionId: string) => {
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				// Session 使用 API 格式存储，需要转换为 UI Message 格式
				const uiMessages: Message[] = [];

				for (const msg of session.messages) {
					// 跳过 system 消息
					if (msg.role === 'system') continue;

					// 处理 tool 角色消息（工具执行结果）
					if (msg.role === 'tool') {
						const isError = msg.content.startsWith('Error:');
						const statusIcon = isError ? '✗' : '✓';
						const statusText = isError ? `\n  └─ ${msg.content}` : '';
						const toolName = msg.tool_call_id || 'unknown-tool';

						uiMessages.push({
							role: 'assistant',
							content: `${statusIcon} ${toolName}${statusText}`,
							streaming: false,
							toolResult: !isError ? msg.content : undefined
						});
						continue;
					}

					// 处理 user 和 assistant 消息
					const uiMessage: Message = {
						role: msg.role as 'user' | 'assistant',
						content: msg.content,
						streaming: false,
						images: msg.images
					};

					// 如果 assistant 消息有 tool_calls，需要展开显示每个工具调用
					if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
						for (const toolCall of msg.tool_calls) {
							const toolDisplay = formatToolCallMessage(toolCall as any);
							let toolArgs;
							try {
								toolArgs = JSON.parse(toolCall.function.arguments);
							} catch (e) {
								toolArgs = {};
							}

							uiMessages.push({
								role: 'assistant',
								content: `⚡ ${toolDisplay.toolName}`,
								streaming: false,
								toolCall: {
									name: toolCall.function.name,
									arguments: toolArgs
								},
								toolDisplay
							});
						}
					} else {
						// 普通消息直接添加
						uiMessages.push(uiMessage);
					}
				}

				setMessages(uiMessages);
				setPendingMessages([]);
				setIsStreaming(false);
				setShowSessionList(false);
				setRemountKey(prev => prev + 1);

				// Initialize session save hook with loaded API messages
				initializeFromSession(session.messages);
			}
		} catch (error) {
			console.error('Failed to load session:', error);
		}
	};

	const handleBackFromSessionList = () => {
		setShowSessionList(false);
	};

	const handleHistorySelect = (selectedIndex: number, _message: string) => {
		// Truncate messages array to remove the selected user message and everything after it
		// Only keep messages before the selected message (exclude the selected message itself)
		setMessages(prev => prev.slice(0, selectedIndex));

		// Clear saved messages cache to ensure session is updated correctly
		clearSavedMessages();

		// Force remount of Static component to clear displayed messages
		setRemountKey(prev => prev + 1);
	};

	const handleMessageSubmit = async (message: string, images?: Array<{data: string, mimeType: string}>) => {
		// If streaming, add to pending messages instead of sending immediately
		if (isStreaming) {
			setPendingMessages(prev => [...prev, message]);
			return;
		}

		// Process the message normally
		await processMessage(message, images);
	};

	const processMessage = async (message: string, images?: Array<{data: string, mimeType: string}>) => {
		// Parse and validate file references
		const { cleanContent, validFiles } = await parseAndValidateFileReferences(message);

		// Separate image files from regular files
		const imageFiles = validFiles.filter(f => f.isImage && f.imageData && f.mimeType);
		const regularFiles = validFiles.filter(f => !f.isImage);

		// Convert image files to image content format
		const imageContents = [
			...(images || []).map(img => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType })),
			...imageFiles.map(f => ({ type: 'image' as const, data: f.imageData!, mimeType: f.mimeType! }))
		];

		const userMessage: Message = {
			role: 'user',
			content: cleanContent,
			files: validFiles.length > 0 ? validFiles : undefined,
			images: imageContents.length > 0 ? imageContents : undefined
		};
		setMessages(prev => [...prev, userMessage]);
		setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		try {
			// Start conversation with tool support (user message will be saved inside)
			await handleConversationWithTools(cleanContent, regularFiles, imageContents, controller);

		} catch (error) {
			if (controller.signal.aborted) {
				return;
			}

			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			const finalMessage: Message = {
				role: 'assistant',
				content: `Error: ${errorMessage}`,
				streaming: false
			};
			setMessages(prev => [...prev, finalMessage]);

			// End streaming and start saving
			setIsStreaming(false);
			setAbortController(null);
			setStreamTokenCount(0);

			// Save error message
			setIsSaving(true);
			try {
				// Message already saved via conversationMessages
			} finally {
				setIsSaving(false);
			}
		}
	};

	// Helper function to format tool call display
	const formatToolCallMessage = (toolCall: ToolCall): {toolName: string; args: Array<{key: string; value: string; isLast: boolean}>} => {
		try {
			const args = JSON.parse(toolCall.function.arguments);
			const argEntries = Object.entries(args);
			const formattedArgs: Array<{key: string; value: string; isLast: boolean}> = [];

			if (argEntries.length > 0) {
				argEntries.forEach(([key, value], idx, arr) => {
					const valueStr = typeof value === 'string'
						? value.length > 60 ? `"${value.slice(0, 60)}..."` : `"${value}"`
						: JSON.stringify(value);
					formattedArgs.push({
						key,
						value: valueStr,
						isLast: idx === arr.length - 1
					});
				});
			}

			return {
				toolName: toolCall.function.name,
				args: formattedArgs
			};
		} catch (e) {
			return {
				toolName: toolCall.function.name,
				args: []
			};
		}
	};

	// Request user confirmation for tool execution
	const requestToolConfirmation = async (toolCall: ToolCall, batchToolNames?: string): Promise<ConfirmationResult> => {
		// Wait for user confirmation
		return new Promise<ConfirmationResult>((resolve) => {
			setPendingToolConfirmation({
				tool: toolCall,
				batchToolNames,
				resolve: (result: ConfirmationResult) => {
					setPendingToolConfirmation(null);
					resolve(result);
				}
			});
		});
	};

	// New simplified conversation handler with tool support
	const handleConversationWithTools = async (userContent: string, validFiles: any[], imageContents: Array<{type: 'image', data: string, mimeType: string}> | undefined, controller: AbortController) => {
		// Create message for AI with file read instructions
		const messageForAI = createMessageWithFileInstructions(userContent, validFiles);

		// Step 1: 确保会话已创建并获取现有 TODO
		let currentSession = sessionManager.getCurrentSession();
		if (!currentSession) {
			currentSession = await sessionManager.createNewSession();
		}
		const todoService = getTodoService();

		// 获取现有的 TODO List
		const existingTodoList = await todoService.getTodoList(currentSession.id);

		// 更新 UI 状态
		if (existingTodoList) {
			setCurrentTodos(existingTodoList.todos);
		}

		// Collect all MCP tools
		const mcpTools = await collectAllMCPTools();

		// Build conversation history with TODO context as pinned user message
		let conversationMessages: ChatMessage[] = [
			{ role: 'system', content: SYSTEM_PROMPT }
		];

		// 如果有 TODO,在最前面添加置顶的上下文消息
		if (existingTodoList && existingTodoList.todos.length > 0) {
			const todoContext = formatTodoContext(existingTodoList.todos);
			conversationMessages.push({
				role: 'user',
				content: todoContext
			});
		}

		// 添加历史消息
		conversationMessages.push(
			...messages.filter(msg => msg.role !== 'command').map(msg => ({
				role: msg.role as 'user' | 'assistant',
				content: msg.content,
				images: msg.images
			}))
		);

		// 添加当前用户消息
		conversationMessages.push({
			role: 'user',
			content: messageForAI,
			images: imageContents
		});

		// Save user message (直接保存 API 格式的消息)
		saveMessage({
			role: 'user',
			content: messageForAI,
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
		const model = config.advancedModel || 'gpt-4.1';

		// Tool calling loop (no limit on rounds)
		let finalAssistantMessage: Message | null = null;
		// Track approved tools within this conversation to handle state update delays
		let currentlyApprovedTools = new Set(alwaysApprovedTools);

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
				// 使用会话 ID 作为缓存键，确保同一会话的请求共享缓存
				const cacheKey = currentSession?.id;

				const streamGenerator = config.requestMethod === 'responses'
					? createStreamingResponse({
						model,
						messages: conversationMessages,
						temperature: 0,
						tools: mcpTools.length > 0 ? mcpTools : undefined,
						prompt_cache_key: cacheKey // 使用会话 ID 作为缓存键
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
					}
				}

				// Reset token count after stream ends
				setStreamTokenCount(0);

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

					// Display tool calls in UI
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
							toolDisplay
						}]);
					}

					// Filter tools that need confirmation (not in always-approved list)
					// TODO tools are always auto-approved
					const toolsNeedingConfirmation: ToolCall[] = [];
					const autoApprovedTools: ToolCall[] = [];

					for (const toolCall of receivedToolCalls) {
						const isTodoTool = toolCall.function.name.startsWith('todo-');
						if (currentlyApprovedTools.has(toolCall.function.name) || isTodoTool) {
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
							setIsStreaming(false);
							setAbortController(null);
							setStreamTokenCount(0);
							encoder.free();
							return; // Exit the conversation loop
						}

						// If approved_always, add ALL these tools to the always-approved set
						if (confirmation === 'approve_always') {
							const newApprovedTools = new Set(alwaysApprovedTools);
							for (const tool of toolsNeedingConfirmation) {
								newApprovedTools.add(tool.function.name);
								// Also update local tracking for immediate effect
								currentlyApprovedTools.add(tool.function.name);
							}
							setAlwaysApprovedTools(newApprovedTools);
						}

						// Add all tools to approved list
						approvedTools.push(...toolsNeedingConfirmation);
					}

					// Execute approved tools
					const toolResults = await executeToolCalls(approvedTools);

					// 检查是否有 TODO 相关的工具调用,如果有则刷新 TODO 列表
					const hasTodoTools = approvedTools.some(t => t.function.name.startsWith('todo-'));
					if (hasTodoTools) {
						const session = sessionManager.getCurrentSession();
						if (session) {
							const updatedTodoList = await todoService.getTodoList(session.id);
							if (updatedTodoList) {
								setCurrentTodos(updatedTodoList.todos);
								// 在消息流中显示更新后的 TODO
								setMessages(prev => [...prev, {
									role: 'assistant',
									content: '[TODO List Updated]',
									streaming: false,
									showTodoTree: true
								}]);
							}
						}
					}

					// Display results and add to conversation
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

							setMessages(prev => [...prev, {
								role: 'assistant',
								content: `${statusIcon} ${toolCall.function.name}${statusText}`,
								streaming: false,
								toolCall: editDiffData ? {
									name: toolCall.function.name,
									arguments: editDiffData
								} : terminalResultData ? {
									name: toolCall.function.name,
									arguments: terminalResultData
								} : undefined,
								// Store tool result for preview rendering
								toolResult: !isError ? result.content : undefined
							}]);
						}

						// Add tool result to conversation history and save
						conversationMessages.push(result as any);
						saveMessage(result).catch(error => {
							console.error('Failed to save tool result:', error);
						});
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

			// End streaming and start saving
			setIsStreaming(false);
			setAbortController(null);
			setStreamTokenCount(0);

			// Save the final assistant message
			if (!controller.signal.aborted && finalAssistantMessage) {
				setIsSaving(true);
				try {
					// Message already saved via conversationMessages
				} finally {
					setIsSaving(false);
				}
			}
		} catch (error) {
			encoder.free();
			throw error;
		}
	};

	const processPendingMessages = async () => {
		if (pendingMessages.length === 0) return;

		// Get current pending messages and clear them immediately to prevent infinite loop
		const messagesToProcess = [...pendingMessages];
		setPendingMessages([]);

		// Combine multiple pending messages into one
		const combinedMessage = messagesToProcess.join('\n\n');

		// Add user message to chat
		const userMessage: Message = { role: 'user', content: combinedMessage };
		setMessages(prev => [...prev, userMessage]);

		// Start streaming response (without calling processMessage to avoid recursion)
		setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		// Save user message (API 格式)
		saveMessage({
			role: 'user',
			content: combinedMessage
		}).catch(error => {
			console.error('Failed to save user message:', error);
		});

		try {
			const config = getOpenAiConfig();

			// Check if request method is responses (not yet implemented)
			if (config.requestMethod === 'responses') {
				const finalMessage: Message = {
					role: 'assistant',
					content: 'Responses API is not yet implemented. Please use "Chat Completions" method in API settings.',
					streaming: false
				};
				setMessages(prev => [...prev, finalMessage]);
				// Message already saved via conversationMessages
				return;
			}

			// Use the same conversation handler (no file references for pending messages)
			await handleConversationWithTools(combinedMessage, [], undefined, controller);

		} catch (error) {
			if (controller.signal.aborted) {
				return;
			}

			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			const finalMessage: Message = {
				role: 'assistant',
				content: `Error: ${errorMessage}`,
				streaming: false
			};
			setMessages(prev => [...prev, finalMessage]);

			// End streaming and start saving
			setIsStreaming(false);
			setAbortController(null);
			setStreamTokenCount(0);

			// Save error message
			setIsSaving(true);
			try {
				// Message already saved via conversationMessages
			} finally {
				setIsSaving(false);
			}
		}
	};


	// If showing session list, only render that - don't render chat at all
	if (showSessionList) {
		return (
			<SessionListScreenWrapper
				onBack={handleBackFromSessionList}
				onSelectSession={handleSessionSelect}
			/>
		);
	}

	if (showMcpInfo) {
		return (
			<MCPInfoScreen
				onClose={() => setShowMcpInfo(false)}
				panelKey={mcpPanelKey}
			/>
		);
	}

	return (
		<Box flexDirection="column">
			<Static key={remountKey} items={[
				<Box key="header" marginX={1} borderColor={'cyan'} borderStyle="round" paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Text color="white" bold>
							<Text color="cyan">❆ </Text>
							<Gradient name="rainbow">Programming efficiency x10!</Gradient>
							<Text color="white"> ⛇</Text>
						</Text>
						<Text color="gray" dimColor>
							• Ask for code explanations and debugging help
						</Text>
						<Text color="gray" dimColor>
							• Press ESC during response to interrupt
						</Text>
						<Text color="gray" dimColor>
							• Working directory: {workingDirectory}
						</Text>
					</Box>
				</Box>,
				...messages.filter(m => !m.streaming).map((message, index) => {
						// Determine tool message type and color
						let toolStatusColor: string = 'cyan'; // default for normal assistant messages
						let isToolMessage = false;

						if (message.role === 'assistant') {
							if (message.content.startsWith('⚡')) {
								// Tool executing
								isToolMessage = true;
								toolStatusColor = 'yellowBright';
							} else if (message.content.startsWith('✓')) {
								// Tool success
								isToolMessage = true;
								toolStatusColor = 'green';
							} else if (message.content.startsWith('✗')) {
								// Tool failed
								isToolMessage = true;
								toolStatusColor = 'red';
							} else {
								// Normal assistant response (after tools complete)
								toolStatusColor = 'blue';
							}
						}

						return (
							<Box key={`msg-${index}`} marginBottom={isToolMessage ? 0 : 1} marginX={1} flexDirection="column">
								<Box>
									<Text color={
											message.role === 'user' ? 'green' :
											message.role === 'command' ? 'gray' : toolStatusColor
										} bold>
											{message.role === 'user' ? '⛇' : message.role === 'command' ? '⌘' : '❆'}
										</Text>
										<Box marginLeft={1} marginBottom={1} flexDirection="column">
											{message.role === 'command' ? (
												<Text color="gray" dimColor>
													  └─ {message.commandName}
												</Text>
											) : message.showTodoTree ? (
												<TodoTree todos={currentTodos} />
											) : (
												<>
													<MarkdownRenderer
														content={message.content || ' '}
														color={
															message.role === 'user' ? 'gray' :
															isToolMessage ? (
																message.content.startsWith('⚡') ? 'yellow' :
																message.content.startsWith('✓') ? 'green' : 'red'
															) : undefined
														}
													/>
											{message.toolDisplay && message.toolDisplay.args.length > 0 && (
												<Box flexDirection="column">
													{message.toolDisplay.args.map((arg, argIndex) => (
														<Text key={argIndex} color="gray" dimColor>
															{arg.isLast ? '└─' : '├─'} {arg.key}: {arg.value}
														</Text>
													))}
												</Box>
											)}
													{message.toolCall && (message.toolCall.name === 'filesystem-create' || message.toolCall.name === 'filesystem-write') && message.toolCall.arguments.content && (
															<Box marginTop={1}>
																<DiffViewer
																	newContent={message.toolCall.arguments.content}
																	filename={message.toolCall.arguments.path}
																	maxLines={50}
																/>
															</Box>
														)}
											{message.toolCall && message.toolCall.name === 'filesystem-edit' && message.toolCall.arguments.oldContent && message.toolCall.arguments.newContent && (
													<Box marginTop={1}>
														<DiffViewer
															oldContent={message.toolCall.arguments.oldContent}
															newContent={message.toolCall.arguments.newContent}
															filename={message.toolCall.arguments.filename}
															maxLines={50}
														/>
													</Box>
											)}
											{/* Show terminal execution result */}
											{message.toolCall && message.toolCall.name === 'terminal-execute' && message.toolCall.arguments.command && (
												<Box marginTop={1} flexDirection="column">
													<Text color="gray" dimColor>└─ Command: <Text color="white">{message.toolCall.arguments.command}</Text></Text>
													<Text color="gray" dimColor>└─ Exit Code: <Text color={message.toolCall.arguments.exitCode === 0 ? 'green' : 'red'}>{message.toolCall.arguments.exitCode}</Text></Text>
													{message.toolCall.arguments.stdout && message.toolCall.arguments.stdout.trim().length > 0 && (
														<Box flexDirection="column" marginTop={1}>
															<Text color="green" dimColor>└─ stdout:</Text>
															<Box paddingLeft={2}>
																<Text color="white">{message.toolCall.arguments.stdout.trim().split('\n').slice(0, 20).join('\n')}</Text>
																{message.toolCall.arguments.stdout.trim().split('\n').length > 20 && (
																	<Text color="gray" dimColor>... (output truncated)</Text>
																)}
															</Box>
														</Box>
													)}
													{message.toolCall.arguments.stderr && message.toolCall.arguments.stderr.trim().length > 0 && (
														<Box flexDirection="column" marginTop={1}>
															<Text color="red" dimColor>└─ stderr:</Text>
															<Box paddingLeft={2}>
																<Text color="red">{message.toolCall.arguments.stderr.trim().split('\n').slice(0, 10).join('\n')}</Text>
																{message.toolCall.arguments.stderr.trim().split('\n').length > 10 && (
																	<Text color="gray" dimColor>... (output truncated)</Text>
																)}
															</Box>
														</Box>
													)}
												</Box>
											)}
											{/* Show tool result preview for successful tool executions (except edit and bash which have their own views) */}
											{message.content.startsWith('✓') && message.toolResult && !message.toolCall && (
												<ToolResultPreview
													toolName={message.content.replace('✓ ', '').split('\n')[0] || ''}
													result={message.toolResult}
													maxLines={5}
												/>
											)}
													{message.files && message.files.length > 0 && (
														<Box marginTop={1} flexDirection="column">
															{message.files.map((file, fileIndex) => (
																<Text key={fileIndex} color="blue" dimColor>
																	  └─ Read `{file.path}`{file.exists ? ` (total line ${file.lineCount})` : ' (file not found)'}
																</Text>
															))}
														</Box>
													)}
													{message.discontinued && (
														<Text color="red" bold>
															  └─ user discontinue
														</Text>
													)}
												</>
											)}
										</Box>
									</Box>
								</Box>
						);
					})
					]}>
						{(item) => item}
					</Static>

					{/* Show loading indicator when streaming or saving, but hide during tool confirmation */}
					{(isStreaming || isSaving) && !pendingToolConfirmation && (
						<Box marginBottom={1} marginX={1}>
							<Text color={(['#FF6EBF', 'green', 'blue', 'cyan', '#B588F8'][animationFrame] as any)} bold>
								❆
							</Text>
							<Box marginLeft={1} marginBottom={1}>
								<Text color="gray" dimColor>
									{isStreaming ? 'Thinking...' : 'Create the first dialogue record file...'}
									{isStreaming && streamTokenCount > 0 && (
										<Text color="cyan">
											{' '}(↓ {streamTokenCount >= 1000
												? `${(streamTokenCount / 1000).toFixed(1)}k`
												: streamTokenCount} tokens)
										</Text>
									)}
								</Text>
							</Box>
						</Box>
					)}

					<Box marginX={1}>
						<PendingMessages pendingMessages={pendingMessages} />
					</Box>

					{/* Show tool confirmation dialog if pending */}
					{pendingToolConfirmation && (
						<ToolConfirmation
							toolName={pendingToolConfirmation.batchToolNames || pendingToolConfirmation.tool.function.name}
							onConfirm={pendingToolConfirmation.resolve}
						/>
					)}

					{/* Hide input during tool confirmation */}
					{!pendingToolConfirmation && (
						<ChatInput
							onSubmit={handleMessageSubmit}
							onCommand={handleCommandExecution}
							placeholder="Ask me anything about coding..."
							disabled={!!pendingToolConfirmation}
							chatHistory={messages}
							onHistorySelect={handleHistorySelect}
							yoloMode={yoloMode}
						/>
					)}
		</Box>
	);
}
