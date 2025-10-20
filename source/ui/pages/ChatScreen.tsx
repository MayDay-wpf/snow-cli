import React, {useState, useEffect, useRef} from 'react';
import {Box, Text, useInput, Static, useStdout} from 'ink';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import ansiEscapes from 'ansi-escapes';
import ChatInput from '../components/ChatInput.js';
import {type Message} from '../components/MessageList.js';
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
import ShimmerText from '../components/ShimmerText.js';
import {getOpenAiConfig} from '../../utils/apiConfig.js';
import {sessionManager} from '../../utils/sessionManager.js';
import {useSessionSave} from '../../hooks/useSessionSave.js';
import {useToolConfirmation} from '../../hooks/useToolConfirmation.js';
import {handleConversationWithTools} from '../../hooks/useConversation.js';
import {useVSCodeState} from '../../hooks/useVSCodeState.js';
import {useSnapshotState} from '../../hooks/useSnapshotState.js';
import {useStreamingState} from '../../hooks/useStreamingState.js';
import {useCommandHandler} from '../../hooks/useCommandHandler.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import {
	parseAndValidateFileReferences,
	createMessageWithFileInstructions,
	getSystemInfo,
} from '../../utils/fileUtils.js';
import {executeCommand} from '../../utils/commandExecutor.js';
import {convertSessionMessagesToUI} from '../../utils/sessionConverter.js';
import {incrementalSnapshotManager} from '../../utils/incrementalSnapshot.js';
import {formatElapsedTime} from '../../utils/textUtils.js';

// Import commands to register them
import '../../utils/commands/clear.js';
import '../../utils/commands/resume.js';
import '../../utils/commands/mcp.js';
import '../../utils/commands/yolo.js';
import '../../utils/commands/init.js';
import '../../utils/commands/ide.js';
import '../../utils/commands/compact.js';

type Props = {
	skipWelcome?: boolean;
};

