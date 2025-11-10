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
import UsagePanel from '../components/UsagePanel.js';
import HelpPanel from '../components/HelpPanel.js';
import MarkdownRenderer from '../components/MarkdownRenderer.js';
import ToolConfirmation from '../components/ToolConfirmation.js';
import DiffViewer from '../components/DiffViewer.js';
import ToolResultPreview from '../components/ToolResultPreview.js';
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
} from '../../utils/fileUtils.js';
import {executeCommand} from '../../utils/commandExecutor.js';
import {convertSessionMessagesToUI} from '../../utils/sessionConverter.js';
import {incrementalSnapshotManager} from '../../utils/incrementalSnapshot.js';
import {formatElapsedTime} from '../../utils/textUtils.js';
import {
	shouldAutoCompress,
	performAutoCompression,
} from '../../utils/autoCompress.js';
import {CodebaseIndexAgent} from '../../agents/codebaseIndexAgent.js';
import {loadCodebaseConfig} from '../../utils/codebaseConfig.js';
import {logger} from '../../utils/logger.js';

// Import commands to register them
import '../../utils/commands/clear.js';
import '../../utils/commands/resume.js';
import '../../utils/commands/mcp.js';
import '../../utils/commands/yolo.js';
import '../../utils/commands/init.js';
import '../../utils/commands/ide.js';
import '../../utils/commands/compact.js';
import '../../utils/commands/home.js';
import '../../utils/commands/review.js';
import '../../utils/commands/role.js';
import '../../utils/commands/usage.js';
import '../../utils/commands/export.js';
import '../../utils/commands/agent.js';
import '../../utils/commands/todoPicker.js';
import '../../utils/commands/help.js';

type Props = {
	skipWelcome?: boolean;
};

