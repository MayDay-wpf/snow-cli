import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, Static, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import ChatInput from '../components/ChatInput.js';
import { type Message } from '../components/MessageList.js';
import PendingMessages from '../components/PendingMessages.js';
import MCPInfoScreen from '../components/MCPInfoScreen.js';
import MCPInfoPanel from '../components/MCPInfoPanel.js';
import SessionListPanel from '../components/SessionListPanel.js';
import MarkdownRenderer from '../components/MarkdownRenderer.js';
import ToolConfirmation from '../components/ToolConfirmation.js';
import DiffViewer from '../components/DiffViewer.js';
import ToolResultPreview from '../components/ToolResultPreview.js';
import TodoTree from '../components/TodoTree.js';
import FileRollbackConfirmation from '../components/FileRollbackConfirmation.js';
import type { UsageInfo } from '../../api/chat.js';
import { getOpenAiConfig } from '../../utils/apiConfig.js';
import { sessionManager } from '../../utils/sessionManager.js';
import { useSessionSave } from '../../hooks/useSessionSave.js';
import { useToolConfirmation } from '../../hooks/useToolConfirmation.js';
import { handleConversationWithTools } from '../../hooks/useConversation.js';
import { parseAndValidateFileReferences, createMessageWithFileInstructions, getSystemInfo } from '../../utils/fileUtils.js';
import { compressContext } from '../../utils/contextCompressor.js';
import { incrementalSnapshotManager } from '../../utils/incrementalSnapshot.js';
// Import commands to register them
import '../../utils/commands/clear.js';
import '../../utils/commands/resume.js';
import '../../utils/commands/mcp.js';
import '../../utils/commands/yolo.js';
import '../../utils/commands/init.js';
import '../../utils/commands/ide.js';
import '../../utils/commands/compact.js';
import { navigateTo } from '../../hooks/useGlobalNavigation.js';
import { vscodeConnection, type EditorContext } from '../../utils/vscodeConnection.js';

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
	const [yoloMode, setYoloMode] = useState(() => {
		// Load yolo mode from localStorage on initialization
		try {
			const saved = localStorage.getItem('snow-yolo-mode');
			return saved === 'true';
		} catch {
			return false;
		}
	});
	const [contextUsage, setContextUsage] = useState<UsageInfo | null>(null);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [timerStartTime, setTimerStartTime] = useState<number | null>(null);
	const [vscodeConnected, setVscodeConnected] = useState(false);
	const [vscodeConnectionStatus, setVscodeConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
	const [editorContext, setEditorContext] = useState<EditorContext>({});
	const [isCompressing, setIsCompressing] = useState(false);
	const [compressionError, setCompressionError] = useState<string | null>(null);
	const [showSessionPanel, setShowSessionPanel] = useState(false);
	const [showMcpPanel, setShowMcpPanel] = useState(false);
	const [snapshotFileCount, setSnapshotFileCount] = useState<Map<number, number>>(new Map());
	const [pendingRollback, setPendingRollback] = useState<{messageIndex: number; fileCount: number} | null>(null);
	const { stdout } = useStdout();
	const terminalHeight = stdout?.rows || 24;
	const workingDirectory = process.cwd();

	// Minimum terminal height required for proper rendering
	const MIN_TERMINAL_HEIGHT = 10;

	// Use session save hook
	const { saveMessage, clearSavedMessages, initializeFromSession } = useSessionSave();

	// Sync pendingMessages to ref for real-time access in callbacks
	useEffect(() => {
		pendingMessagesRef.current = pendingMessages;
	}, [pendingMessages]);

	// Persist yolo mode to localStorage
	useEffect(() => {
		try {
			localStorage.setItem('snow-yolo-mode', String(yoloMode));
		} catch {
			// Ignore localStorage errors
		}
	}, [yoloMode]);

	// Use tool confirmation hook
	const {
		pendingToolConfirmation,
		requestToolConfirmation,
		isToolAutoApproved,
		addMultipleToAlwaysApproved
	} = useToolConfirmation();

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

	// Monitor VSCode connection status and editor context
	useEffect(() => {
		let connectingTimeout: NodeJS.Timeout | null = null;

		const checkConnection = setInterval(() => {
			const isConnected = vscodeConnection.isConnected();
			const isServerRunning = vscodeConnection.isServerRunning();
			setVscodeConnected(isConnected);

			// Update connection status based on actual connection state
			if (isConnected && vscodeConnectionStatus !== 'connected') {
				setVscodeConnectionStatus('connected');
				if (connectingTimeout) {
					clearTimeout(connectingTimeout);
					connectingTimeout = null;
				}
			} else if (!isConnected && vscodeConnectionStatus === 'connected') {
				setVscodeConnectionStatus('disconnected');
			} else if (vscodeConnectionStatus === 'connecting' && !isServerRunning) {
				// Server failed to start
				setVscodeConnectionStatus('error');
				if (connectingTimeout) {
					clearTimeout(connectingTimeout);
					connectingTimeout = null;
				}
			}
		}, 1000);

		// Set timeout for connecting state (15 seconds)
		if (vscodeConnectionStatus === 'connecting') {
			connectingTimeout = setTimeout(() => {
				if (vscodeConnectionStatus === 'connecting') {
					setVscodeConnectionStatus('error');
				}
			}, 15000);
		}

		const unsubscribe = vscodeConnection.onContextUpdate((context) => {
			setEditorContext(context);
			// When we receive context, it means connection is successful
			if (vscodeConnectionStatus !== 'connected') {
				setVscodeConnectionStatus('connected');
				if (connectingTimeout) {
					clearTimeout(connectingTimeout);
					connectingTimeout = null;
				}
			}
		});

		return () => {
			clearInterval(checkConnection);
			if (connectingTimeout) {
				clearTimeout(connectingTimeout);
			}
			unsubscribe();
		};
	}, [vscodeConnectionStatus]);

	// Load snapshot file counts when session changes
	useEffect(() => {
		const loadSnapshotFileCounts = async () => {
			const currentSession = sessionManager.getCurrentSession();
			if (!currentSession) return;

			const snapshots = await incrementalSnapshotManager.listSnapshots(currentSession.id);
			const counts = new Map<number, number>();

			for (const snapshot of snapshots) {
				counts.set(snapshot.messageIndex, snapshot.fileCount);
			}

			setSnapshotFileCount(counts);
		};

		loadSnapshotFileCounts();
	}, [messages.length]); // Reload when messages change

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
		if (pendingRollback) {
			if (key.escape) {
				setPendingRollback(null);
			}
			return;
		}

		if (showSessionPanel) {
			if (key.escape) {
				setShowSessionPanel(false);
			}
			return;
		}

		if (showMcpPanel) {
			if (key.escape) {
				setShowMcpPanel(false);
			}
			return;
		}

		if (showMcpInfo) {
			if (key.escape) {
				setShowMcpInfo(false);
			}
			return;
		}

		if (key.escape && isStreaming && abortController) {
			// Abort the controller
			abortController.abort();

			// Add discontinued message
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

	const handleCommandExecution = async (commandName: string, result: any) => {
		// Handle /compact command
		if (commandName === 'compact' && result.success && result.action === 'compact') {
			// Set compressing state (不添加命令面板消息)
			setIsCompressing(true);
			setCompressionError(null);

			try {
				// Convert messages to ChatMessage format for compression
				const chatMessages = messages
					.filter(msg => msg.role !== 'command')
					.map(msg => ({
						role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
						content: msg.content,
						tool_call_id: msg.toolCallId
					}));

				// Compress the context
				const result = await compressContext(chatMessages);

				// Replace all messages with a summary message (不包含 "Context Compressed" 标题)
				const summaryMessage: Message = {
					role: 'assistant',
					content: result.summary,
					streaming: false
				};

				// Clear session and set new compressed state
				sessionManager.clearCurrentSession();
				clearSavedMessages();
				setMessages([summaryMessage]);
				setRemountKey(prev => prev + 1);

				// Update token usage with compression result
				setContextUsage({
					prompt_tokens: result.usage.prompt_tokens,
					completion_tokens: result.usage.completion_tokens,
					total_tokens: result.usage.total_tokens
				});
			} catch (error) {
				// Show error message
				const errorMsg = error instanceof Error ? error.message : 'Unknown compression error';
				setCompressionError(errorMsg);

				const errorMessage: Message = {
					role: 'assistant',
					content: `**Compression Failed**\n\n${errorMsg}`,
					streaming: false
				};
				setMessages(prev => [...prev, errorMessage]);
			} finally {
				setIsCompressing(false);
			}
			return;
		}

		// Handle /ide command
		if (commandName === 'ide') {
			if (result.success) {
				setVscodeConnectionStatus('connecting');
				// Add command execution feedback
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName
				};
				setMessages(prev => [...prev, commandMessage]);
			} else {
				setVscodeConnectionStatus('error');
			}
			return;
		}

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
		} else if (result.success && result.action === 'showSessionPanel') {
			setShowSessionPanel(true);
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages(prev => [...prev, commandMessage]);
		} else if (result.success && result.action === 'showMcpInfo') {
			setShowMcpInfo(true);
			setMcpPanelKey(prev => prev + 1);
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages(prev => [...prev, commandMessage]);
		} else if (result.success && result.action === 'showMcpPanel') {
			setShowMcpPanel(true);
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

	const handleHistorySelect = async (selectedIndex: number, _message: string) => {
		// Check if there are files to rollback
		const fileCount = snapshotFileCount.get(selectedIndex) || 0;

		if (fileCount > 0) {
			// Show confirmation dialog
			setPendingRollback({ messageIndex: selectedIndex, fileCount });
		} else {
			// No files to rollback, just rollback conversation
			performRollback(selectedIndex, false);
		}
	};

	const performRollback = async (selectedIndex: number, rollbackFiles: boolean) => {
		// Rollback workspace to checkpoint if requested
		if (rollbackFiles) {
			const currentSession = sessionManager.getCurrentSession();
			if (currentSession) {
				await incrementalSnapshotManager.rollbackToSnapshot(currentSession.id, selectedIndex);
			}
		}

		// Truncate messages array to remove the selected user message and everything after it
		setMessages(prev => prev.slice(0, selectedIndex));
		clearSavedMessages();
		setRemountKey(prev => prev + 1);

		// Clear pending rollback dialog
		setPendingRollback(null);
	};

	const handleRollbackConfirm = (rollbackFiles: boolean) => {
		if (pendingRollback) {
			performRollback(pendingRollback.messageIndex, rollbackFiles);
		}
	};

	const handleSessionPanelSelect = async (sessionId: string) => {
		setShowSessionPanel(false);
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				initializeFromSession(session.messages);
				setMessages(session.messages as Message[]);
				setPendingMessages([]);
				setIsStreaming(false);
				setRemountKey(prev => prev + 1);
			}
		} catch (error) {
			console.error('Failed to load session:', error);
		}
	};

	const handleMessageSubmit = async (message: string, images?: Array<{data: string, mimeType: string}>) => {
		// If streaming, add to pending messages instead of sending immediately
		if (isStreaming) {
			setPendingMessages(prev => [...prev, message]);
			return;
		}

		// Create checkpoint (lightweight, only tracks modifications)
		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) {
			await sessionManager.createNewSession();
		}
		const session = sessionManager.getCurrentSession();
		if (session) {
			await incrementalSnapshotManager.createSnapshot(session.id, messages.length);
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
			// Create message for AI with file read instructions, system info, and editor context
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
				systemInfo,
				vscodeConnected ? editorContext : undefined
			);

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
				clearPendingMessages: () => setPendingMessages([]),
				setIsStreaming
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
				clearPendingMessages: () => setPendingMessages([]),
				setIsStreaming
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

	if (showMcpInfo) {
		return (
			<MCPInfoScreen
				onClose={() => setShowMcpInfo(false)}
				panelKey={mcpPanelKey}
			/>
		);
	}

	// Show warning if terminal is too small
	if (terminalHeight < MIN_TERMINAL_HEIGHT) {
		return (
			<Box flexDirection="column" padding={2}>
				<Box borderStyle="round" borderColor="red" padding={1}>
					<Text color="red" bold>
						⚠  Terminal Too Small
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="yellow">
						Your terminal height is {terminalHeight} lines, but at least {MIN_TERMINAL_HEIGHT} lines are required.
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="gray" dimColor>
						Please resize your terminal window to continue.
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" height="100%">
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
					toolArguments={!pendingToolConfirmation.allTools ? pendingToolConfirmation.tool.function.arguments : undefined}
					allTools={pendingToolConfirmation.allTools}
					onConfirm={pendingToolConfirmation.resolve}
				/>
			)}

			{/* Show session list panel if active - replaces input */}
			{showSessionPanel && (
				<Box marginX={1}>
					<SessionListPanel
						onSelectSession={handleSessionPanelSelect}
						onClose={() => setShowSessionPanel(false)}
					/>
				</Box>
			)}

			{/* Show MCP info panel if active - replaces input */}
			{showMcpPanel && (
				<Box marginX={1} flexDirection="column">
					<MCPInfoPanel />
					<Box marginTop={1}>
						<Text color="gray" dimColor>Press ESC to close</Text>
					</Box>
				</Box>
			)}

			{/* Show file rollback confirmation if pending */}
			{pendingRollback && (
				<FileRollbackConfirmation
					fileCount={pendingRollback.fileCount}
					onConfirm={handleRollbackConfirm}
				/>
			)}

			{/* Hide input during tool confirmation or compression or session panel or MCP panel or rollback confirmation */}
			{!pendingToolConfirmation && !isCompressing && !showSessionPanel && !showMcpPanel && !pendingRollback && (
				<>
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
							maxContextTokens: getOpenAiConfig().maxContextTokens || 4000,
							cacheCreationTokens: contextUsage.cache_creation_input_tokens,
							cacheReadTokens: contextUsage.cache_read_input_tokens,
							cachedTokens: contextUsage.cached_tokens
						} : undefined}
						snapshotFileCount={snapshotFileCount}
					/>
					{/* VSCode connection status indicator */}
					{vscodeConnectionStatus !== 'disconnected' && (
						<Box marginTop={1}>
							<Text
								color={
									vscodeConnectionStatus === 'connecting' ? 'yellow' :
									vscodeConnectionStatus === 'connected' ? 'green' :
									vscodeConnectionStatus === 'error' ? 'red' : 'gray'
								}
								dimColor={vscodeConnectionStatus !== 'error'}
							>
								● {
									vscodeConnectionStatus === 'connecting' ? 'Connecting to VSCode...' :
									vscodeConnectionStatus === 'connected' ? 'VSCode Connected' :
									vscodeConnectionStatus === 'error' ? 'Connection Failed' : 'VSCode'
								}
								{vscodeConnectionStatus === 'connected' && editorContext.activeFile && ` | ${editorContext.activeFile}`}
								{vscodeConnectionStatus === 'connected' && editorContext.selectedText && ` | ${editorContext.selectedText.length} chars selected`}
							</Text>
						</Box>
					)}
				</>
			)}

			{/* Context compression status indicator - always visible when compressing */}
			{isCompressing && (
				<Box marginTop={1}>
					<Text color="cyan">
						<Spinner type="dots" /> Compressing conversation history...
					</Text>
				</Box>
			)}

			{/* Compression error indicator */}
			{compressionError && (
				<Box marginTop={1}>
					<Text color="red">
						✗ Compression failed: {compressionError}
					</Text>
				</Box>
			)}
		</Box>
	);
}
