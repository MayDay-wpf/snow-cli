import React, {
	useState,
	useEffect,
	useRef,
	useMemo,
	lazy,
	Suspense,
} from 'react';
import {Box, Text, useInput, Static, useStdout, useApp} from 'ink';
import Spinner from 'ink-spinner';
import ansiEscapes from 'ansi-escapes';
import {useI18n} from '../../i18n/I18nContext.js';
import {useTheme} from '../contexts/ThemeContext.js';
import ChatFooter from '../components/chat/ChatFooter.js';
import {type Message} from '../components/chat/MessageList.js';
import PendingMessages from '../components/chat/PendingMessages.js';
import ToolConfirmation from '../components/tools/ToolConfirmation.js';
import AskUserQuestion from '../components/special/AskUserQuestion.js';
import {
	BashCommandConfirmation,
	BashCommandExecutionStatus,
} from '../components/bash/BashCommandConfirmation.js';
import {CustomCommandExecutionDisplay} from '../components/bash/CustomCommandExecutionDisplay.js';
import FileRollbackConfirmation from '../components/tools/FileRollbackConfirmation.js';
import MessageRenderer from '../components/chat/MessageRenderer.js';
import ChatHeader from '../components/special/ChatHeader.js';
import LoadingIndicator from '../components/chat/LoadingIndicator.js';
import {HookErrorDisplay} from '../components/special/HookErrorDisplay.js';
import type {HookErrorDetails} from '../../utils/execution/hookResultHandler.js';