export default function ChatScreen({skipWelcome}: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isSaving] = useState(false);
	const [pendingMessages, setPendingMessages] = useState<
		Array<{text: string; images?: Array<{data: string; mimeType: string}>}>
	>([]);
	const pendingMessagesRef = useRef<
		Array<{text: string; images?: Array<{data: string; mimeType: string}>}>
	>([]);
	const hasAttemptedAutoVscodeConnect = useRef(false);
	const userInterruptedRef = useRef(false); // Track if user manually interrupted via ESC
	const [remountKey, setRemountKey] = useState(0);
	const [showMcpInfo, setShowMcpInfo] = useState(false);
	const [mcpPanelKey, setMcpPanelKey] = useState(0);
	const [currentContextPercentage, setCurrentContextPercentage] = useState(0); // Track context percentage from ChatInput
	const currentContextPercentageRef = useRef(0); // Use ref to avoid closure issues

	// Sync state to ref
	useEffect(() => {
		currentContextPercentageRef.current = currentContextPercentage;
	}, [currentContextPercentage]);
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
	const [showUsagePanel, setShowUsagePanel] = useState(false);
	const [showHelpPanel, setShowHelpPanel] = useState(false);
	const [restoreInputContent, setRestoreInputContent] = useState<{
		text: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
	} | null>(null);
	const {columns: terminalWidth, rows: terminalHeight} = useTerminalSize();
	const {stdout} = useStdout();
	const workingDirectory = process.cwd();
	const isInitialMount = useRef(true);

	// Codebase indexing state
	const [codebaseIndexing, setCodebaseIndexing] = useState(false);
	const [codebaseProgress, setCodebaseProgress] = useState<{
		totalFiles: number;
		processedFiles: number;
		totalChunks: number;
		currentFile: string;
		status: string;
	} | null>(null);
	const [watcherEnabled, setWatcherEnabled] = useState(false);
	const [fileUpdateNotification, setFileUpdateNotification] = useState<{
		file: string;
		timestamp: number;
	} | null>(null);
	const codebaseAgentRef = useRef<CodebaseIndexAgent | null>(null);

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

	// Auto-start codebase indexing on mount if enabled
	useEffect(() => {
		const startCodebaseIndexing = async () => {
			try {
				const config = loadCodebaseConfig();

				// Only start if enabled and not already indexing
				if (!config.enabled || codebaseIndexing) {
					return;
				}

				// Initialize agent
				const agent = new CodebaseIndexAgent(workingDirectory);
				codebaseAgentRef.current = agent;

				// Check if indexing is needed
				const progress = agent.getProgress();

				// If indexing is already completed, start watcher and return early
				if (progress.status === 'completed' && progress.totalChunks > 0) {
					agent.startWatching(progressData => {
						setCodebaseProgress({
							totalFiles: progressData.totalFiles,
							processedFiles: progressData.processedFiles,
							totalChunks: progressData.totalChunks,
							currentFile: progressData.currentFile,
							status: progressData.status,
						});

						// Handle file update notifications
						if (progressData.totalFiles === 0 && progressData.currentFile) {
							setFileUpdateNotification({
								file: progressData.currentFile,
								timestamp: Date.now(),
							});

							// Clear notification after 3 seconds
							setTimeout(() => {
								setFileUpdateNotification(null);
							}, 3000);
						}
					});
					setWatcherEnabled(true);
					return;
				}

				// If watcher was enabled before but indexing not completed, restore it
				const wasWatcherEnabled = agent.isWatcherEnabled();
				if (wasWatcherEnabled) {
					logger.info('Restoring file watcher from previous session');
					agent.startWatching(progressData => {
						setCodebaseProgress({
							totalFiles: progressData.totalFiles,
							processedFiles: progressData.processedFiles,
							totalChunks: progressData.totalChunks,
							currentFile: progressData.currentFile,
							status: progressData.status,
						});

						// Handle file update notifications
						if (progressData.totalFiles === 0 && progressData.currentFile) {
							setFileUpdateNotification({
								file: progressData.currentFile,
								timestamp: Date.now(),
							});

							// Clear notification after 3 seconds
							setTimeout(() => {
								setFileUpdateNotification(null);
							}, 3000);
						}
					});
					setWatcherEnabled(true);
				}

				// Start or resume indexing in background
				setCodebaseIndexing(true);

				agent.start(progressData => {
					setCodebaseProgress({
						totalFiles: progressData.totalFiles,
						processedFiles: progressData.processedFiles,
						totalChunks: progressData.totalChunks,
						currentFile: progressData.currentFile,
						status: progressData.status,
					});

					// Handle file update notifications (when totalFiles is 0, it's a file update)
					if (progressData.totalFiles === 0 && progressData.currentFile) {
						setFileUpdateNotification({
							file: progressData.currentFile,
							timestamp: Date.now(),
						});

						// Clear notification after 3 seconds
						setTimeout(() => {
							setFileUpdateNotification(null);
						}, 3000);
					}

					// Stop indexing when completed or error
					if (
						progressData.status === 'completed' ||
						progressData.status === 'error'
					) {
						setCodebaseIndexing(false);

						// Start file watcher after initial indexing is completed
						if (progressData.status === 'completed' && agent) {
							agent.startWatching(watcherProgressData => {
								setCodebaseProgress({
									totalFiles: watcherProgressData.totalFiles,
									processedFiles: watcherProgressData.processedFiles,
									totalChunks: watcherProgressData.totalChunks,
									currentFile: watcherProgressData.currentFile,
									status: watcherProgressData.status,
								});

								// Handle file update notifications
								if (
									watcherProgressData.totalFiles === 0 &&
									watcherProgressData.currentFile
								) {
									setFileUpdateNotification({
										file: watcherProgressData.currentFile,
										timestamp: Date.now(),
									});

									// Clear notification after 3 seconds
									setTimeout(() => {
										setFileUpdateNotification(null);
									}, 3000);
								}
							});
							setWatcherEnabled(true);
						}
					}
				});
			} catch (error) {
				console.error('Failed to start codebase indexing:', error);
				setCodebaseIndexing(false);
			}
		};

		startCodebaseIndexing();

		// Cleanup on unmount - just stop indexing, don't close database
		// This allows resuming when returning to chat screen
		return () => {
			if (codebaseAgentRef.current) {
				codebaseAgentRef.current.stop();
				codebaseAgentRef.current.stopWatching();
				setWatcherEnabled(false);
				// Don't call close() - let it resume when returning
			}
		};
	}, []); // Only run once on mount

	// Export stop function for use in commands (like /home)
	useEffect(() => {
		// Store global reference to stop function for /home command
		(global as any).__stopCodebaseIndexing = async () => {
			if (codebaseAgentRef.current) {
				await codebaseAgentRef.current.stop();
				setCodebaseIndexing(false);
			}
		};

		return () => {
			delete (global as any).__stopCodebaseIndexing;
		};
	}, []);

	// Persist yolo mode to localStorage
	useEffect(() => {
		try {
			localStorage.setItem('snow-yolo-mode', String(yoloMode));
		} catch {
			// Ignore localStorage errors
		}
	}, [yoloMode]);

	// Clear restore input content after it's been used
	useEffect(() => {
		if (restoreInputContent !== null) {
			// Clear after a short delay to ensure ChatInput has processed it
			const timer = setTimeout(() => {
				setRestoreInputContent(null);
			}, 100);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [restoreInputContent]);

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
	}, [terminalWidth]); // stdout 对象可能在每次渲染时变化，移除以避免循环

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
		setShowUsagePanel,
		setShowHelpPanel,
		setMcpPanelKey,
		setYoloMode,
		setContextUsage: streamingState.setContextUsage,
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

		if (showUsagePanel) {
			if (key.escape) {
				setShowUsagePanel(false);
			}
			return;
		}

		if (showHelpPanel) {
			if (key.escape) {
				setShowHelpPanel(false);
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
			// Mark that user manually interrupted
			userInterruptedRef.current = true;

			// Abort the controller
			streamingState.abortController.abort();

			// Clear retry status immediately when user cancels
			streamingState.setRetryStatus(null);

			// Remove all pending tool call messages (those with toolPending: true)
			setMessages(prev => prev.filter(msg => !msg.toolPending));

			// Note: discontinued message will be added in processMessage/processPendingMessages finally block
			// Note: session cleanup will be handled in processMessage/processPendingMessages finally block
		}
	});

	const handleHistorySelect = async (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
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
				message, // Save message for restore after rollback
				images, // Save images for restore after rollback
			});
		} else {
			// No files to rollback, just rollback conversation
			// Restore message to input buffer (with or without images)
			setRestoreInputContent({
				text: message,
				images: images,
			});
			await performRollback(selectedIndex, false);
		}
	};

	const performRollback = async (
		selectedIndex: number,
		rollbackFiles: boolean,
	) => {
		const currentSession = sessionManager.getCurrentSession();

		// Rollback workspace to checkpoint if requested
		if (rollbackFiles && currentSession) {
			// Use rollbackToMessageIndex to rollback all snapshots >= selectedIndex
			await incrementalSnapshotManager.rollbackToMessageIndex(
				currentSession.id,
				selectedIndex,
			);
		}

		// For session file: find the correct truncation point based on session messages
		// We need to truncate to the same user message in the session file
		if (currentSession) {
			// Count how many user messages we're deleting (from selectedIndex onwards in UI)
			// But exclude any uncommitted user messages that weren't saved to session
			const messagesAfterSelected = messages.slice(selectedIndex);
			const hasDiscontinuedMessage = messagesAfterSelected.some(
				msg => msg.discontinued,
			);

			let uiUserMessagesToDelete = 0;
			if (hasDiscontinuedMessage) {
				// If there's a discontinued message, it means all messages from selectedIndex onwards
				// (including user messages) were not saved to session
				// So we don't need to delete any user messages from session
				uiUserMessagesToDelete = 0;
			} else {
				// Normal case: count all user messages from selectedIndex onwards
				uiUserMessagesToDelete = messagesAfterSelected.filter(
					msg => msg.role === 'user',
				).length;
			}
			// Check if the selected message is a user message that might not be in session
			// (e.g., interrupted before AI response)
			const selectedMessage = messages[selectedIndex];
			const isUncommittedUserMessage =
				selectedMessage?.role === 'user' &&
				uiUserMessagesToDelete === 1 &&
				// Check if this is the last or second-to-last message (before discontinued)
				(selectedIndex === messages.length - 1 ||
					(selectedIndex === messages.length - 2 &&
						messages[messages.length - 1]?.discontinued));

			// If this is an uncommitted user message, just truncate UI and skip session modification
			if (isUncommittedUserMessage) {
				// Check if session ends with a complete assistant response
				const lastSessionMsg =
					currentSession.messages[currentSession.messages.length - 1];
				const sessionEndsWithAssistant =
					lastSessionMsg?.role === 'assistant' && !lastSessionMsg?.tool_calls;

				if (sessionEndsWithAssistant) {
					// Session is complete, this user message wasn't saved
					// Just truncate UI, don't modify session
					setMessages(prev => prev.slice(0, selectedIndex));
					clearSavedMessages();
					setRemountKey(prev => prev + 1);
					snapshotState.setPendingRollback(null);
					return;
				}
			}

			// Special case: if rolling back to index 0 (first message), always delete entire session
			// This handles the case where user interrupts the first conversation
			let sessionTruncateIndex = currentSession.messages.length;

			if (selectedIndex === 0) {
				// Rolling back to the very first message means deleting entire session
				sessionTruncateIndex = 0;
			} else {
				// Find the corresponding user message in session to delete
				// We start from the end and count backwards
				let sessionUserMessageCount = 0;

				for (let i = currentSession.messages.length - 1; i >= 0; i--) {
					const msg = currentSession.messages[i];
					if (msg && msg.role === 'user') {
						sessionUserMessageCount++;
						if (sessionUserMessageCount === uiUserMessagesToDelete) {
							// We want to delete from this user message onwards
							sessionTruncateIndex = i;
							break;
						}
					}
				}
			}

			// Special case: rolling back to index 0 means deleting the entire session
			if (sessionTruncateIndex === 0 && currentSession) {
				// Delete all snapshots for this session
				await incrementalSnapshotManager.clearAllSnapshots(currentSession.id);

				// Delete the session file
				await sessionManager.deleteSession(currentSession.id);

				// Clear current session
				sessionManager.clearCurrentSession();

				// Clear all messages
				setMessages([]);

				// Clear saved messages
				clearSavedMessages();

				// Clear snapshot state
				snapshotState.setSnapshotFileCount(new Map());

				// Clear pending rollback dialog
				snapshotState.setPendingRollback(null);

				// Trigger remount
				setRemountKey(prev => prev + 1);

				return;
			}

			// Delete snapshot files >= selectedIndex (regardless of whether files were rolled back)
			await incrementalSnapshotManager.deleteSnapshotsFromIndex(
				currentSession.id,
				selectedIndex,
			);

			// Reload snapshot file counts from disk after deletion
			const snapshots = await incrementalSnapshotManager.listSnapshots(
				currentSession.id,
			);
			const counts = new Map<number, number>();
			for (const snapshot of snapshots) {
				counts.set(snapshot.messageIndex, snapshot.fileCount);
			}
			snapshotState.setSnapshotFileCount(counts);

			// Truncate session messages
			await sessionManager.truncateMessages(sessionTruncateIndex);
		}

		// Truncate UI messages array to remove the selected user message and everything after it
		setMessages(prev => prev.slice(0, selectedIndex));

		clearSavedMessages();
		setRemountKey(prev => prev + 1);

		// Clear pending rollback dialog
		snapshotState.setPendingRollback(null);
	};

	const handleRollbackConfirm = async (rollbackFiles: boolean | null) => {
		if (rollbackFiles === null) {
			// User cancelled - just close the dialog without doing anything
			snapshotState.setPendingRollback(null);
			return;
		}

		if (snapshotState.pendingRollback) {
			// Restore message and images to input before rollback
			if (snapshotState.pendingRollback.message) {
				setRestoreInputContent({
					text: snapshotState.pendingRollback.message,
					images: snapshotState.pendingRollback.images,
				});
			}

			await performRollback(
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
			setPendingMessages(prev => [...prev, {text: message, images}]);
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
		// 检查 token 占用，如果 >= 80% 先执行自动压缩
		if (shouldAutoCompress(currentContextPercentageRef.current)) {
			setIsCompressing(true);
			setCompressionError(null);

			try {
				// 显示压缩提示消息
				const compressingMessage: Message = {
					role: 'assistant',
					content: '✵ Auto-compressing context due to token limit...',
					streaming: false,
				};
				setMessages(prev => [...prev, compressingMessage]);

				const compressionResult = await performAutoCompression();

				if (compressionResult) {
					// 更新UI和token使用情况
					clearSavedMessages();
					setMessages(compressionResult.uiMessages);
					setRemountKey(prev => prev + 1);
					streamingState.setContextUsage(compressionResult.usage);
				} else {
					throw new Error('Compression failed');
				}
			} catch (error) {
				const errorMsg =
					error instanceof Error ? error.message : 'Unknown error';
				setCompressionError(errorMsg);

				const errorMessage: Message = {
					role: 'assistant',
					content: `**Auto-compression Failed**\n\n${errorMsg}`,
					streaming: false,
				};
				setMessages(prev => [...prev, errorMessage]);
				setIsCompressing(false);
				return; // 停止处理，等待用户手动处理
			} finally {
				setIsCompressing(false);
			}
		}

		// Clear any previous retry status when starting a new request
		streamingState.setRetryStatus(null);

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

		// Only add user message to UI if not hidden
		if (!hideUserMessage) {
			const userMessage: Message = {
				role: 'user',
				content: cleanContent,
				files: validFiles.length > 0 ? validFiles : undefined,
				images: imageContents.length > 0 ? imageContents : undefined,
			};
			setMessages(prev => [...prev, userMessage]);
		}
		streamingState.setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		streamingState.setAbortController(controller);

		try {
			// Create message for AI with file read instructions and editor context
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
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
				clearSavedMessages,
				setRemountKey,
				getCurrentContextPercentage: () => currentContextPercentageRef.current,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				// Don't return here - let finally block execute
				// Just skip error display for aborted requests
			} else {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				const finalMessage: Message = {
					role: 'assistant',
					content: `Error: ${errorMessage}`,
					streaming: false,
				};
				setMessages(prev => [...prev, finalMessage]);
			}
		} finally {
			// Handle user interruption uniformly
			if (userInterruptedRef.current) {
				// Clean up incomplete conversation in session
				const session = sessionManager.getCurrentSession();
				if (session && session.messages.length > 0) {
					(async () => {
						try {
							// Find the last complete conversation round
							const messages = session.messages;
							let truncateIndex = messages.length;

							// Scan from the end to find incomplete round
							for (let i = messages.length - 1; i >= 0; i--) {
								const msg = messages[i];
								if (!msg) continue;

								// If last message is user message without assistant response, remove it
								// The user message was saved via await saveMessage() before interruption
								// So it's safe to truncate it from session when incomplete
								if (msg.role === 'user' && i === messages.length - 1) {
									truncateIndex = i;
									break;
								}

								// If assistant message has tool_calls, verify all tool results exist
								if (
									msg.role === 'assistant' &&
									msg.tool_calls &&
									msg.tool_calls.length > 0
								) {
									const toolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
									// Check if all tool results exist after this assistant message
									for (let j = i + 1; j < messages.length; j++) {
										const followMsg = messages[j];
										if (
											followMsg &&
											followMsg.role === 'tool' &&
											followMsg.tool_call_id
										) {
											toolCallIds.delete(followMsg.tool_call_id);
										}
									}
									// If some tool results are missing, remove from this assistant message onwards
									// But only if this is the last assistant message with tool_calls in the entire conversation
									if (toolCallIds.size > 0) {
										// Additional check: ensure this is the last assistant message with tool_calls
										let hasLaterAssistantWithTools = false;
										for (let k = i + 1; k < messages.length; k++) {
											const laterMsg = messages[k];
											if (
												laterMsg?.role === 'assistant' &&
												laterMsg?.tool_calls &&
												laterMsg.tool_calls.length > 0
											) {
												hasLaterAssistantWithTools = true;
												break;
											}
										}

										// Only truncate if no later assistant messages have tool_calls
										// This preserves complete historical conversations
										if (!hasLaterAssistantWithTools) {
											truncateIndex = i;
											break;
										}
									}
								}

								// If we found a complete assistant response without tool calls, we're done
								if (msg.role === 'assistant' && !msg.tool_calls) {
									break;
								}
							}

							// Truncate session if needed
							if (truncateIndex < messages.length) {
								await sessionManager.truncateMessages(truncateIndex);
								// Also clear from saved messages tracking
								clearSavedMessages();
							}
						} catch (error) {
							console.error(
								'Failed to clean up incomplete conversation:',
								error,
							);
						}
					})();
				}

				// Add discontinued message after all processing is done
				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '',
						streaming: false,
						discontinued: true,
					},
				]);

				// Reset interruption flag
				userInterruptedRef.current = false;
			}

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

		// Clear any previous retry status when starting a new request
		streamingState.setRetryStatus(null);

		// Get current pending messages and clear them immediately
		const messagesToProcess = [...pendingMessages];
		setPendingMessages([]);

		// Combine multiple pending messages into one
		const combinedMessage = messagesToProcess.map(m => m.text).join('\n\n');

		// Parse and validate file references (same as processMessage)
		const {cleanContent, validFiles} = await parseAndValidateFileReferences(
			combinedMessage,
		);

		// Separate image files from regular files
		const imageFiles = validFiles.filter(
			f => f.isImage && f.imageData && f.mimeType,
		);
		const regularFiles = validFiles.filter(f => !f.isImage);

		// Collect all images from pending messages
		const allImages = messagesToProcess
			.flatMap(m => m.images || [])
			.concat(
				imageFiles.map(f => ({
					data: f.imageData!,
					mimeType: f.mimeType!,
				})),
			);

		// Convert to image content format
		const imageContents =
			allImages.length > 0
				? allImages.map(img => ({
						type: 'image' as const,
						data: img.data,
						mimeType: img.mimeType,
				  }))
				: undefined;

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
			// Create message for AI with file read instructions and editor context
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
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
				clearSavedMessages,
				setRemountKey,
				getCurrentContextPercentage: () => currentContextPercentageRef.current,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				// Don't return here - let finally block execute
				// Just skip error display for aborted requests
			} else {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				const finalMessage: Message = {
					role: 'assistant',
					content: `Error: ${errorMessage}`,
					streaming: false,
				};
				setMessages(prev => [...prev, finalMessage]);
			}
		} finally {
			// Handle user interruption uniformly
			if (userInterruptedRef.current) {
				// Clean up incomplete conversation in session
				const session = sessionManager.getCurrentSession();
				if (session && session.messages.length > 0) {
					(async () => {
						try {
							// Find the last complete conversation round
							const messages = session.messages;
							let truncateIndex = messages.length;

							// Scan from the end to find incomplete round
							for (let i = messages.length - 1; i >= 0; i--) {
								const msg = messages[i];
								if (!msg) continue;

								// If last message is user message without assistant response, remove it
								if (msg.role === 'user' && i === messages.length - 1) {
									truncateIndex = i;
									break;
								}

								// If assistant message has tool_calls, verify all tool results exist
								if (
									msg.role === 'assistant' &&
									msg.tool_calls &&
									msg.tool_calls.length > 0
								) {
									const toolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
									// Check if all tool results exist after this assistant message
									for (let j = i + 1; j < messages.length; j++) {
										const followMsg = messages[j];
										if (
											followMsg &&
											followMsg.role === 'tool' &&
											followMsg.tool_call_id
										) {
											toolCallIds.delete(followMsg.tool_call_id);
										}
									}
									// If some tool results are missing, remove from this assistant message onwards
									if (toolCallIds.size > 0) {
										truncateIndex = i;
										break;
									}
								}

								// If we found a complete assistant response without tool calls, we're done
								if (msg.role === 'assistant' && !msg.tool_calls) {
									break;
								}
							}

							// Truncate session if needed
							if (truncateIndex < messages.length) {
								await sessionManager.truncateMessages(truncateIndex);
								// Also clear from saved messages tracking
								clearSavedMessages();
							}
						} catch (error) {
							console.error(
								'Failed to clean up incomplete conversation:',
								error,
							);
						}
					})();
				}

				// Add discontinued message after all processing is done
				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '',
						streaming: false,
						discontinued: true,
					},
				]);

				// Reset interruption flag
				userInterruptedRef.current = false;
			}

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
								<Text>
									{(() => {
										const pasteKey =
											process.platform === 'darwin' ? 'Ctrl+V' : 'Alt+V';
										return `• Shortcuts: Ctrl+L (delete to start) • Ctrl+R (delete to end) • ${pasteKey} (paste images) • '@' (files) • '@@' (search content) • '/' (commands)`;
									})()}
								</Text>
								<Text color="gray" dimColor>
									• Working directory: {workingDirectory}
								</Text>
							</Box>
						</Box>
					</Box>,
					...messages
						.filter(m => !m.streaming)
						.map((message, index, filteredMessages) => {
							// Determine tool message type and color
							let toolStatusColor: string = 'cyan';
							let isToolMessage = false;
							const isLastMessage = index === filteredMessages.length - 1;

							// Check if this message is part of a parallel group
							const isInParallelGroup =
								message.parallelGroup !== undefined &&
								message.parallelGroup !== null;

							// Check if this is a time-consuming tool (has toolPending or starts with ⚡)
							// Time-consuming tools should not show parallel group indicators
							const isTimeConsumingTool =
								message.toolPending ||
								(message.role === 'assistant' &&
									(message.content.startsWith('⚡') ||
										message.content.includes('⚇⚡')));

							// Only show parallel group indicators for non-time-consuming tools
							const shouldShowParallelIndicator =
								isInParallelGroup && !isTimeConsumingTool;

							const isFirstInGroup =
								shouldShowParallelIndicator &&
								(index === 0 ||
									filteredMessages[index - 1]?.parallelGroup !==
										message.parallelGroup ||
									// Previous message is time-consuming tool, so this is the first non-time-consuming one
									filteredMessages[index - 1]?.toolPending ||
									filteredMessages[index - 1]?.content.startsWith('⚡'));

							// Check if this is the last message in the parallel group
							// Only show end indicator if:
							// 1. This is truly the last message, OR
							// 2. Next message has a DIFFERENT non-null parallelGroup (not just undefined)
							const nextMessage = filteredMessages[index + 1];
							const nextHasDifferentGroup =
								nextMessage &&
								nextMessage.parallelGroup !== undefined &&
								nextMessage.parallelGroup !== null &&
								nextMessage.parallelGroup !== message.parallelGroup;
							const isLastInGroup =
								shouldShowParallelIndicator &&
								(!nextMessage || nextHasDifferentGroup);

							if (message.role === 'assistant' || message.role === 'subagent') {
								if (
									message.content.startsWith('⚡') ||
									message.content.includes('⚇⚡')
								) {
									isToolMessage = true;
									toolStatusColor = 'yellowBright';
								} else if (
									message.content.startsWith('✓') ||
									message.content.includes('⚇✓')
								) {
									isToolMessage = true;
									toolStatusColor = 'green';
								} else if (
									message.content.startsWith('✗') ||
									message.content.includes('⚇✗')
								) {
									isToolMessage = true;
									toolStatusColor = 'red';
								} else {
									toolStatusColor =
										message.role === 'subagent' ? 'magenta' : 'blue';
								}
							}

							return (
								<Box
									key={`msg-${index}`}
									marginTop={index > 0 && !shouldShowParallelIndicator ? 1 : 0}
									marginBottom={isLastMessage ? 1 : 0}
									paddingX={1}
									flexDirection="column"
									width={terminalWidth}
								>
									{/* Show parallel group indicator */}
									{isFirstInGroup && (
										<Box marginBottom={0}>
											<Text color="#FF6EBF" dimColor>
												┌─ Parallel execution
											</Text>
										</Box>
									)}

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
											{shouldShowParallelIndicator && !isFirstInGroup
												? '│'
												: ''}
											{message.role === 'user'
												? '⛇'
												: message.role === 'command'
												? '⌘'
												: '❆'}
										</Text>
										<Box marginLeft={1} flexDirection="column">
											{message.role === 'command' ? (
												<>
													<Text color="gray" dimColor>
														└─ {message.commandName}
													</Text>
													{message.content && (
														<Text color="white">{message.content}</Text>
													)}
												</>
											) : (
												<>
													{message.role === 'user' || isToolMessage ? (
														<Text
															color={
																message.role === 'user'
																	? 'gray'
																	: message.content.startsWith('⚡')
																	? 'yellow'
																	: message.content.startsWith('✓')
																	? 'green'
																	: 'red'
															}
														>
															{message.content || ' '}
														</Text>
													) : (
														<MarkdownRenderer
															content={message.content || ' '}
														/>
													)}
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
														message.toolCall.name === 'filesystem-create' &&
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
													{/* Show batch edit results */}
													{message.toolCall &&
														(message.toolCall.name === 'filesystem-edit' ||
															message.toolCall.name ===
																'filesystem-edit_search') &&
														message.toolCall.arguments.isBatch &&
														message.toolCall.arguments.batchResults &&
														Array.isArray(
															message.toolCall.arguments.batchResults,
														) && (
															<Box marginTop={1} flexDirection="column">
																{message.toolCall.arguments.batchResults.map(
																	(fileResult: any, index: number) => {
																		if (
																			fileResult.success &&
																			fileResult.oldContent &&
																			fileResult.newContent
																		) {
																			return (
																				<Box
																					key={index}
																					flexDirection="column"
																					marginBottom={1}
																				>
																					<Text bold color="cyan">
																						{`File ${index + 1}: ${
																							fileResult.path
																						}`}
																					</Text>
																					<DiffViewer
																						oldContent={fileResult.oldContent}
																						newContent={fileResult.newContent}
																						filename={fileResult.path}
																						completeOldContent={
																							fileResult.completeOldContent
																						}
																						completeNewContent={
																							fileResult.completeNewContent
																						}
																						startLineNumber={
																							fileResult.contextStartLine
																						}
																					/>
																				</Box>
																			);
																		}
																		return null;
																	},
																)}
															</Box>
														)}
													{/* Show tool result preview for successful tool executions */}
													{(message.content.startsWith('✓') ||
														message.content.includes('⚇✓')) &&
														message.toolResult &&
														// 只在没有 diff 数据时显示预览（有 diff 的工具会用 DiffViewer 显示）
														!(
															message.toolCall &&
															(message.toolCall.arguments?.oldContent ||
																message.toolCall.arguments?.batchResults)
														) && (
															<ToolResultPreview
																toolName={
																	message.content
																		.replace('✓ ', '')
																		.replace(/.*⚇✓\s*/, '')
																		.split('\n')[0] || ''
																}
																result={message.toolResult}
																maxLines={5}
															/>
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

									{/* Show parallel group end indicator */}
									{isLastInGroup && (
										<Box marginTop={0}>
											<Text color="#FF6EBF" dimColor>
												└─ End parallel execution
											</Text>
										</Box>
									)}
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
													: streamingState.streamTokenCount > 0
													? 'Writing...'
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
											{streamingState.tokenSpeed > 0 && (
												<Text color="green">
													{' · '}
													{streamingState.tokenSpeed.toFixed(1)} t/s
												</Text>
											)}
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

			{/* Show usage panel if active - replaces input */}
			{showUsagePanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<UsagePanel />
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							Press ESC to close
						</Text>
					</Box>
				</Box>
			)}

			{/* Show help panel if active - replaces input */}
			{showHelpPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<HelpPanel />
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

			{/* Hide input during tool confirmation or compression or session panel or MCP panel or usage panel or help panel or rollback confirmation */}
			{!pendingToolConfirmation &&
				!isCompressing &&
				!showSessionPanel &&
				!showMcpPanel &&
				!showUsagePanel &&
				!showHelpPanel &&
				!snapshotState.pendingRollback && (
					<>
						<ChatInput
							onSubmit={handleMessageSubmit}
							onCommand={handleCommandExecution}
							placeholder="Ask me anything about coding..."
							disabled={!!pendingToolConfirmation}
							isProcessing={streamingState.isStreaming || isSaving}
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
							initialContent={restoreInputContent}
							onContextPercentageChange={setCurrentContextPercentage}
						/>
						{/* IDE connection status indicator */}
						{vscodeState.vscodeConnectionStatus !== 'disconnected' && (
							<Box marginTop={1} paddingX={1}>
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
						{/* Codebase indexing status indicator */}
						{codebaseIndexing && codebaseProgress && (
							<Box marginTop={1} paddingX={1}>
								<Text color="cyan" dimColor>
									<Spinner type="dots" /> Indexing codebase...{' '}
									{codebaseProgress.processedFiles}/
									{codebaseProgress.totalFiles} files
									{codebaseProgress.totalChunks > 0 &&
										` (${codebaseProgress.totalChunks} chunks)`}
								</Text>
							</Box>
						)}
						{/* File watcher status indicator */}
						{!codebaseIndexing && watcherEnabled && (
							<Box marginTop={1} paddingX={1}>
								<Text color="green" dimColor>
									☉ File watcher active - monitoring code changes
								</Text>
							</Box>
						)}
						{/* File update notification */}
						{fileUpdateNotification && (
							<Box marginTop={1} paddingX={1}>
								<Text color="yellow" dimColor>
									⛁ Updated: {fileUpdateNotification.file}
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