export default function ChatScreen({skipWelcome}: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isSaving] = useState(false);
	const [currentTodos, setCurrentTodos] = useState<
		Array<{
			id: string;
			content: string;
			status: 'pending' | 'completed';
		}>
	>([]);
	const [pendingMessages, setPendingMessages] = useState<string[]>([]);
	const pendingMessagesRef = useRef<string[]>([]);
	const hasAttemptedAutoVscodeConnect = useRef(false);
	const [remountKey, setRemountKey] = useState(0);
	const [showMcpInfo, setShowMcpInfo] = useState(false);
	const [mcpPanelKey, setMcpPanelKey] = useState(0);
	const [yoloMode, setYoloMode] = useState(() => {
		// Load yolo mode from localStorage on initialization
		try {
			const saved = localStorage.getItem('snow-yolo-mode');
			return saved === 'true';
		} catch {
			return false;
		}
	});
	const [isCompressing, setIsCompressing] = useState(false);
	const [compressionError, setCompressionError] = useState<string | null>(null);
	const [showSessionPanel, setShowSessionPanel] = useState(false);
	const [showMcpPanel, setShowMcpPanel] = useState(false);
	const [shouldIncludeSystemInfo, setShouldIncludeSystemInfo] = useState(true); // Include on first message
	const {columns: terminalWidth, rows: terminalHeight} = useTerminalSize();
	const {stdout} = useStdout();
	const workingDirectory = process.cwd();
	const isInitialMount = useRef(true);

	// Use custom hooks
	const streamingState = useStreamingState();
	const vscodeState = useVSCodeState();
	const snapshotState = useSnapshotState(messages.length);

	// Use session save hook
	const {saveMessage, clearSavedMessages, initializeFromSession} =
		useSessionSave();

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

	// Auto-resume last session when skipWelcome is true
	useEffect(() => {
		if (!skipWelcome) return;

		const autoResume = async () => {
			try {
				const sessions = await sessionManager.listSessions();
				if (sessions.length > 0) {
					// Get the most recent session (already sorted by updatedAt)
					const latestSession = sessions[0];
					if (latestSession) {
						const session = await sessionManager.loadSession(latestSession.id);

						if (session) {
							// Initialize from session
							const uiMessages = convertSessionMessagesToUI(session.messages);
							setMessages(uiMessages);
							initializeFromSession(session.messages);
						}
					}
				}
				// If no sessions exist, just stay in chat screen with empty state
			} catch (error) {
				// Silently fail - just stay in empty chat screen
				console.error('Failed to auto-resume session:', error);
			}
		};

		autoResume();
	}, [skipWelcome, initializeFromSession]);

	// Clear terminal and remount on terminal width change (like gemini-cli)
	// Use debounce to avoid flickering during continuous resize
	useEffect(() => {
		if (isInitialMount.current) {
			isInitialMount.current = false;
			return;
		}

		const handler = setTimeout(() => {
			stdout.write(ansiEscapes.clearTerminal);
			setRemountKey(prev => prev + 1);
		}, 200); // Wait for resize to stabilize

		return () => {
			clearTimeout(handler);
		};
	}, [terminalWidth, stdout]);

	// Reload messages from session when remountKey changes (to restore sub-agent messages)
	useEffect(() => {
		if (remountKey === 0) return; // Skip initial render

		const reloadMessages = async () => {
			const currentSession = sessionManager.getCurrentSession();
			if (currentSession && currentSession.messages.length > 0) {
				// Convert session messages back to UI format
				const uiMessages = convertSessionMessagesToUI(currentSession.messages);
				setMessages(uiMessages);
			}
		};

		reloadMessages();
	}, [remountKey]);

	// Use tool confirmation hook
	const {
		pendingToolConfirmation,
		requestToolConfirmation,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
	} = useToolConfirmation();

	// Minimum terminal height required for proper rendering
	const MIN_TERMINAL_HEIGHT = 10;

	// Forward reference for processMessage (defined below)
	const processMessageRef =
		useRef<
			(
				message: string,
				images?: Array<{data: string; mimeType: string}>,
				useBasicModel?: boolean,
				hideUserMessage?: boolean,
			) => Promise<void>
		>();
	// Use command handler hook
	const {handleCommandExecution} = useCommandHandler({
		messages,
		setMessages,
		setRemountKey,
		clearSavedMessages,
		setIsCompressing,
		setCompressionError,
		setShowSessionPanel,
		setShowMcpInfo,
		setShowMcpPanel,
		setMcpPanelKey,
		setYoloMode,
		setContextUsage: streamingState.setContextUsage,
		setShouldIncludeSystemInfo,
		setVscodeConnectionStatus: vscodeState.setVscodeConnectionStatus,
		processMessage: (message, images, useBasicModel, hideUserMessage) =>
			processMessageRef.current?.(
				message,
				images,
				useBasicModel,
				hideUserMessage,
			) || Promise.resolve(),
	});

	useEffect(() => {
		if (hasAttemptedAutoVscodeConnect.current) {
			return;
		}

		if (vscodeState.vscodeConnectionStatus !== 'disconnected') {
			hasAttemptedAutoVscodeConnect.current = true;
			return;
		}

		hasAttemptedAutoVscodeConnect.current = true;

		(async () => {
			try {
				const result = await executeCommand('ide');
				await handleCommandExecution('ide', result);
			} catch (error) {
				console.error('Failed to auto-connect VSCode:', error);
				await handleCommandExecution('ide', {
					success: false,
					message:
						error instanceof Error
							? error.message
							: 'Failed to start VSCode connection',
				});
			}
		})();
	}, [handleCommandExecution, vscodeState.vscodeConnectionStatus]);

	// Pending messages are now handled inline during tool execution in useConversation
	// Auto-send pending messages when streaming completely stops (as fallback)
	useEffect(() => {
		if (!streamingState.isStreaming && pendingMessages.length > 0) {
			const timer = setTimeout(() => {
				processPendingMessages();
			}, 100);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [streamingState.isStreaming, pendingMessages.length]);

	// ESC key handler to interrupt streaming or close overlays
	useInput((_, key) => {
		if (snapshotState.pendingRollback) {
			if (key.escape) {
				snapshotState.setPendingRollback(null);
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

		if (
			key.escape &&
			streamingState.isStreaming &&
			streamingState.abortController
		) {
			// Abort the controller
			streamingState.abortController.abort();

			// Remove all pending tool call messages (those with toolPending: true)
			setMessages(prev => prev.filter(msg => !msg.toolPending));

			// Add discontinued message
			setMessages(prev => [
				...prev,
				{
					role: 'assistant',
					content: '',
					streaming: false,
					discontinued: true,
				},
			]);

			// Stop streaming state
			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
		}
	});

	const handleHistorySelect = async (
		selectedIndex: number,
		_message: string,
	) => {
		// Count total files that will be rolled back (from selectedIndex onwards)
		let totalFileCount = 0;
		for (const [index, count] of snapshotState.snapshotFileCount.entries()) {
			if (index >= selectedIndex) {
				totalFileCount += count;
			}
		}

		// Show confirmation dialog if there are files to rollback
		if (totalFileCount > 0) {
			// Get list of files that will be rolled back
			const currentSession = sessionManager.getCurrentSession();
			const filePaths = currentSession
				? await incrementalSnapshotManager.getFilesToRollback(
						currentSession.id,
						selectedIndex,
				  )
				: [];

			snapshotState.setPendingRollback({
				messageIndex: selectedIndex,
				fileCount: filePaths.length, // Use actual unique file count
				filePaths,
			});
		} else {
			// No files to rollback, just rollback conversation
			performRollback(selectedIndex, false);
		}
	};

	const performRollback = async (
		selectedIndex: number,
		rollbackFiles: boolean,
	) => {
		// Rollback workspace to checkpoint if requested
		if (rollbackFiles) {
			const currentSession = sessionManager.getCurrentSession();
			if (currentSession) {
				// Use rollbackToMessageIndex to rollback all snapshots >= selectedIndex
				await incrementalSnapshotManager.rollbackToMessageIndex(
					currentSession.id,
					selectedIndex,
				);
			}
		}

		// Truncate messages array to remove the selected user message and everything after it
		setMessages(prev => prev.slice(0, selectedIndex));

		// Truncate session messages to match the UI state
		await sessionManager.truncateMessages(selectedIndex);

		clearSavedMessages();
		setRemountKey(prev => prev + 1);

		// Clear pending rollback dialog
		snapshotState.setPendingRollback(null);
	};

	const handleRollbackConfirm = (rollbackFiles: boolean | null) => {
		if (rollbackFiles === null) {
			// User cancelled - just close the dialog without doing anything
			snapshotState.setPendingRollback(null);
			return;
		}

		if (snapshotState.pendingRollback) {
			performRollback(
				snapshotState.pendingRollback.messageIndex,
				rollbackFiles,
			);
		}
	};

	const handleSessionPanelSelect = async (sessionId: string) => {
		setShowSessionPanel(false);
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				// Convert API format messages to UI format for proper rendering
				const uiMessages = convertSessionMessagesToUI(session.messages);

				initializeFromSession(session.messages);
				setMessages(uiMessages);
				setPendingMessages([]);
				streamingState.setIsStreaming(false);
				setRemountKey(prev => prev + 1);

				// Load snapshot file counts for the loaded session
				const snapshots = await incrementalSnapshotManager.listSnapshots(
					session.id,
				);
				const counts = new Map<number, number>();
				for (const snapshot of snapshots) {
					counts.set(snapshot.messageIndex, snapshot.fileCount);
				}
				snapshotState.setSnapshotFileCount(counts);
			}
		} catch (error) {
			console.error('Failed to load session:', error);
		}
	};

	const handleMessageSubmit = async (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
	) => {
		// If streaming, add to pending messages instead of sending immediately
		if (streamingState.isStreaming) {
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
			await incrementalSnapshotManager.createSnapshot(
				session.id,
				messages.length,
			);
		}

		// Process the message normally
		await processMessage(message, images);
	};

	const processMessage = async (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => {
		// Parse and validate file references
		const {cleanContent, validFiles} = await parseAndValidateFileReferences(
			message,
		);

		// Separate image files from regular files
		const imageFiles = validFiles.filter(
			f => f.isImage && f.imageData && f.mimeType,
		);
		const regularFiles = validFiles.filter(f => !f.isImage);

		// Convert image files to image content format
		const imageContents = [
			...(images || []).map(img => ({
				type: 'image' as const,
				data: img.data,
				mimeType: img.mimeType,
			})),
			...imageFiles.map(f => ({
				type: 'image' as const,
				data: f.imageData!,
				mimeType: f.mimeType!,
			})),
		];

		// Get system information only if needed
		const systemInfo = shouldIncludeSystemInfo ? getSystemInfo() : undefined;

		// Only add user message to UI if not hidden
		if (!hideUserMessage) {
			const userMessage: Message = {
				role: 'user',
				content: cleanContent,
				files: validFiles.length > 0 ? validFiles : undefined,
				images: imageContents.length > 0 ? imageContents : undefined,
				systemInfo,
			};
			setMessages(prev => [...prev, userMessage]);

			// After including system info once, don't include it again
			if (shouldIncludeSystemInfo) {
				setShouldIncludeSystemInfo(false);
			}
		}
		streamingState.setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		streamingState.setAbortController(controller);

		try {
			// Create message for AI with file read instructions, system info, and editor context
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
				systemInfo,
				vscodeState.vscodeConnected ? vscodeState.editorContext : undefined,
			);

			// Start conversation with tool support
			await handleConversationWithTools({
				userContent: messageForAI,
				imageContents,
				controller,
				messages,
				saveMessage,
				setMessages,
				setStreamTokenCount: streamingState.setStreamTokenCount,
				setCurrentTodos,
				requestToolConfirmation,
				isToolAutoApproved,
				addMultipleToAlwaysApproved,
				yoloMode,
				setContextUsage: streamingState.setContextUsage,
				useBasicModel,
				getPendingMessages: () => pendingMessagesRef.current,
				clearPendingMessages: () => setPendingMessages([]),
				setIsStreaming: streamingState.setIsStreaming,
				setIsReasoning: streamingState.setIsReasoning,
				setRetryStatus: streamingState.setRetryStatus,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				return;
			}

			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error occurred';
			const finalMessage: Message = {
				role: 'assistant',
				content: `Error: ${errorMessage}`,
				streaming: false,
			};
			setMessages(prev => [...prev, finalMessage]);
		} finally {
			// End streaming
			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
		}
	};

	// Set the ref to the actual function
	processMessageRef.current = processMessage;

	const processPendingMessages = async () => {
		if (pendingMessages.length === 0) return;

		// Get current pending messages and clear them immediately
		const messagesToProcess = [...pendingMessages];
		setPendingMessages([]);

		// Combine multiple pending messages into one
		const combinedMessage = messagesToProcess.join('\n\n');

		// Parse and validate file references (same as processMessage)
		const {cleanContent, validFiles} = await parseAndValidateFileReferences(
			combinedMessage,
		);

		// Separate image files from regular files
		const imageFiles = validFiles.filter(
			f => f.isImage && f.imageData && f.mimeType,
		);
		const regularFiles = validFiles.filter(f => !f.isImage);

		// Convert image files to image content format
		const imageContents =
			imageFiles.length > 0
				? imageFiles.map(f => ({
						type: 'image' as const,
						data: f.imageData!,
						mimeType: f.mimeType!,
				  }))
				: undefined;

		// Get system information (not needed for pending messages - they are follow-ups)
		const systemInfo = undefined;

		// Add user message to chat with file references and images
		const userMessage: Message = {
			role: 'user',
			content: cleanContent,
			files: validFiles.length > 0 ? validFiles : undefined,
			images: imageContents,
		};
		setMessages(prev => [...prev, userMessage]);

		// Start streaming response
		streamingState.setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		streamingState.setAbortController(controller);

		try {
			// Create message for AI with file read instructions, and editor context
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
				systemInfo,
				vscodeState.vscodeConnected ? vscodeState.editorContext : undefined,
			);

			// Use the same conversation handler
			await handleConversationWithTools({
				userContent: messageForAI,
				imageContents,
				controller,
				messages,
				saveMessage,
				setMessages,
				setStreamTokenCount: streamingState.setStreamTokenCount,
				setCurrentTodos,
				requestToolConfirmation,
				isToolAutoApproved,
				addMultipleToAlwaysApproved,
				yoloMode,
				setContextUsage: streamingState.setContextUsage,
				getPendingMessages: () => pendingMessagesRef.current,
				clearPendingMessages: () => setPendingMessages([]),
				setIsStreaming: streamingState.setIsStreaming,
				setIsReasoning: streamingState.setIsReasoning,
				setRetryStatus: streamingState.setRetryStatus,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				return;
			}

			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error occurred';
			const finalMessage: Message = {
				role: 'assistant',
				content: `Error: ${errorMessage}`,
				streaming: false,
			};
			setMessages(prev => [...prev, finalMessage]);
		} finally {
			// End streaming
			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
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
						⚠ Terminal Too Small
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="yellow">
						Your terminal height is {terminalHeight} lines, but at least{' '}
						{MIN_TERMINAL_HEIGHT} lines are required.
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
		<Box flexDirection="column" height="100%" width={terminalWidth}>
			<Static
				key={remountKey}
				items={[
					<Box key="header" paddingX={1} width={terminalWidth}>
						<Box
							borderColor={'cyan'}
							borderStyle="round"
							paddingX={2}
							paddingY={1}
							width={terminalWidth - 2}
						>
							<Box flexDirection="column">
								<Text color="white" bold>
									<Text color="cyan">❆ </Text>
									<Gradient name="rainbow">
										Programming efficiency x10!
									</Gradient>
									<Text color="white"> ⛇</Text>
								</Text>
								<Text>• Ask for code explanations and debugging help</Text>
								<Text>• Press ESC during response to interrupt</Text>
								<Text>• Press Shift+Tab: toggle YOLO</Text>
								<Text>• Working directory: {workingDirectory}</Text>
							</Box>
						</Box>
					</Box>,
					...messages
						.filter(m => !m.streaming)
						.map((message, index) => {
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
								<Box
									key={`msg-${index}`}
									marginBottom={isToolMessage ? 0 : 1}
									paddingX={1}
									flexDirection="column"
									width={terminalWidth}
								>
									<Box>
										<Text
											color={
												message.role === 'user'
													? 'green'
													: message.role === 'command'
													? 'gray'
													: toolStatusColor
											}
											bold
										>
											{message.role === 'user'
												? '⛇'
												: message.role === 'command'
												? '⌘'
												: '❆'}
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
															message.role === 'user'
																? 'gray'
																: isToolMessage
																? message.content.startsWith('⚡')
																	? 'yellow'
																	: message.content.startsWith('✓')
																	? 'green'
																	: 'red'
																: undefined
														}
													/>
													{message.toolDisplay &&
														message.toolDisplay.args.length > 0 && (
															<Box flexDirection="column">
																{message.toolDisplay.args.map(
																	(arg, argIndex) => (
																		<Text key={argIndex} color="gray" dimColor>
																			{arg.isLast ? '└─' : '├─'} {arg.key}:{' '}
																			{arg.value}
																		</Text>
																	),
																)}
															</Box>
														)}
													{message.toolCall &&
														(message.toolCall.name === 'filesystem-create' ||
															message.toolCall.name === 'filesystem-write') &&
														message.toolCall.arguments.content && (
															<Box marginTop={1}>
																<DiffViewer
																	newContent={
																		message.toolCall.arguments.content
																	}
																	filename={message.toolCall.arguments.path}
																/>
															</Box>
														)}
													{message.toolCall &&
														message.toolCall.name === 'filesystem-edit' &&
														message.toolCall.arguments.oldContent &&
														message.toolCall.arguments.newContent && (
															<Box marginTop={1}>
																<DiffViewer
																	oldContent={
																		message.toolCall.arguments.oldContent
																	}
																	newContent={
																		message.toolCall.arguments.newContent
																	}
																	filename={message.toolCall.arguments.filename}
																	completeOldContent={
																		message.toolCall.arguments
																			.completeOldContent
																	}
																	completeNewContent={
																		message.toolCall.arguments
																			.completeNewContent
																	}
																	startLineNumber={
																		message.toolCall.arguments.contextStartLine
																	}
																/>
															</Box>
														)}
													{message.toolCall &&
														message.toolCall.name ===
															'filesystem-edit_search' &&
														message.toolCall.arguments.oldContent &&
														message.toolCall.arguments.newContent && (
															<Box marginTop={1}>
																<DiffViewer
																	oldContent={
																		message.toolCall.arguments.oldContent
																	}
																	newContent={
																		message.toolCall.arguments.newContent
																	}
																	filename={message.toolCall.arguments.filename}
																	completeOldContent={
																		message.toolCall.arguments
																			.completeOldContent
																	}
																	completeNewContent={
																		message.toolCall.arguments
																			.completeNewContent
																	}
																	startLineNumber={
																		message.toolCall.arguments.contextStartLine
																	}
																/>
															</Box>
														)}
													{/* Show terminal execution result */}
													{message.toolCall &&
														message.toolCall.name === 'terminal-execute' &&
														message.toolCall.arguments.command && (
															<Box marginTop={1} flexDirection="column">
																<Text color="gray" dimColor>
																	└─ Command:{' '}
																	<Text color="white">
																		{message.toolCall.arguments.command}
																	</Text>
																</Text>
																<Text color="gray" dimColor>
																	└─ Exit Code:{' '}
																	<Text
																		color={
																			message.toolCall.arguments.exitCode === 0
																				? 'green'
																				: 'red'
																		}
																	>
																		{message.toolCall.arguments.exitCode}
																	</Text>
																</Text>
																{message.toolCall.arguments.stdout &&
																	message.toolCall.arguments.stdout.trim()
																		.length > 0 && (
																		<Box flexDirection="column" marginTop={1}>
																			<Text color="green" dimColor>
																				└─ stdout:
																			</Text>
																			<Box paddingLeft={2}>
																				<Text color="white">
																					{message.toolCall.arguments.stdout
																						.trim()
																						.split('\n')
																						.slice(0, 20)
																						.join('\n')}
																				</Text>
																				{message.toolCall.arguments.stdout
																					.trim()
																					.split('\n').length > 20 && (
																					<Text color="gray" dimColor>
																						... (output truncated)
																					</Text>
																				)}
																			</Box>
																		</Box>
																	)}
																{message.toolCall.arguments.stderr &&
																	message.toolCall.arguments.stderr.trim()
																		.length > 0 && (
																		<Box flexDirection="column" marginTop={1}>
																			<Text color="red" dimColor>
																				└─ stderr:
																			</Text>
																			<Box paddingLeft={2}>
																				<Text color="red">
																					{message.toolCall.arguments.stderr
																						.trim()
																						.split('\n')
																						.slice(0, 10)
																						.join('\n')}
																				</Text>
																				{message.toolCall.arguments.stderr
																					.trim()
																					.split('\n').length > 10 && (
																					<Text color="gray" dimColor>
																						... (output truncated)
																					</Text>
																				)}
																			</Box>
																		</Box>
																	)}
															</Box>
														)}
													{/* Show tool result preview for successful tool executions */}
													{message.content.startsWith('✓') &&
														message.toolResult &&
														!message.toolCall && (
															<ToolResultPreview
																toolName={
																	message.content
																		.replace('✓ ', '')
																		.split('\n')[0] || ''
																}
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
																└─ Working Directory:{' '}
																{message.systemInfo.workingDirectory}
															</Text>
														</Box>
													)}
													{message.files && message.files.length > 0 && (
														<Box flexDirection="column">
															{message.files.map((file, fileIndex) => (
																<Text key={fileIndex} color="gray" dimColor>
																	└─ {file.path}
																	{file.exists
																		? ` (total line ${file.lineCount})`
																		: ' (file not found)'}
																</Text>
															))}
														</Box>
													)}
													{/* Images for user messages */}
													{message.role === 'user' &&
														message.images &&
														message.images.length > 0 && (
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
						}),
				]}
			>
				{item => item}
			</Static>

			{/* Show loading indicator when streaming or saving */}
			{(streamingState.isStreaming || isSaving) && !pendingToolConfirmation && (
				<Box marginBottom={1} paddingX={1} width={terminalWidth}>
					<Text
						color={
							['#FF6EBF', 'green', 'blue', 'cyan', '#B588F8'][
								streamingState.animationFrame
							] as any
						}
						bold
					>
						❆
					</Text>
					<Box marginLeft={1} marginBottom={1} flexDirection="column">
						{streamingState.isStreaming ? (
							<>
								{streamingState.retryStatus &&
								streamingState.retryStatus.isRetrying ? (
									// Retry status display - hide "Thinking" and show retry info
									<Box flexDirection="column">
										{streamingState.retryStatus.errorMessage && (
											<Text color="red" dimColor>
												✗ Error: {streamingState.retryStatus.errorMessage}
											</Text>
										)}
										{streamingState.retryStatus.remainingSeconds !==
											undefined &&
										streamingState.retryStatus.remainingSeconds > 0 ? (
											<Text color="yellow" dimColor>
												⟳ Retry {streamingState.retryStatus.attempt}/5 in{' '}
												{streamingState.retryStatus.remainingSeconds}s...
											</Text>
										) : (
											<Text color="yellow" dimColor>
												⟳ Resending... (Attempt{' '}
												{streamingState.retryStatus.attempt}/5)
											</Text>
										)}
									</Box>
								) : (
									// Normal thinking status
									<Text color="gray" dimColor>
										<ShimmerText
											text={
												streamingState.isReasoning
													? 'Deep thinking...'
													: 'Thinking...'
											}
										/>{' '}
										({formatElapsedTime(streamingState.elapsedSeconds)}
										{' · '}
										<Text color="cyan">
											↓{' '}
											{streamingState.streamTokenCount >= 1000
												? `${(streamingState.streamTokenCount / 1000).toFixed(
														1,
												  )}k`
												: streamingState.streamTokenCount}{' '}
											tokens
										</Text>
										)
									</Text>
								)}
							</>
						) : (
							<Text color="gray" dimColor>
								Create the first dialogue record file...
							</Text>
						)}
					</Box>
				</Box>
			)}

			<Box paddingX={1} width={terminalWidth}>
				<PendingMessages pendingMessages={pendingMessages} />
			</Box>

			{/* Show tool confirmation dialog if pending */}
			{pendingToolConfirmation && (
				<ToolConfirmation
					toolName={
						pendingToolConfirmation.batchToolNames ||
						pendingToolConfirmation.tool.function.name
					}
					toolArguments={
						!pendingToolConfirmation.allTools
							? pendingToolConfirmation.tool.function.arguments
							: undefined
					}
					allTools={pendingToolConfirmation.allTools}
					onConfirm={pendingToolConfirmation.resolve}
				/>
			)}

			{/* Show session list panel if active - replaces input */}
			{showSessionPanel && (
				<Box paddingX={1} width={terminalWidth}>
					<SessionListPanel
						onSelectSession={handleSessionPanelSelect}
						onClose={() => setShowSessionPanel(false)}
					/>
				</Box>
			)}

			{/* Show MCP info panel if active - replaces input */}
			{showMcpPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<MCPInfoPanel />
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							Press ESC to close
						</Text>
					</Box>
				</Box>
			)}

			{/* Show file rollback confirmation if pending */}
			{snapshotState.pendingRollback && (
				<FileRollbackConfirmation
					fileCount={snapshotState.pendingRollback.fileCount}
					filePaths={snapshotState.pendingRollback.filePaths || []}
					onConfirm={handleRollbackConfirm}
				/>
			)}

			{/* Hide input during tool confirmation or compression or session panel or MCP panel or rollback confirmation */}
			{!pendingToolConfirmation &&
				!isCompressing &&
				!showSessionPanel &&
				!showMcpPanel &&
				!snapshotState.pendingRollback && (
					<>
						<ChatInput
							onSubmit={handleMessageSubmit}
							onCommand={handleCommandExecution}
							placeholder="Ask me anything about coding..."
							disabled={!!pendingToolConfirmation}
							chatHistory={messages}
							onHistorySelect={handleHistorySelect}
							yoloMode={yoloMode}
							contextUsage={
								streamingState.contextUsage
									? {
											inputTokens: streamingState.contextUsage.prompt_tokens,
											maxContextTokens:
												getOpenAiConfig().maxContextTokens || 4000,
											cacheCreationTokens:
												streamingState.contextUsage.cache_creation_input_tokens,
											cacheReadTokens:
												streamingState.contextUsage.cache_read_input_tokens,
											cachedTokens: streamingState.contextUsage.cached_tokens,
									  }
									: undefined
							}
						/>
						{/* IDE connection status indicator */}
						{vscodeState.vscodeConnectionStatus !== 'disconnected' && (
							<Box marginTop={1}>
								<Text
									color={
										vscodeState.vscodeConnectionStatus === 'connecting'
											? 'yellow'
											: vscodeState.vscodeConnectionStatus === 'connected'
											? 'green'
											: vscodeState.vscodeConnectionStatus === 'error'
											? 'red'
											: 'gray'
									}
									dimColor={vscodeState.vscodeConnectionStatus !== 'error'}
								>
									●{' '}
									{vscodeState.vscodeConnectionStatus === 'connecting'
										? 'Connecting to IDE...'
										: vscodeState.vscodeConnectionStatus === 'connected'
										? 'IDE Connected'
										: vscodeState.vscodeConnectionStatus === 'error'
										? 'Connection Failed - Make sure Snow CLI plugin is installed and active in your IDE'
										: 'IDE'}
									{vscodeState.vscodeConnectionStatus === 'connected' &&
										vscodeState.editorContext.activeFile &&
										` | ${vscodeState.editorContext.activeFile}`}
									{vscodeState.vscodeConnectionStatus === 'connected' &&
										vscodeState.editorContext.selectedText &&
										` | ${vscodeState.editorContext.selectedText.length} chars selected`}
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
					<Text color="red">✗ Compression failed: {compressionError}</Text>
				</Box>
			)}
		</Box>
	);
}
