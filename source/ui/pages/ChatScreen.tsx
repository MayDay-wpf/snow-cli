import React, {useState, useEffect, useRef, lazy, Suspense} from 'react';
import {Box, Text, useInput, Static, useStdout, useApp} from 'ink';
import Spinner from 'ink-spinner';
import ansiEscapes from 'ansi-escapes';
import {useI18n} from '../../i18n/I18nContext.js';
import {useTheme} from '../contexts/ThemeContext.js';
import ChatInput from '../components/chat/ChatInput.js';
import {type Message} from '../components/chat/MessageList.js';
import PendingMessages from '../components/chat/PendingMessages.js';
import ToolConfirmation from '../components/tools/ToolConfirmation.js';
import AskUserQuestion from '../components/special/AskUserQuestion.js';
import FileRollbackConfirmation from '../components/tools/FileRollbackConfirmation.js';
import ShimmerText from '../components/common/ShimmerText.js';
import MessageRenderer from '../components/chat/MessageRenderer.js';
import StatusLine from '../components/common/StatusLine.js';
import ChatHeader from '../components/special/ChatHeader.js';

// Lazy load panel components to reduce initial bundle size
const MCPInfoPanel = lazy(() => import('../components/panels/MCPInfoPanel.js'));
const SessionListPanel = lazy(
	() => import('../components/panels/SessionListPanel.js'),
);
const UsagePanel = lazy(() => import('../components/panels/UsagePanel.js'));
const HelpPanel = lazy(() => import('../components/panels/HelpPanel.js'));
import {CustomCommandConfigPanel} from '../components/panels/CustomCommandConfigPanel.js';
import {SkillsCreationPanel} from '../components/panels/SkillsCreationPanel.js';
import {
	saveCustomCommand,
	registerCustomCommands,
} from '../../utils/commands/custom.js';
import {
	createSkillTemplate,
	type SkillLocation,
} from '../../utils/commands/skills.js';
import {getOpenAiConfig} from '../../utils/config/apiConfig.js';
import {getSimpleMode} from '../../utils/config/themeConfig.js';
import {
	getActiveProfileName,
	getNextProfileName,
	switchProfile,
	getAllProfiles,
} from '../../utils/config/configManager.js';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {useSessionSave} from '../../hooks/session/useSessionSave.js';
import {useToolConfirmation} from '../../hooks/conversation/useToolConfirmation.js';
import {handleConversationWithTools} from '../../hooks/conversation/useConversation.js';
import {promptOptimizeAgent} from '../../agents/promptOptimizeAgent.js';
import {useVSCodeState} from '../../hooks/integration/useVSCodeState.js';
import {useSnapshotState} from '../../hooks/session/useSnapshotState.js';
import {useStreamingState} from '../../hooks/conversation/useStreamingState.js';
import {useCommandHandler} from '../../hooks/conversation/useCommandHandler.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {
	parseAndValidateFileReferences,
	createMessageWithFileInstructions,
	cleanIDEContext,
} from '../../utils/core/fileUtils.js';
import {vscodeConnection} from '../../utils/ui/vscodeConnection.js';
import {convertSessionMessagesToUI} from '../../utils/session/sessionConverter.js';
import {incrementalSnapshotManager} from '../../utils/codebase/incrementalSnapshot.js';
import {formatElapsedTime} from '../../utils/core/textUtils.js';
import {
	shouldAutoCompress,
	performAutoCompression,
} from '../../utils/core/autoCompress.js';
import {CodebaseIndexAgent} from '../../agents/codebaseIndexAgent.js';
import {reindexCodebase} from '../../utils/codebase/reindexCodebase.js';
import {loadCodebaseConfig} from '../../utils/config/codebaseConfig.js';
import {codebaseSearchEvents} from '../../utils/codebase/codebaseSearchEvents.js';
import {logger} from '../../utils/core/logger.js';

// Commands will be loaded dynamically after mount to avoid blocking initial render

type Props = {
	autoResume?: boolean;
	enableYolo?: boolean;
};

