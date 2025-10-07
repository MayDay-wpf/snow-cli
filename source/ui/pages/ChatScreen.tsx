import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, Static, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import ChatInput from '../components/ChatInput.js';
import { type Message } from '../components/MessageList.js';
import PendingMessages from '../components/PendingMessages.js';
import MCPInfoScreen from '../components/MCPInfoScreen.js';
import SessionListScreenWrapper from '../components/SessionListScreenWrapper.js';
import MarkdownRenderer from '../components/MarkdownRenderer.js';
import ToolConfirmation from '../components/ToolConfirmation.js';
import DiffViewer from '../components/DiffViewer.js';
import ToolResultPreview from '../components/ToolResultPreview.js';
import TodoTree from '../components/TodoTree.js';
import type { UsageInfo } from '../../api/chat.js';
import { getOpenAiConfig } from '../../utils/apiConfig.js';
import { sessionManager } from '../../utils/sessionManager.js';
import { useSessionSave } from '../../hooks/useSessionSave.js';
import { useSessionManagement } from '../../hooks/useSessionManagement.js';
import { useToolConfirmation } from '../../hooks/useToolConfirmation.js';
import { handleConversationWithTools } from '../../hooks/useConversation.js';
import { parseAndValidateFileReferences, createMessageWithFileInstructions, getSystemInfo } from '../../utils/fileUtils.js';
// Import commands to register them
import '../../utils/commands/clear.js';
import '../../utils/commands/resume.js';
import '../../utils/commands/mcp.js';
import '../../utils/commands/yolo.js';
import '../../utils/commands/init.js';
import { navigateTo } from '../../hooks/useGlobalNavigation.js';

type Props = {};

// Format elapsed time to human readable format
function formatElapsedTime(seconds: number): string {
	if (seconds < 60) {
		return `${seconds}s`;
	} else if (seconds < 3600) {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	} else {
		const hours = Math.floor(seconds / 3600);
		const remainingMinutes = Math.floor((seconds % 3600) / 60);
		const remainingSeconds = seconds % 60;
		return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
	}
}