// Lazy load panel components to reduce initial bundle size
import PanelsManager from '../components/panels/PanelsManager.js';
const PermissionsPanel = lazy(
	() => import('../components/panels/PermissionsPanel.js'),
);
import {
	saveCustomCommand,
	registerCustomCommands,
} from '../../utils/commands/custom.js';
import {
	createSkillFromGenerated,
	createSkillTemplate,
} from '../../utils/commands/skills.js';
import {getOpenAiConfig} from '../../utils/config/apiConfig.js';
import {getSimpleMode} from '../../utils/config/themeConfig.js';
import {getAllProfiles} from '../../utils/config/configManager.js';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {useSessionSave} from '../../hooks/session/useSessionSave.js';
import {useToolConfirmation} from '../../hooks/conversation/useToolConfirmation.js';
import {useChatLogic} from '../../hooks/conversation/useChatLogic.js';
import {useVSCodeState} from '../../hooks/integration/useVSCodeState.js';
import {useSnapshotState} from '../../hooks/session/useSnapshotState.js';
import {useStreamingState} from '../../hooks/conversation/useStreamingState.js';
import {useCommandHandler} from '../../hooks/conversation/useCommandHandler.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {useTerminalFocus} from '../../hooks/ui/useTerminalFocus.js';
import {useBashMode} from '../../hooks/input/useBashMode.js';
import {useTerminalExecutionState} from '../../hooks/execution/useTerminalExecutionState.js';
import {useBackgroundProcesses} from '../../hooks/execution/useBackgroundProcesses.js';
import {usePanelState} from '../../hooks/ui/usePanelState.js';
import {vscodeConnection} from '../../utils/ui/vscodeConnection.js';
import {convertSessionMessagesToUI} from '../../utils/session/sessionConverter.js';
import {validateGitignore} from '../../utils/codebase/gitignoreValidator.js';
import {CodebaseIndexAgent} from '../../agents/codebaseIndexAgent.js';
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
	const [isExecutingTerminalCommand, setIsExecutingTerminalCommand] =
		useState(false); // Track terminal command execution
	const [customCommandExecution, setCustomCommandExecution] = useState<{
		commandName: string;
		command: string;
		isRunning: boolean;
		output: string[];
		exitCode?: number | null;
		error?: string;
	} | null>(null); // Track custom command execution state

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
	const [vulnerabilityHuntingMode, setVulnerabilityHuntingMode] = useState(
		() => {
			// Load vulnerability hunting mode from localStorage on initialization
			try {
				const saved = localStorage.getItem('snow-vulnerability-hunting-mode');
				return saved === 'true';
			} catch {
				return false;
			}
		},
	);
	const [simpleMode, setSimpleMode] = useState(() => {
		// Load simple mode from config
		return getSimpleMode();
	});
	const [showThinking, _setShowThinking] = useState(() => {
		// Load showThinking from config (default: true)
		const config = getOpenAiConfig();
		return config.showThinking !== false;
	});
	const [isCompressing, setIsCompressing] = useState(false);
	const [compressionError, setCompressionError] = useState<string | null>(null);
	const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
	const [restoreInputContent, setRestoreInputContent] = useState<{
		text: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
	} | null>(null);
	// BashMode sensitive command confirmation state
	const [bashSensitiveCommand, setBashSensitiveCommand] = useState<{
		command: string;
		resolve: (proceed: boolean) => void;
	} | null>(null);
	// Hook error state for displaying in chat area
	const [hookError, setHookError] = useState<HookErrorDetails | null>(null);
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
		error?: string;
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
	const bashMode = useBashMode();
	const terminalExecutionState = useTerminalExecutionState();
	const backgroundProcesses = useBackgroundProcesses();
	const panelState = usePanelState();
	const {hasFocus} = useTerminalFocus();

	// Background process panel state
	const [selectedProcessIndex, setSelectedProcessIndex] = useState(0);

	// Sort background processes (running first, then by time)
	const sortedBackgroundProcesses = useMemo(() => {
		return [...backgroundProcesses.processes].sort((a, b) => {
			if (a.status === 'running' && b.status !== 'running') return -1;
			if (a.status !== 'running' && b.status === 'running') return 1;
			return b.startedAt.getTime() - a.startedAt.getTime();
		});
	}, [backgroundProcesses.processes]);

	// Auto-adjust selected index when process count changes
	useEffect(() => {
		if (
			sortedBackgroundProcesses.length > 0 &&
			selectedProcessIndex >= sortedBackgroundProcesses.length
		) {
			setSelectedProcessIndex(sortedBackgroundProcesses.length - 1);
		}
	}, [sortedBackgroundProcesses.length, selectedProcessIndex]);

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
			import('../../utils/commands/profiles.js'),
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
			import('../../utils/commands/addDir.js'),
			import('../../utils/commands/permissions.js'),
			import('../../utils/commands/backend.js'),
		])
			.then(async () => {
				// Load and register custom commands from user directory
				await registerCustomCommands(workingDirectory);
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

				// Check if .gitignore exists before creating agent
				const validation = validateGitignore(workingDirectory);
				if (!validation.isValid) {
					setCodebaseProgress({
						totalFiles: 0,
						processedFiles: 0,
						totalChunks: 0,
						currentFile: '',
						status: 'error',
						error: validation.error,
					});
					setWatcherEnabled(false);

					logger.error(validation.error || 'Validation error');
					return;
				}

				// Initialize agent
				const agent = new CodebaseIndexAgent(workingDirectory);
				codebaseAgentRef.current = agent;

				// Check if indexing is needed
				const progress = await agent.getProgress();

				// If indexing is already completed, just start watcher for real-time updates
				// Don't run incremental index on mount as it blocks input
				if (progress.status === 'completed' && progress.totalChunks > 0) {
					agent.startWatching(
						(progressData: {
							totalFiles: number;
							processedFiles: number;
							totalChunks: number;
							currentFile: string;
							status: string;
							error?: string;
						}) => {
							setCodebaseProgress({
								totalFiles: progressData.totalFiles,
								processedFiles: progressData.processedFiles,
								totalChunks: progressData.totalChunks,
								currentFile: progressData.currentFile,
								status: progressData.status,
								error: progressData.error,
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
						},
					);
					setWatcherEnabled(true);
					return;
				}

				// If watcher was enabled before but indexing not completed, restore it
				const wasWatcherEnabled = await agent.isWatcherEnabled();
				if (wasWatcherEnabled) {
					logger.info('Restoring file watcher from previous session');
					agent.startWatching(
						(progressData: {
							totalFiles: number;
							processedFiles: number;
							totalChunks: number;
							currentFile: string;
							status: string;
							error?: string;
						}) => {
							setCodebaseProgress({
								totalFiles: progressData.totalFiles,
								processedFiles: progressData.processedFiles,
								totalChunks: progressData.totalChunks,
								currentFile: progressData.currentFile,
								status: progressData.status,
								error: progressData.error,
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
						},
					);
					setWatcherEnabled(true);
					setCodebaseIndexing(false); // Ensure loading UI is hidden when restoring watcher
				}

				// Start or resume indexing in background
				setCodebaseIndexing(true);

				agent.start(
					(progressData: {
						totalFiles: number;
						processedFiles: number;
						totalChunks: number;
						currentFile: string;
						status: string;
						error?: string;
					}) => {
						setCodebaseProgress({
							totalFiles: progressData.totalFiles,
							processedFiles: progressData.processedFiles,
							totalChunks: progressData.totalChunks,
							currentFile: progressData.currentFile,
							status: progressData.status,
							error: progressData.error,
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
								agent.startWatching(
									(watcherProgressData: {
										totalFiles: number;
										processedFiles: number;
										totalChunks: number;
										currentFile: string;
										status: string;
										error?: string;
									}) => {
										setCodebaseProgress({
											totalFiles: watcherProgressData.totalFiles,
											processedFiles: watcherProgressData.processedFiles,
											totalChunks: watcherProgressData.totalChunks,
											currentFile: watcherProgressData.currentFile,
											status: watcherProgressData.status,
											error: watcherProgressData.error,
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
									},
								);
								setWatcherEnabled(true);
							}
						}
					},
				);
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

	// Persist vulnerability hunting mode to localStorage
	useEffect(() => {
		try {
			localStorage.setItem(
				'snow-vulnerability-hunting-mode',
				String(vulnerabilityHuntingMode),
			);
		} catch {
			// Ignore localStorage errors
		}
	}, [vulnerabilityHuntingMode]);

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
		alwaysApprovedTools,
		requestToolConfirmation,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		removeFromAlwaysApproved,
		clearAllAlwaysApproved,
	} = useToolConfirmation(workingDirectory);

	// State for askuser tool interaction
	const [pendingUserQuestion, setPendingUserQuestion] = useState<{
		question: string;
		options: string[];
		toolCall: any;
		resolve: (result: {
			selected: string | string[];
			customInput?: string;
			cancelled?: boolean;
		}) => void;
	} | null>(null);

	// Request user question callback for askuser tool
	const requestUserQuestion = async (
		question: string,
		options: string[],
		toolCall: any,
	): Promise<{selected: string | string[]; customInput?: string}> => {
		return new Promise(resolve => {
			setPendingUserQuestion({
				question,
				options,
				toolCall,
				resolve,
			});
		});
	};

	// Minimum terminal height required for proper rendering
	const MIN_TERMINAL_HEIGHT = 10;

	// Use chat logic hook to handle all AI interaction business logic
	const {
		handleMessageSubmit,
		processMessage,
		processPendingMessages,
		handleHistorySelect,
		handleRollbackConfirm,
		handleUserQuestionAnswer,
		handleSessionPanelSelect,
		handleQuit,
		handleReindexCodebase,
		handleReviewCommitConfirm,
	} = useChatLogic({
		messages,
		setMessages,
		pendingMessages,
		setPendingMessages,
		streamingState,
		vscodeState,
		snapshotState,
		bashMode,
		yoloMode,
		planMode,
		vulnerabilityHuntingMode,
		saveMessage,
		clearSavedMessages,
		setRemountKey,
		requestToolConfirmation,
		requestUserQuestion,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		setRestoreInputContent,
		setIsCompressing,
		setCompressionError,
		currentContextPercentageRef,
		userInterruptedRef,
		pendingMessagesRef,
		setBashSensitiveCommand,
		pendingUserQuestion,
		setPendingUserQuestion,
		initializeFromSession,
		setShowSessionPanel: panelState.setShowSessionPanel,
		setShowReviewCommitPanel: panelState.setShowReviewCommitPanel,
		exitApp: exit,
		codebaseAgentRef,
		setCodebaseIndexing,
		setCodebaseProgress,
		setFileUpdateNotification,
		setWatcherEnabled,
		exitingApplicationText: t.hooks.exitingApplication,
	});

	const {handleCommandExecution} = useCommandHandler({
		messages,
		setMessages,
		setRemountKey,
		clearSavedMessages,
		setIsCompressing,
		setCompressionError,
		setShowSessionPanel: panelState.setShowSessionPanel,
		setShowMcpPanel: panelState.setShowMcpPanel,
		setShowUsagePanel: panelState.setShowUsagePanel,
		setShowHelpPanel: panelState.setShowHelpPanel,
		setShowCustomCommandConfig: panelState.setShowCustomCommandConfig,
		setShowSkillsCreation: panelState.setShowSkillsCreation,
		setShowRoleCreation: panelState.setShowRoleCreation,
		setShowRoleDeletion: panelState.setShowRoleDeletion,
		setShowWorkingDirPanel: panelState.setShowWorkingDirPanel,
		setShowReviewCommitPanel: panelState.setShowReviewCommitPanel,
		setShowPermissionsPanel,
		onSwitchProfile: handleSwitchProfile,
		setShowBackgroundPanel: backgroundProcesses.enablePanel,
		setYoloMode,
		setPlanMode,
		setVulnerabilityHuntingMode,
		setContextUsage: streamingState.setContextUsage,
		setCurrentContextPercentage,
		setVscodeConnectionStatus: vscodeState.setVscodeConnectionStatus,
		setIsExecutingTerminalCommand,
		setCustomCommandExecution,
		processMessage,
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
				// Set isStreaming=true BEFORE processing to show LoadingIndicator
				streamingState.setIsStreaming(true);
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
			query?: string;
			originalResultsCount?: number;
			suggestion?: string;
			reviewResults?: {
				originalCount: number;
				filteredCount: number;
				removedCount: number;
				highConfidenceFiles?: string[];
				reviewFailed?: boolean;
			};
		}) => {
			if (event.type === 'search-complete') {
				// Show completion status briefly
				streamingState.setCodebaseSearchStatus({
					isSearching: false,
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					currentTopN: event.currentTopN,
					message: event.message,
					query: event.query,
					originalResultsCount: event.originalResultsCount,
					suggestion: event.suggestion,
					reviewResults: event.reviewResults,
				});
				// Clear status after a delay to show completion
				setTimeout(() => {
					streamingState.setCodebaseSearchStatus(null);
				}, 2000);
			} else {
				// Update search status
				streamingState.setCodebaseSearchStatus({
					isSearching: true,
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					currentTopN: event.currentTopN,
					message: event.message,
					query: event.query,
					originalResultsCount: event.originalResultsCount,
					suggestion: undefined,
					reviewResults: undefined,
				});
			}
		};

		codebaseSearchEvents.onSearchEvent(handleSearchEvent);

		return () => {
			codebaseSearchEvents.removeSearchEventListener(handleSearchEvent);
		};
	}, [streamingState]);

	// ESC key handler to interrupt streaming or close overlays
	useInput((input, key) => {
		// Handle background process panel navigation (only when panel is visible)
		if (backgroundProcesses.showPanel) {
			// Handle ESC to close panel
			if (key.escape) {
				backgroundProcesses.hidePanel();
				return;
			}

			// Only handle navigation keys when there are processes to navigate
			if (sortedBackgroundProcesses.length > 0) {
				// Handle arrow up/down for process selection
				if (key.upArrow) {
					setSelectedProcessIndex(prev =>
						prev > 0 ? prev - 1 : sortedBackgroundProcesses.length - 1,
					);
					return;
				}
				if (key.downArrow) {
					setSelectedProcessIndex(prev =>
						prev < sortedBackgroundProcesses.length - 1 ? prev + 1 : 0,
					);
					return;
				}

				// Handle Enter to kill selected process
				if (key.return) {
					const selectedProcess =
						sortedBackgroundProcesses[selectedProcessIndex];
					if (selectedProcess && selectedProcess.status === 'running') {
						backgroundProcesses.killProcess(selectedProcess.id);
					}
					return;
				}
			}
		}

		// Handle Ctrl+B to move terminal command to background
		if (
			key.ctrl &&
			input === 'b' &&
			terminalExecutionState.state.isExecuting &&
			!terminalExecutionState.state.isBackgrounded
		) {
			// Import background process functions
			Promise.all([
				import('../../mcp/bash.js'),
				import('../../hooks/execution/useBackgroundProcesses.js'),
			]).then(([{markCommandAsBackgrounded}, {showBackgroundPanel}]) => {
				markCommandAsBackgrounded();
				showBackgroundPanel();
			});
			terminalExecutionState.moveToBackground();
			return;
		}

		// Skip ESC handling when tool confirmation is showing (let ToolConfirmation handle it)
		if (pendingToolConfirmation) {
			return;
		}

		// Handle bash sensitive command confirmation
		if (bashSensitiveCommand) {
			if (input.toLowerCase() === 'y') {
				bashSensitiveCommand.resolve(true);
				setBashSensitiveCommand(null);
			} else if (input.toLowerCase() === 'n') {
				bashSensitiveCommand.resolve(false);
				setBashSensitiveCommand(null);
			} else if (key.escape) {
				// Allow ESC to cancel
				bashSensitiveCommand.resolve(false);
				setBashSensitiveCommand(null);
			}
			return;
		}

		// Clear hook error on ESC
		if (hookError && key.escape) {
			setHookError(null);
			return;
		}

		if (snapshotState.pendingRollback) {
			if (key.escape) {
				snapshotState.setPendingRollback(null);
			}
			return;
		}

		// Handle panel closing with ESC
		if (key.escape && panelState.handleEscapeKey()) {
			return;
		}

		// Only handle ESC interrupt if terminal has focus
		if (
			key.escape &&
			streamingState.isStreaming &&
			streamingState.abortController &&
			hasFocus
		) {
			// Mark that user manually interrupted
			userInterruptedRef.current = true;

			// Set stopping state to show "Stopping..." spinner
			streamingState.setIsStopping(true);

			// Clear retry and search status to prevent flashing
			streamingState.setRetryStatus(null);
			streamingState.setCodebaseSearchStatus(null);

			// Abort the controller
			streamingState.abortController.abort();

			// Remove all pending tool call messages (those with toolPending: true)
			setMessages(prev => prev.filter(msg => !msg.toolPending));

			// Restore pending messages to input instead of discarding them
			if (pendingMessages.length > 0) {
				// Get the first pending message (usually there's only one)
				const firstPending = pendingMessages[0];
				if (firstPending) {
					setRestoreInputContent({
						text: firstPending.text,
						images: firstPending.images?.map(img => ({
							type: 'image' as const,
							data: img.data,
							mimeType: img.mimeType,
						})),
					});
				}
			}
			// Clear pending messages to prevent auto-send after abort
			setPendingMessages([]);

			// Note: Don't manually clear isStopping here!
			// It will be cleared automatically in useConversation's finally block
			// when setIsStreaming(false) is called, ensuring "Stopping..." spinner
			// is visible until "user discontinue" message appears

			// Note: discontinued message will be added in processMessage/processPendingMessages finally block
			// Note: session cleanup will be handled in processMessage/processPendingMessages finally block
		}
	});

	// Handle profile switching (Ctrl+P shortcut) - delegated to panelState
	function handleSwitchProfile() {
		panelState.handleSwitchProfile({
			isStreaming: streamingState.isStreaming,
			hasPendingRollback: !!snapshotState.pendingRollback,
			hasPendingToolConfirmation: !!pendingToolConfirmation,
			hasPendingUserQuestion: !!pendingUserQuestion,
		});
	}
	// Handle profile selection - delegated to panelState
	const handleProfileSelect = panelState.handleProfileSelect;

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
									showThinking={showThinking}
								/>
							);
						}),
				]}
			>
				{item => item}
			</Static>

			{/* Show loading indicator when streaming or saving */}
			<LoadingIndicator
				isStreaming={streamingState.isStreaming}
				isStopping={streamingState.isStopping || false}
				isSaving={isSaving}
				hasPendingToolConfirmation={!!pendingToolConfirmation}
				hasPendingUserQuestion={!!pendingUserQuestion}
				terminalWidth={terminalWidth}
				animationFrame={streamingState.animationFrame}
				retryStatus={streamingState.retryStatus}
				codebaseSearchStatus={streamingState.codebaseSearchStatus}
				isReasoning={streamingState.isReasoning}
				streamTokenCount={streamingState.streamTokenCount}
				elapsedSeconds={streamingState.elapsedSeconds}
				currentModel={streamingState.currentModel}
			/>

			<Box paddingX={1} width={terminalWidth}>
				<PendingMessages pendingMessages={pendingMessages} />
			</Box>

			{/* Display Hook error in chat area */}
			{hookError && (
				<Box paddingX={1} width={terminalWidth} marginBottom={1}>
					<HookErrorDisplay details={hookError} />
				</Box>
			)}

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
					onHookError={error => {
						setHookError(error);
					}}
				/>
			)}

			{/* Show bash sensitive command confirmation if pending */}
			{bashSensitiveCommand && (
				<Box paddingX={1} width={terminalWidth}>
					<BashCommandConfirmation
						command={bashSensitiveCommand.command}
						onConfirm={bashSensitiveCommand.resolve}
						terminalWidth={terminalWidth}
					/>
				</Box>
			)}

			{/* Show bash command execution status */}
			{bashMode.state.isExecuting && bashMode.state.currentCommand && (
				<Box paddingX={1} width={terminalWidth}>
					<BashCommandExecutionStatus
						command={bashMode.state.currentCommand}
						timeout={bashMode.state.currentTimeout || 30000}
						terminalWidth={terminalWidth}
						output={bashMode.state.output}
					/>
				</Box>
			)}

			{/* Show custom command execution status */}
			{customCommandExecution && (
				<Box paddingX={1} width={terminalWidth}>
					<CustomCommandExecutionDisplay
						command={customCommandExecution.command}
						commandName={customCommandExecution.commandName}
						isRunning={customCommandExecution.isRunning}
						output={customCommandExecution.output}
						exitCode={customCommandExecution.exitCode}
						error={customCommandExecution.error}
					/>
				</Box>
			)}

			{/* Show terminal-execute tool execution status */}
			{terminalExecutionState.state.isExecuting &&
				!terminalExecutionState.state.isBackgrounded &&
				terminalExecutionState.state.command && (
					<Box paddingX={1} width={terminalWidth}>
						<BashCommandExecutionStatus
							command={terminalExecutionState.state.command}
							timeout={terminalExecutionState.state.timeout || 30000}
							terminalWidth={terminalWidth}
							output={terminalExecutionState.state.output}
						/>
					</Box>
				)}

			{/* Show user question panel if askuser tool is called */}
			{pendingUserQuestion && (
				<AskUserQuestion
					question={pendingUserQuestion.question}
					options={pendingUserQuestion.options}
					onAnswer={handleUserQuestionAnswer}
				/>
			)}

			<PanelsManager
				terminalWidth={terminalWidth}
				workingDirectory={workingDirectory}
				showSessionPanel={panelState.showSessionPanel}
				showMcpPanel={panelState.showMcpPanel}
				showUsagePanel={panelState.showUsagePanel}
				showHelpPanel={panelState.showHelpPanel}
				showCustomCommandConfig={panelState.showCustomCommandConfig}
				showSkillsCreation={panelState.showSkillsCreation}
				showRoleCreation={panelState.showRoleCreation}
				showRoleDeletion={panelState.showRoleDeletion}
				showWorkingDirPanel={panelState.showWorkingDirPanel}
				setShowSessionPanel={panelState.setShowSessionPanel}
				setShowCustomCommandConfig={panelState.setShowCustomCommandConfig}
				setShowSkillsCreation={panelState.setShowSkillsCreation}
				setShowRoleCreation={panelState.setShowRoleCreation}
				setShowRoleDeletion={panelState.setShowRoleDeletion}
				setShowWorkingDirPanel={panelState.setShowWorkingDirPanel}
				handleSessionPanelSelect={handleSessionPanelSelect}
				onCustomCommandSave={async (name, command, type, location) => {
					await saveCustomCommand(
						name,
						command,
						type,
						undefined,
						location,
						workingDirectory,
					);
					await registerCustomCommands(workingDirectory);
					panelState.setShowCustomCommandConfig(false);
					const typeDesc =
						type === 'execute'
							? t.customCommand.resultTypeExecute
							: t.customCommand.resultTypePrompt;
					const locationDesc =
						location === 'global'
							? t.customCommand.resultLocationGlobal
							: t.customCommand.resultLocationProject;
					const content = t.customCommand.saveSuccessMessage
						.replace('{name}', name)
						.replace('{type}', typeDesc)
						.replace('{location}', locationDesc);
					const successMessage: Message = {
						role: 'command',
						content,
						commandName: 'custom',
					};
					setMessages(prev => [...prev, successMessage]);
				}}
				onSkillsSave={async (skillName, description, location, generated) => {
					const result = generated
						? await createSkillFromGenerated(
								skillName,
								description,
								generated,
								location,
								workingDirectory,
						  )
						: await createSkillTemplate(
								skillName,
								description,
								location,
								workingDirectory,
						  );
					panelState.setShowSkillsCreation(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.skillsCreation.locationGlobal
								: t.skillsCreation.locationProject;
						const modeDesc = generated
							? t.skillsCreation.resultModeAi
							: t.skillsCreation.resultModeManual;
						const content = t.skillsCreation.createSuccessMessage
							.replace('{name}', skillName)
							.replace('{mode}', modeDesc)
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'skills',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText = result.error || t.skillsCreation.errorUnknown;
						const content = t.skillsCreation.createErrorMessage.replace(
							'{error}',
							errorText,
						);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'skills',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
				onRoleSave={async location => {
					const {createRoleFile} = await import('../../utils/commands/role.js');
					const result = await createRoleFile(location, workingDirectory);
					panelState.setShowRoleCreation(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.roleCreation.locationGlobal
								: t.roleCreation.locationProject;
						const content = t.roleCreation.createSuccessMessage
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText = result.error || t.roleCreation.errorUnknown;
						const content = t.roleCreation.createErrorMessage.replace(
							'{error}',
							errorText,
						);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
				onRoleDelete={async location => {
					const {deleteRoleFile} = await import('../../utils/commands/role.js');
					const result = await deleteRoleFile(location, workingDirectory);
					panelState.setShowRoleDeletion(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.roleDeletion.locationGlobal
								: t.roleDeletion.locationProject;
						const content = t.roleDeletion.deleteSuccessMessage
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText = result.error || t.roleDeletion.errorUnknown;
						const content = t.roleDeletion.deleteErrorMessage.replace(
							'{error}',
							errorText,
						);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
			/>

			{/* Show permissions panel if active */}
			{showPermissionsPanel && (
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
						<PermissionsPanel
							alwaysApprovedTools={alwaysApprovedTools}
							onRemoveTool={removeFromAlwaysApproved}
							onClearAll={clearAllAlwaysApproved}
							onClose={() => setShowPermissionsPanel(false)}
						/>
					</Suspense>
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

			{/* Hide input during tool confirmation or session panel or MCP panel or usage panel or help panel or custom command config or skills creation or role creation or role deletion or working dir panel or permissions panel or rollback confirmation or user question. ProfilePanel is NOT included because it renders inside ChatInput. Compression spinner is shown inside ChatFooter, so ChatFooter is always rendered. */}
			{!pendingToolConfirmation &&
				!pendingUserQuestion &&
				!bashSensitiveCommand &&
				!(
					panelState.showSessionPanel ||
					panelState.showMcpPanel ||
					panelState.showUsagePanel ||
					panelState.showHelpPanel ||
					panelState.showCustomCommandConfig ||
					panelState.showSkillsCreation ||
					panelState.showRoleCreation ||
					panelState.showRoleDeletion ||
					panelState.showWorkingDirPanel ||
					showPermissionsPanel
				) &&
				!snapshotState.pendingRollback && (
					<ChatFooter
						onSubmit={handleMessageSubmit}
						onCommand={handleCommandExecution}
						onHistorySelect={handleHistorySelect}
						onSwitchProfile={handleSwitchProfile}
						handleProfileSelect={handleProfileSelect}
						handleHistorySelect={handleHistorySelect}
						showReviewCommitPanel={panelState.showReviewCommitPanel}
						setShowReviewCommitPanel={panelState.setShowReviewCommitPanel}
						onReviewCommitConfirm={handleReviewCommitConfirm}
						disabled={
							!!pendingToolConfirmation ||
							!!bashSensitiveCommand ||
							isExecutingTerminalCommand ||
							isCompressing
						}
						isStopping={streamingState.isStopping || false}
						isProcessing={
							streamingState.isStreaming ||
							isSaving ||
							bashMode.state.isExecuting ||
							isCompressing
						}
						chatHistory={messages}
						yoloMode={yoloMode}
						setYoloMode={setYoloMode}
						planMode={planMode}
						setPlanMode={setPlanMode}
						vulnerabilityHuntingMode={vulnerabilityHuntingMode}
						setVulnerabilityHuntingMode={setVulnerabilityHuntingMode}
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
						showProfilePicker={panelState.showProfilePanel}
						setShowProfilePicker={panelState.setShowProfilePanel}
						profileSelectedIndex={panelState.profileSelectedIndex}
						setProfileSelectedIndex={panelState.setProfileSelectedIndex}
						getFilteredProfiles={() => {
							const allProfiles = getAllProfiles();
							const query = panelState.profileSearchQuery.toLowerCase();
							if (!query) return allProfiles;
							return allProfiles.filter(
								profile =>
									profile.name.toLowerCase().includes(query) ||
									profile.displayName.toLowerCase().includes(query),
							);
						}}
						profileSearchQuery={panelState.profileSearchQuery}
						setProfileSearchQuery={panelState.setProfileSearchQuery}
						vscodeConnectionStatus={vscodeState.vscodeConnectionStatus}
						editorContext={vscodeState.editorContext}
						codebaseIndexing={codebaseIndexing}
						codebaseProgress={codebaseProgress}
						watcherEnabled={watcherEnabled}
						fileUpdateNotification={fileUpdateNotification}
						currentProfileName={panelState.currentProfileName}
						isCompressing={isCompressing}
						compressionError={compressionError}
						backgroundProcesses={backgroundProcesses.processes}
						showBackgroundPanel={backgroundProcesses.showPanel}
						selectedProcessIndex={selectedProcessIndex}
						terminalWidth={terminalWidth}
					/>
				)}
		</Box>
	);
}