export default function ChatScreen({autoResume, enableYolo}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const {exit} = useApp();
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
	const [currentContextPercentage, setCurrentContextPercentage] = useState(0); // Track context percentage from ChatInput
	const currentContextPercentageRef = useRef(0); // Use ref to avoid closure issues

	// Sync state to ref
	useEffect(() => {
		currentContextPercentageRef.current = currentContextPercentage;
	}, [currentContextPercentage]);
	const [yoloMode, setYoloMode] = useState(() => {
		// If enableYolo prop is provided (from --yolo flag), use it
		if (enableYolo !== undefined) {
			return enableYolo;
		}
		// Otherwise load yolo mode from localStorage on initialization
		try {
			const saved = localStorage.getItem('snow-yolo-mode');
			return saved === 'true';
		} catch {
			return false;
		}
	});
	const [planMode, setPlanMode] = useState(() => {
		// Load plan mode from localStorage on initialization
		try {
			const saved = localStorage.getItem('snow-plan-mode');
			return saved === 'true';
		} catch {
			return false;
		}
	});
	const [simpleMode, setSimpleMode] = useState(() => {
		// Load simple mode from config
		return getSimpleMode();
	});
	const [isCompressing, setIsCompressing] = useState(false);
	const [compressionError, setCompressionError] = useState<string | null>(null);
	const [showSessionPanel, setShowSessionPanel] = useState(false);
	const [showMcpPanel, setShowMcpPanel] = useState(false);
	const [showUsagePanel, setShowUsagePanel] = useState(false);
	const [showHelpPanel, setShowHelpPanel] = useState(false);
	const [showCustomCommandConfig, setShowCustomCommandConfig] = useState(false);
	const [showSkillsCreation, setShowSkillsCreation] = useState(false);
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

	// Profile state for quick switch
	const [currentProfileName, setCurrentProfileName] = useState(() => {
		const profiles = getAllProfiles();
		const activeName = getActiveProfileName();
		const profile = profiles.find(p => p.name === activeName);
		return profile?.displayName || activeName;
	});

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

	// Track if commands are loaded
	const [commandsLoaded, setCommandsLoaded] = useState(false);

	// Load commands dynamically to avoid blocking initial render
	useEffect(() => {
		// Use Promise.all to load all commands in parallel
		Promise.all([
			import('../../utils/commands/clear.js'),
			import('../../utils/commands/resume.js'),
			import('../../utils/commands/mcp.js'),
			import('../../utils/commands/yolo.js'),
			import('../../utils/commands/plan.js'),
			import('../../utils/commands/init.js'),
			import('../../utils/commands/ide.js'),
			import('../../utils/commands/compact.js'),
			import('../../utils/commands/home.js'),
			import('../../utils/commands/review.js'),
			import('../../utils/commands/role.js'),
			import('../../utils/commands/usage.js'),
			import('../../utils/commands/export.js'),
			import('../../utils/commands/agent.js'),
			import('../../utils/commands/todoPicker.js'),
			import('../../utils/commands/help.js'),
			import('../../utils/commands/custom.js'),
			import('../../utils/commands/skills.js'),
			import('../../utils/commands/quit.js'),
			import('../../utils/commands/reindex.js'),
		])
			.then(async () => {
				// Load and register custom commands from user directory
				await registerCustomCommands();
				setCommandsLoaded(true);
			})
			.catch(error => {
				console.error('Failed to load commands:', error);
				// Still mark as loaded to allow app to continue
				setCommandsLoaded(true);
			});
	}, []);

	// Auto-start codebase indexing on mount if enabled
	useEffect(() => {
		const startCodebaseIndexing = async () => {
			try {
				// Always reload config to check for changes (e.g., from /home command)
				const config = loadCodebaseConfig();

				// Only start if enabled and not already indexing
				if (!config.enabled || codebaseIndexing) {
					// If codebase was disabled and agent is running, stop it
					if (!config.enabled && codebaseAgentRef.current) {
						logger.info('Codebase feature disabled, stopping agent');
						await codebaseAgentRef.current.stop();
						codebaseAgentRef.current.stopWatching();
						codebaseAgentRef.current = null;
						setCodebaseIndexing(false);
						setWatcherEnabled(false);
					}
					return;
				}

				// Initialize agent
				const agent = new CodebaseIndexAgent(workingDirectory);
				codebaseAgentRef.current = agent;

				// Check if indexing is needed
				const progress = await agent.getProgress();

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
					setCodebaseIndexing(false); // Ensure loading UI is hidden
					return;
				}

				// If watcher was enabled before but indexing not completed, restore it
				const wasWatcherEnabled = await agent.isWatcherEnabled();
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
					setCodebaseIndexing(false); // Ensure loading UI is hidden when restoring watcher
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

	// Persist plan mode to localStorage
	useEffect(() => {
		try {
			localStorage.setItem('snow-plan-mode', String(planMode));
		} catch {
			// Ignore localStorage errors
		}
	}, [planMode]);

	// Sync simple mode from config periodically to reflect theme settings changes
	useEffect(() => {
		const interval = setInterval(() => {
			const currentSimpleMode = getSimpleMode();
			if (currentSimpleMode !== simpleMode) {
				setSimpleMode(currentSimpleMode);
			}
		}, 1000); // Check every second

		return () => clearInterval(interval);
	}, [simpleMode]);

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

	// Auto-resume last session when autoResume is true
	useEffect(() => {
		if (!autoResume) {
			// Clear any residual session when entering chat without auto-resume
			// This ensures a clean start when user hasn't sent first message yet
			sessionManager.clearCurrentSession();
			return;
		}

		const resumeSession = async () => {
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

		resumeSession();
	}, [autoResume, initializeFromSession]);

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

	// State for askuser tool interaction
	const [pendingUserQuestion, setPendingUserQuestion] = useState<{
		question: string;
		options: string[];
		toolCall: any;
		resolve: (result: {selected: string; customInput?: string}) => void;
	} | null>(null);

	// Request user question callback for askuser tool
	const requestUserQuestion = async (
		question: string,
		options: string[],
		toolCall: any,
	): Promise<{selected: string; customInput?: string}> => {
		return new Promise(resolve => {
			setPendingUserQuestion({
				question,
				options,
				toolCall,
				resolve,
			});
		});
	};

	// Handle user question answer
	const handleUserQuestionAnswer = (result: {
		selected: string;
		customInput?: string;
	}) => {
		if (pendingUserQuestion) {
			pendingUserQuestion.resolve(result);
			setPendingUserQuestion(null);
		}
	};

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
	// Handle quit command - clean up resources and exit application
	const handleQuit = async () => {
		// Show exiting message
		setMessages(prev => [
			...prev,
			{
				role: 'command',
				content: t.hooks.exitingApplication,
			},
		]);

		// 设置超时机制，防止卡死
		const quitTimeout = setTimeout(() => {
			// 超时后强制退出
			process.exit(0);
		}, 3000); // 3秒超时

		try {
			// Stop codebase indexing agent with timeout
			if (codebaseAgentRef.current) {
				const agent = codebaseAgentRef.current;
				await Promise.race([
					(async () => {
						await agent.stop();
						agent.stopWatching();
					})(),
					new Promise(resolve => setTimeout(resolve, 2000)), // 2秒超时
				]);
			}

			// Stop VSCode connection (同步操作，不需要超时)
			if (
				vscodeConnection.isConnected() ||
				vscodeConnection.isClientRunning()
			) {
				vscodeConnection.stop();
			}

			// 清除超时计时器
			clearTimeout(quitTimeout);

			// Exit the application
			exit();
		} catch (error) {
			// 出现错误时也要清除超时计时器
			clearTimeout(quitTimeout);
			// 强制退出
			process.exit(0);
		}
	};

	// Handle reindex codebase command
	const handleReindexCodebase = async () => {
		const workingDirectory = process.cwd();

		setCodebaseIndexing(true);

		try {
			// Use the reindexCodebase utility function
			const agent = await reindexCodebase(
				workingDirectory,
				codebaseAgentRef.current,
				progressData => {
					setCodebaseProgress({
						totalFiles: progressData.totalFiles,
						processedFiles: progressData.processedFiles,
						totalChunks: progressData.totalChunks,
						currentFile: progressData.currentFile,
						status: progressData.status,
					});

					if (
						progressData.status === 'completed' ||
						progressData.status === 'error'
					) {
						setCodebaseIndexing(false);
					}
				},
			);

			// Update the agent reference
			codebaseAgentRef.current = agent;

			// Start file watcher after reindexing is completed
			if (agent) {
				agent.startWatching(watcherProgressData => {
					setCodebaseProgress({
						totalFiles: watcherProgressData.totalFiles,
						processedFiles: watcherProgressData.processedFiles,
						totalChunks: watcherProgressData.totalChunks,
						currentFile: watcherProgressData.currentFile,
						status: watcherProgressData.status,
					});

					if (
						watcherProgressData.totalFiles === 0 &&
						watcherProgressData.currentFile
					) {
						setFileUpdateNotification({
							file: watcherProgressData.currentFile,
							timestamp: Date.now(),
						});

						setTimeout(() => {
							setFileUpdateNotification(null);
						}, 3000);
					}
				});
				setWatcherEnabled(true);
			}
		} catch (error) {
			setCodebaseIndexing(false);
			throw error;
		}
	};

	const {handleCommandExecution} = useCommandHandler({
		messages,
		setMessages,
		setRemountKey,
		clearSavedMessages,
		setIsCompressing,
		setCompressionError,
		setShowSessionPanel,
		setShowMcpPanel,
		setShowUsagePanel,
		setShowHelpPanel,
		setShowCustomCommandConfig,
		setShowSkillsCreation,
		setYoloMode,
		setPlanMode,
		setContextUsage: streamingState.setContextUsage,
		setCurrentContextPercentage,
		setVscodeConnectionStatus: vscodeState.setVscodeConnectionStatus,
		processMessage: (message, images, useBasicModel, hideUserMessage) =>
			processMessageRef.current?.(
				message,
				images,
				useBasicModel,
				hideUserMessage,
			) || Promise.resolve(),
		onQuit: handleQuit,
		onReindexCodebase: handleReindexCodebase,
	});

	useEffect(() => {
		// Wait for commands to be loaded before attempting auto-connect
		if (!commandsLoaded) {
			return;
		}

		if (hasAttemptedAutoVscodeConnect.current) {
			return;
		}

		if (vscodeState.vscodeConnectionStatus !== 'disconnected') {
			hasAttemptedAutoVscodeConnect.current = true;
			return;
		}

		hasAttemptedAutoVscodeConnect.current = true;

		// Auto-connect IDE in background without blocking UI
		// Use setTimeout to defer execution and make it fully async
		const timer = setTimeout(() => {
			// Fire and forget - don't wait for result
			(async () => {
				try {
					// Clean up any existing connection state first (like manual /ide does)
					if (
						vscodeConnection.isConnected() ||
						vscodeConnection.isClientRunning()
					) {
						vscodeConnection.stop();
						vscodeConnection.resetReconnectAttempts();
						await new Promise(resolve => setTimeout(resolve, 100));
					}

					// Set connecting status after cleanup
					vscodeState.setVscodeConnectionStatus('connecting');

					// Now try to connect
					await vscodeConnection.start();

					// If we get here, connection succeeded
					// Status will be updated by useVSCodeState hook monitoring
				} catch (error) {
					// Silently handle connection failure - set error status instead of throwing
					vscodeState.setVscodeConnectionStatus('error');
				}
			})();
		}, 0);

		return () => clearTimeout(timer);
	}, [commandsLoaded]);

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

	// Listen to codebase search events
	useEffect(() => {
		const handleSearchEvent = (event: {
			type: 'search-start' | 'search-retry' | 'search-complete';
			attempt: number;
			maxAttempts: number;
			currentTopN: number;
			message: string;
		}) => {
			if (event.type === 'search-complete') {
				// Clear status after completion
				streamingState.setCodebaseSearchStatus(null);
			} else {
				// Update search status
				streamingState.setCodebaseSearchStatus({
					isSearching: true,
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					currentTopN: event.currentTopN,
					message: event.message,
				});
			}
		};

		codebaseSearchEvents.onSearchEvent(handleSearchEvent);

		return () => {
			codebaseSearchEvents.removeSearchEventListener(handleSearchEvent);
		};
	}, [streamingState]);

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

		if (showCustomCommandConfig) {
			if (key.escape) {
				setShowCustomCommandConfig(false);
			}
			return;
		}

		if (showSkillsCreation) {
			if (key.escape) {
				setShowSkillsCreation(false);
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

	// Handle profile switching (Ctrl+P shortcut)
	const handleSwitchProfile = () => {
		// Don't switch if any panel is open or streaming
		if (
			showSessionPanel ||
			showMcpPanel ||
			showUsagePanel ||
			showHelpPanel ||
			showCustomCommandConfig ||
			showSkillsCreation ||
			snapshotState.pendingRollback ||
			pendingToolConfirmation ||
			pendingUserQuestion ||
			streamingState.isStreaming
		) {
			return;
		}

		// Get next profile and switch
		const nextProfileName = getNextProfileName();
		switchProfile(nextProfileName);

		// Update display name
		const profiles = getAllProfiles();
		const profile = profiles.find(p => p.name === nextProfileName);
		setCurrentProfileName(profile?.displayName || nextProfileName);
	};

	const handleHistorySelect = async (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => {
		// Clear context percentage and usage when user performs history rollback
		setCurrentContextPercentage(0);
		currentContextPercentageRef.current = 0;
		streamingState.setContextUsage(null);

		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) return;

		// 检查是否需要跨会话回滚（仅适用于新版本压缩产生的会话）
		// 条件：选择 index 0（压缩摘要），且当前会话有 compressedFrom 字段（新版本）
		if (
			selectedIndex === 0 &&
			currentSession.compressedFrom !== undefined &&
			currentSession.compressedFrom !== null
		) {
			// 需要跨会话回滚到原会话
			const originalSessionId = currentSession.compressedFrom;

			try {
				// 加载原会话
				const originalSession = await sessionManager.loadSession(
					originalSessionId,
				);
				if (!originalSession) {
					console.error('Failed to load original session for rollback');
					// 失败则继续正常回滚流程
				} else {
					// 切换到原会话
					sessionManager.setCurrentSession(originalSession);

					// 转换原会话消息为UI格式
					const {convertSessionMessagesToUI} = await import(
						'../../utils/session/sessionConverter.js'
					);
					const uiMessages = convertSessionMessagesToUI(
						originalSession.messages,
					);

					// 更新UI
					clearSavedMessages();
					setMessages(uiMessages);
					setRemountKey(prev => prev + 1);

					// 加载原会话的快照计数
					const snapshots = await incrementalSnapshotManager.listSnapshots(
						originalSession.id,
					);
					const counts = new Map<number, number>();
					for (const snapshot of snapshots) {
						counts.set(snapshot.messageIndex, snapshot.fileCount);
					}
					snapshotState.setSnapshotFileCount(counts);

					// 提示用户已切换到原会话
					console.log(
						`Switched to original session (before compression) with ${originalSession.messageCount} messages`,
					);

					return;
				}
			} catch (error) {
				console.error('Failed to switch to original session:', error);
				// 失败则继续正常回滚流程
			}
		}

		// 正常的当前会话内回滚逻辑（兼容旧版本会话）
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
			const filePaths = await incrementalSnapshotManager.getFilesToRollback(
				currentSession.id,
				selectedIndex,
			);
			snapshotState.setPendingRollback({
				messageIndex: selectedIndex,
				fileCount: filePaths.length, // Use actual unique file count
				filePaths,
				message: cleanIDEContext(message), // Clean IDE context before saving
				images, // Save images for restore after rollback
			});
		} else {
			// No files to rollback, just rollback conversation
			// Restore message to input buffer (with or without images)
			setRestoreInputContent({
				text: cleanIDEContext(message), // Clean IDE context before restoring
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

				// Display warning AFTER loading session (if any)
				if (sessionManager.lastLoadHookWarning) {
					console.log(sessionManager.lastLoadHookWarning);
				}
			} else {
				// Session load failed - check if it's due to hook failure
				if (sessionManager.lastLoadHookError) {
					// Display hook error using HookErrorDisplay component
					const errorMessage: Message = {
						role: 'assistant',
						content: '', // Content will be rendered by HookErrorDisplay
						hookError: sessionManager.lastLoadHookError,
					};
					setMessages(prev => [...prev, errorMessage]);
				} else {
					// Generic error
					const errorMessage: Message = {
						role: 'assistant',
						content: 'Failed to load session.',
					};
					setMessages(prev => [...prev, errorMessage]);
				}
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

		// Execute onUserMessage hook before processing
		try {
			const {unifiedHooksExecutor} = await import(
				'../../utils/execution/unifiedHooksExecutor.js'
			);
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'onUserMessage',
				{
					message,
					imageCount: images?.length || 0,
					source: 'normal',
				},
			);
			// Handle hook result using centralized handler
			const {handleHookResult} = await import(
				'../../utils/execution/hookResultHandler.js'
			);
			const handlerResult = handleHookResult(hookResult, message);

			if (!handlerResult.shouldContinue && handlerResult.errorDetails) {
				// Critical error: display using HookErrorDisplay component
				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '', // Content will be rendered by HookErrorDisplay
						timestamp: new Date(),
						hookError: handlerResult.errorDetails,
					},
				]);
				return; // Abort - don't send to AI
			}

			// Update message with any modifications (e.g., warning appended)
			message = handlerResult.modifiedMessage!;
		} catch (error) {
			console.error('Failed to execute onUserMessage hook:', error);
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
		// 检查 token 占用，如果 >= 80% 且配置启用了自动压缩，先执行自动压缩
		const autoCompressConfig = getOpenAiConfig();
		if (
			autoCompressConfig.enableAutoCompress !== false &&
			shouldAutoCompress(currentContextPercentageRef.current)
		) {
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

				// 获取当前会话ID并传递给压缩函数
				const session = sessionManager.getCurrentSession();
				const compressionResult = await performAutoCompression(session?.id);

				if (compressionResult) {
					// 更新UI和token使用情况
					clearSavedMessages();
					setMessages(compressionResult.uiMessages);
					setRemountKey(prev => prev + 1);
					streamingState.setContextUsage(compressionResult.usage);

					// 压缩创建了新会话，新会话的快照系统是独立的
					// 清空当前的快照计数，因为新会话还没有快照
					snapshotState.setSnapshotFileCount(new Map());
				} else {
					// 压缩失败或跳过，移除压缩提示消息，继续执行
					setMessages(prev => prev.filter(m => m !== compressingMessage));
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

		// Parse and validate file references (use original message for immediate UI display)
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
			...imageFiles.map(f => {
				// Extract base64 data from data URL (format: data:image/svg+xml;base64,...)
				let base64Data = f.imageData!;
				const base64Match = base64Data.match(/^data:[^;]+;base64,(.+)$/);
				if (base64Match && base64Match[1]) {
					base64Data = base64Match[1];
				}
				return {
					type: 'image' as const,
					data: base64Data,
					mimeType: f.mimeType!,
				};
			}),
		];

		// Only add user message to UI if not hidden (显示原始用户消息)
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

		// Optimize user prompt in the background (silent execution)
		let originalMessage = message;
		let optimizedMessage = message;
		let optimizedCleanContent = cleanContent;

		// Check if prompt optimization is enabled in config
		const config = getOpenAiConfig();
		const isOptimizationEnabled = config.enablePromptOptimization !== false; // Default to true

		if (isOptimizationEnabled) {
			try {
				// Convert current UI messages to ChatMessage format for context
				const conversationHistory = messages
					.filter(m => m.role === 'user' || m.role === 'assistant')
					.map(m => ({
						role: m.role as 'user' | 'assistant',
						content: typeof m.content === 'string' ? m.content : '',
					}));

				// Try to optimize the prompt (background execution)
				optimizedMessage = await promptOptimizeAgent.optimizePrompt(
					message,
					conversationHistory,
					controller.signal,
				);

				// Re-parse the optimized message to get clean content for AI
				if (optimizedMessage !== originalMessage) {
					const optimizedParsed = await parseAndValidateFileReferences(
						optimizedMessage,
					);
					optimizedCleanContent = optimizedParsed.cleanContent;
				}
			} catch (error) {
				// If optimization fails, silently fall back to original message
				logger.warn('Prompt optimization failed, using original:', error);
			}
		}

		try {
			// Create message for AI with file read instructions and editor context (使用优化后的内容)
			const messageForAI = createMessageWithFileInstructions(
				optimizedCleanContent,
				regularFiles,
				vscodeState.vscodeConnected ? vscodeState.editorContext : undefined,
			);

			// Wrap saveMessage to add originalContent for user messages
			const saveMessageWithOriginal = async (msg: any) => {
				// If this is a user message and we have an optimized version, add originalContent
				if (msg.role === 'user' && optimizedMessage !== originalMessage) {
					await saveMessage({
						...msg,
						originalContent: originalMessage,
					});
				} else {
					await saveMessage(msg);
				}
			};

			// Start conversation with tool support
			await handleConversationWithTools({
				userContent: messageForAI,
				imageContents,
				controller,
				messages,
				saveMessage: saveMessageWithOriginal,
				setMessages,
				setStreamTokenCount: streamingState.setStreamTokenCount,
				requestToolConfirmation,
				requestUserQuestion,
				isToolAutoApproved,
				addMultipleToAlwaysApproved,
				yoloMode,
				planMode, // Pass planMode to use correct system prompt
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

		// Execute onUserMessage hook for pending messages
		let messageToSend = combinedMessage;
		try {
			const {unifiedHooksExecutor} = await import(
				'../../utils/execution/unifiedHooksExecutor.js'
			);
			const allImages = messagesToProcess.flatMap(m => m.images || []);
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'onUserMessage',
				{
					message: combinedMessage,
					imageCount: allImages.length,
					source: 'pending',
				},
			);
			// Handle hook result using centralized handler
			const {handleHookResult} = await import(
				'../../utils/execution/hookResultHandler.js'
			);
			const handlerResult = handleHookResult(hookResult, combinedMessage);

			if (!handlerResult.shouldContinue && handlerResult.errorDetails) {
				// Critical error: display using HookErrorDisplay component
				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '', // Content will be rendered by HookErrorDisplay
						timestamp: new Date(),
						hookError: handlerResult.errorDetails,
					},
				]);
				return; // Abort - don't send to AI
			}

			// Update message with any modifications (e.g., warning appended)
			messageToSend = handlerResult.modifiedMessage!;
		} catch (error) {
			console.error('Failed to execute onUserMessage hook:', error);
		}

		// Parse and validate file references (same as processMessage)
		const {cleanContent, validFiles} = await parseAndValidateFileReferences(
			messageToSend,
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
				imageFiles.map(f => {
					// Extract base64 data from data URL (format: data:image/svg+xml;base64,...)
					let base64Data = f.imageData!;
					const base64Match = base64Data.match(/^data:[^;]+;base64,(.+)$/);
					if (base64Match && base64Match[1]) {
						base64Data = base64Match[1];
					}
					return {
						data: base64Data,
						mimeType: f.mimeType!,
					};
				}),
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
				requestUserQuestion,
				isToolAutoApproved,
				addMultipleToAlwaysApproved,
				yoloMode,
				planMode, // Pass planMode to use correct system prompt
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

	// Show warning if terminal is too small
	if (terminalHeight < MIN_TERMINAL_HEIGHT) {
		return (
			<Box flexDirection="column" padding={2}>
				<Box borderStyle="round" borderColor="red" padding={1}>
					<Text color="red" bold>
						{t.chatScreen.terminalTooSmall}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="yellow">
						{t.chatScreen.terminalResizePrompt
							.replace('{current}', terminalHeight.toString())
							.replace('{required}', MIN_TERMINAL_HEIGHT.toString())}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.chatScreen.terminalMinHeight}
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
					<ChatHeader
						key="header"
						terminalWidth={terminalWidth}
						simpleMode={simpleMode}
						workingDirectory={workingDirectory}
					/>,
					...messages
						.filter(m => !m.streaming)
						.map((message, index, filteredMessages) => {
							const isLastMessage = index === filteredMessages.length - 1;
							return (
								<MessageRenderer
									key={`msg-${index}`}
									message={message}
									index={index}
									isLastMessage={isLastMessage}
									filteredMessages={filteredMessages}
									terminalWidth={terminalWidth}
								/>
							);
						}),
				]}
			>
				{item => item}
			</Static>

			{/* Show loading indicator when streaming or saving */}
			{(streamingState.isStreaming || isSaving) &&
				!pendingToolConfirmation &&
				!pendingUserQuestion && (
					<Box marginBottom={1} paddingX={1} width={terminalWidth}>
						<Text
							color={
								[
									theme.colors.menuInfo,
									theme.colors.success,
									theme.colors.menuSelected,
									theme.colors.menuInfo,
									theme.colors.menuSecondary,
								][streamingState.animationFrame] as any
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
									) : streamingState.codebaseSearchStatus?.isSearching ? (
										// Codebase search retry status
										<Box flexDirection="column">
											<Text color="cyan" dimColor>
												⏏ Codebase Search (Attempt{' '}
												{streamingState.codebaseSearchStatus.attempt}/
												{streamingState.codebaseSearchStatus.maxAttempts})
											</Text>
											<Text color={theme.colors.menuSecondary} dimColor>
												{streamingState.codebaseSearchStatus.message}
											</Text>
										</Box>
									) : (
										// Normal thinking status
										<Text color={theme.colors.menuSecondary} dimColor>
											<ShimmerText
												text={
													streamingState.isReasoning
														? t.chatScreen.statusDeepThinking
														: streamingState.streamTokenCount > 0
														? t.chatScreen.statusWriting
														: t.chatScreen.statusThinking
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
								<Text color={theme.colors.menuSecondary} dimColor>
									{t.chatScreen.sessionCreating}
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

			{/* Show user question panel if askuser tool is called */}
			{pendingUserQuestion && (
				<AskUserQuestion
					question={pendingUserQuestion.question}
					options={pendingUserQuestion.options}
					onAnswer={handleUserQuestionAnswer}
				/>
			)}

			{/* Show session list panel if active - replaces input */}
			{showSessionPanel && (
				<Box paddingX={1} width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> Loading...
								</Text>
							</Box>
						}
					>
						<SessionListPanel
							onSelectSession={handleSessionPanelSelect}
							onClose={() => setShowSessionPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{/* Show MCP info panel if active - replaces input */}
			{showMcpPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> Loading...
								</Text>
							</Box>
						}
					>
						<MCPInfoPanel />
					</Suspense>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.chatScreen.pressEscToClose}
						</Text>
					</Box>
				</Box>
			)}

			{/* Show usage panel if active - replaces input */}
			{showUsagePanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> Loading...
								</Text>
							</Box>
						}
					>
						<UsagePanel />
					</Suspense>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.chatScreen.pressEscToClose}
						</Text>
					</Box>
				</Box>
			)}

			{/* Show help panel if active - replaces input */}
			{showHelpPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> Loading...
								</Text>
							</Box>
						}
					>
						<HelpPanel />
					</Suspense>
				</Box>
			)}

			{/* Show custom command config panel if active */}
			{showCustomCommandConfig && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<CustomCommandConfigPanel
						onSave={async (
							name: string,
							command: string,
							type: 'execute' | 'prompt',
						) => {
							await saveCustomCommand(name, command, type);
							await registerCustomCommands();
							setShowCustomCommandConfig(false);
							const typeDesc =
								type === 'execute' ? 'Execute in terminal' : 'Send to AI';
							const successMessage: Message = {
								role: 'command',
								content: `Custom command '${name}' saved successfully! Type: ${typeDesc}. You can now use /${name}`,
								commandName: 'custom',
							};
							setMessages(prev => [...prev, successMessage]);
						}}
						onCancel={() => setShowCustomCommandConfig(false)}
					/>
				</Box>
			)}

			{/* Show skills creation panel if active */}
			{showSkillsCreation && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<SkillsCreationPanel
						projectRoot={workingDirectory}
						onSave={async (
							skillName: string,
							description: string,
							location: SkillLocation,
						) => {
							const result = await createSkillTemplate(
								skillName,
								description,
								location,
								workingDirectory,
							);
							setShowSkillsCreation(false);

							if (result.success) {
								const locationDesc =
									location === 'global'
										? 'Global (~/.snow/skills/)'
										: 'Project (.snow/skills/)';
								const successMessage: Message = {
									role: 'command',
									content: `Skill '${skillName}' created successfully!\nLocation: ${locationDesc}\nPath: ${result.path}\n\nThe following files have been created:\n- SKILL.md (main skill documentation)\n- reference.md (detailed reference)\n- examples.md (usage examples)\n- templates/template.txt (template file)\n- scripts/helper.py (helper script)\n\nYou can now edit these files to customize your skill.`,
									commandName: 'skills',
								};
								setMessages(prev => [...prev, successMessage]);
							} else {
								const errorMessage: Message = {
									role: 'command',
									content: `Failed to create skill: ${result.error}`,
									commandName: 'skills',
								};
								setMessages(prev => [...prev, errorMessage]);
							}
						}}
						onCancel={() => setShowSkillsCreation(false)}
					/>
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

			{/* Hide input during tool confirmation or compression or session panel or MCP panel or usage panel or help panel or custom command config or skills creation or rollback confirmation or user question */}
			{!pendingToolConfirmation &&
				!pendingUserQuestion &&
				!isCompressing &&
				!showSessionPanel &&
				!showMcpPanel &&
				!showUsagePanel &&
				!showHelpPanel &&
				!showCustomCommandConfig &&
				!showSkillsCreation &&
				!snapshotState.pendingRollback && (
					<>
						<ChatInput
							onSubmit={handleMessageSubmit}
							onCommand={handleCommandExecution}
							placeholder={t.chatScreen.inputPlaceholder}
							disabled={!!pendingToolConfirmation}
							isProcessing={streamingState.isStreaming || isSaving}
							chatHistory={messages}
							onHistorySelect={handleHistorySelect}
							yoloMode={yoloMode}
							setYoloMode={setYoloMode}
							planMode={planMode}
							setPlanMode={setPlanMode}
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
							onSwitchProfile={handleSwitchProfile}
						/>
						{/* Unified status line component */}
						<StatusLine
							yoloMode={yoloMode}
							planMode={planMode}
							vscodeConnectionStatus={vscodeState.vscodeConnectionStatus}
							editorContext={vscodeState.editorContext}
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
							codebaseIndexing={codebaseIndexing}
							codebaseProgress={codebaseProgress}
							watcherEnabled={watcherEnabled}
							fileUpdateNotification={fileUpdateNotification}
							currentProfileName={currentProfileName}
						/>
					</>
				)}

			{/* Context compression status indicator - always visible when compressing */}
			{isCompressing && (
				<Box marginTop={1}>
					<Text color="cyan">
						<Spinner type="dots" /> {t.chatScreen.compressionInProgress}
					</Text>
				</Box>
			)}

			{/* Compression error indicator */}
			{compressionError && (
				<Box marginTop={1}>
					<Text color="red">
						{t.chatScreen.compressionFailed.replace(
							'{error}',
							compressionError,
						)}
					</Text>
				</Box>
			)}
		</Box>
	);
}