export default function ChatScreen({ }: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [isSaving] = useState(false);
	const [currentTodos, setCurrentTodos] = useState<Array<{id: string; content: string; status: 'pending' | 'in_progress' | 'completed'}>>([]);
	const [animationFrame, setAnimationFrame] = useState(0);
	const [abortController, setAbortController] = useState<AbortController | null>(null);
	const [pendingMessages, setPendingMessages] = useState<string[]>([]);
	const pendingMessagesRef = useRef<string[]>([]);
	const [remountKey, setRemountKey] = useState(0);
	const [showMcpInfo, setShowMcpInfo] = useState(false);
	const [mcpPanelKey, setMcpPanelKey] = useState(0);
	const [streamTokenCount, setStreamTokenCount] = useState(0);
	const [yoloMode, setYoloMode] = useState(false);
	const [contextUsage, setContextUsage] = useState<UsageInfo | null>(null);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [timerStartTime, setTimerStartTime] = useState<number | null>(null);
	const { stdout } = useStdout();
	const workingDirectory = process.cwd();

	// Use session save hook
	const { saveMessage, clearSavedMessages, initializeFromSession } = useSessionSave();

	// Sync pendingMessages to ref for real-time access in callbacks
	useEffect(() => {
		pendingMessagesRef.current = pendingMessages;
	}, [pendingMessages]);

	// Use tool confirmation hook
	const {
		pendingToolConfirmation,
		requestToolConfirmation,
		isToolAutoApproved,
		addMultipleToAlwaysApproved
	} = useToolConfirmation();

	// Use session management hook
	const {
		showSessionList,
		setShowSessionList,
		handleSessionSelect,
		handleBackFromSessionList
	} = useSessionManagement(
		setMessages,
		setPendingMessages,
		setIsStreaming,
		setRemountKey,
		initializeFromSession
	);

	// Animation for streaming/saving indicator
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

	// Timer for tracking request duration
	useEffect(() => {
		if (isStreaming && timerStartTime === null) {
			// Start timer when streaming begins
			setTimerStartTime(Date.now());
			setElapsedSeconds(0);
		} else if (!isStreaming && timerStartTime !== null) {
			// Stop timer when streaming ends
			setTimerStartTime(null);
		}
	}, [isStreaming, timerStartTime]);

	// Update elapsed time every second
	useEffect(() => {
		if (timerStartTime === null) return;

		const interval = setInterval(() => {
			const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
			setElapsedSeconds(elapsed);
		}, 1000);

		return () => clearInterval(interval);
	}, [timerStartTime]);

	// Pending messages are now handled inline during tool execution in useConversation
	// Auto-send pending messages when streaming completely stops (as fallback)
	useEffect(() => {
		if (!isStreaming && pendingMessages.length > 0) {
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
			// Abort the controller
			abortController.abort();

			// Immediately add discontinued message
			setMessages(prev => [...prev, {
				role: 'assistant',
				content: '',
				streaming: false,
				discontinued: true
			}]);

			// Stop streaming state
			setIsStreaming(false);
			setAbortController(null);
			setStreamTokenCount(0);
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
			setRemountKey(prev => prev + 1);
			// Reset context usage (token statistics)
			setContextUsage(null);
			// Add command execution feedback
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages([commandMessage]);
		} else if (result.success && result.action === 'resume') {
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
			navigateTo('welcome');
		} else if (result.success && result.action === 'toggleYolo') {
			setYoloMode(prev => !prev);
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages(prev => [...prev, commandMessage]);
		} else if (result.success && result.action === 'initProject' && result.prompt) {
			// Add command execution feedback
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages(prev => [...prev, commandMessage]);
			// Auto-send the prompt using basicModel, hide the prompt from UI
			processMessage(result.prompt, undefined, true, true);
		}
	};

	const handleHistorySelect = (selectedIndex: number, _message: string) => {
		// Truncate messages array to remove the selected user message and everything after it
		setMessages(prev => prev.slice(0, selectedIndex));
		clearSavedMessages();
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

	const processMessage = async (message: string, images?: Array<{data: string, mimeType: string}>, useBasicModel?: boolean, hideUserMessage?: boolean) => {
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

		// Get system information
		const systemInfo = getSystemInfo();

		// Only add user message to UI if not hidden
		if (!hideUserMessage) {
			const userMessage: Message = {
				role: 'user',
				content: cleanContent,
				files: validFiles.length > 0 ? validFiles : undefined,
				images: imageContents.length > 0 ? imageContents : undefined,
				systemInfo
			};
			setMessages(prev => [...prev, userMessage]);
		}
		setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		try {
			// Create message for AI with file read instructions and system info
			const messageForAI = createMessageWithFileInstructions(cleanContent, regularFiles, systemInfo);

			// Start conversation with tool support
			await handleConversationWithTools({
				userContent: messageForAI,
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
				setContextUsage,
				useBasicModel,
				getPendingMessages: () => pendingMessagesRef.current,
				clearPendingMessages: () => setPendingMessages([])
			});

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
		} finally {
			// End streaming
			setIsStreaming(false);
			setAbortController(null);
			setStreamTokenCount(0);
		}
	};

	const processPendingMessages = async () => {
		if (pendingMessages.length === 0) return;

		// Get current pending messages and clear them immediately
		const messagesToProcess = [...pendingMessages];
		setPendingMessages([]);

		// Combine multiple pending messages into one
		const combinedMessage = messagesToProcess.join('\n\n');

		// Add user message to chat
		const userMessage: Message = { role: 'user', content: combinedMessage };
		setMessages(prev => [...prev, userMessage]);

		// Start streaming response
		setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		// Save user message
		saveMessage({
			role: 'user',
			content: combinedMessage
		}).catch(error => {
			console.error('Failed to save user message:', error);
		});

		try {
			// Use the same conversation handler (no file references for pending messages)
			await handleConversationWithTools({
				userContent: combinedMessage,
				imageContents: undefined,
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
				setContextUsage,
				getPendingMessages: () => pendingMessagesRef.current,
				clearPendingMessages: () => setPendingMessages([])
			});

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
		} finally {
			// End streaming
			setIsStreaming(false);
			setAbortController(null);
			setStreamTokenCount(0);
		}
	};

	// If showing session list, only render that
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
				...messages.filter(m => !m.streaming && !m.toolPending).map((message, index) => {
					// Determine tool message type and color
					let toolStatusColor: string = 'cyan';
					let isToolMessage = false;

					if (message.role === 'assistant') {
						if (message.content.startsWith('⚡')) {
							isToolMessage = true;
							toolStatusColor = 'yellowBright';
						} else if (message.content.startsWith('✓')) {
							isToolMessage = true;
							toolStatusColor = 'green';
						} else if (message.content.startsWith('✗')) {
							isToolMessage = true;
							toolStatusColor = 'red';
						} else {
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
											{/* Show tool result preview for successful tool executions */}
											{message.content.startsWith('✓') && message.toolResult && !message.toolCall && (
												<ToolResultPreview
													toolName={message.content.replace('✓ ', '').split('\n')[0] || ''}
													result={message.toolResult}
													maxLines={5}
												/>
											)}
											{/* System info for user messages */}
											{message.role === 'user' && message.systemInfo && (
												<Box marginTop={1} flexDirection="column">
													<Text color="gray" dimColor>
														└─ Platform: {message.systemInfo.platform}
													</Text>
													<Text color="gray" dimColor>
														└─ Shell: {message.systemInfo.shell}
													</Text>
													<Text color="gray" dimColor>
														└─ Working Directory: {message.systemInfo.workingDirectory}
													</Text>
												</Box>
											)}
											{message.files && message.files.length > 0 && (
												<Box flexDirection="column">
													{message.files.map((file, fileIndex) => (
														<Text key={fileIndex} color="gray" dimColor>
															└─ {file.path}{file.exists ? ` (total line ${file.lineCount})` : ' (file not found)'}
														</Text>
													))}
												</Box>
											)}
											{/* Images for user messages */}
											{message.role === 'user' && message.images && message.images.length > 0 && (
												<Box marginTop={1} flexDirection="column">
													{message.images.map((_image, imageIndex) => (
														<Text key={imageIndex} color="gray" dimColor>
															└─ [image #{imageIndex + 1}]
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

			{/* Show pending tool calls in dynamic area */}
			{messages.filter(m => m.toolPending).map((message, index) => (
				<Box key={`pending-tool-${index}`} marginBottom={1} marginX={1}>
					<Text color="yellowBright" bold>
						❆
					</Text>
					<Box marginLeft={1} marginBottom={1} flexDirection="row">
						<MarkdownRenderer
							content={message.content || ' '}
							color="yellow"
						/>
						<Box marginLeft={1}>
							<Text color="yellow">
								<Spinner type="dots" />
							</Text>
						</Box>
					</Box>
				</Box>
			))}

			{/* Show loading indicator when streaming or saving */}
			{(isStreaming || isSaving) && !pendingToolConfirmation && (
				<Box marginBottom={1} marginX={1}>
					<Text color={(['#FF6EBF', 'green', 'blue', 'cyan', '#B588F8'][animationFrame] as any)} bold>
						❆
					</Text>
					<Box marginLeft={1} marginBottom={1}>
						<Text color="gray" dimColor>
							{isStreaming ? (
								<>
									Thinking... ({formatElapsedTime(elapsedSeconds)}
									{streamTokenCount > 0 && (
										<>
											{' · '}
											<Text color="cyan">
												↓ {streamTokenCount >= 1000
													? `${(streamTokenCount / 1000).toFixed(1)}k`
													: streamTokenCount} tokens
											</Text>
										</>
									)}
									)
								</>
							) : (
								'Create the first dialogue record file...'
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
					contextUsage={contextUsage ? {
						inputTokens: contextUsage.prompt_tokens,
						maxContextTokens: getOpenAiConfig().maxContextTokens || 4000
					} : undefined}
				/>
			)}
		</Box>
	);
}
