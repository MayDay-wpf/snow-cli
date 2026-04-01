import React, {useEffect, useRef} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../i18n/I18nContext.js';
import {useTheme} from '../contexts/ThemeContext.js';
import ChatFooter from '../components/chat/ChatFooter.js';
import {getOpenAiConfig} from '../../utils/config/apiConfig.js';
import {getAllProfiles} from '../../utils/config/configManager.js';
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
import {useSchedulerExecutionState} from '../../hooks/execution/useSchedulerExecutionState.js';
import {useBackgroundProcesses} from '../../hooks/execution/useBackgroundProcesses.js';
import {usePanelState} from '../../hooks/ui/usePanelState.js';
import {useCursorHide} from '../../hooks/ui/useCursorHide.js';
import {connectionManager} from '../../utils/connection/ConnectionManager.js';
import {updateGlobalTokenUsage} from '../../utils/connection/contextManager.js';
import ChatScreenConversationView from './chatScreen/ChatScreenConversationView.js';
import ChatScreenPanels from './chatScreen/ChatScreenPanels.js';
import {useBackgroundProcessSelection} from './chatScreen/useBackgroundProcessSelection.js';
import {useChatScreenCommands} from './chatScreen/useChatScreenCommands.js';
import {useChatScreenInputHandler} from './chatScreen/useChatScreenInputHandler.js';
import {useChatScreenLocalState} from './chatScreen/useChatScreenLocalState.js';
import {useChatScreenModes} from './chatScreen/useChatScreenModes.js';
import {useChatScreenSessionLifecycle} from './chatScreen/useChatScreenSessionLifecycle.js';
import {useCodebaseIndexing} from './chatScreen/useCodebaseIndexing.js';

const MIN_TERMINAL_HEIGHT = 10;

type Props = {
	autoResume?: boolean;
	enableYolo?: boolean;
	enablePlan?: boolean;
};

export default function ChatScreen({
	autoResume,
	enableYolo,
	enablePlan,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const {columns: terminalWidth, rows: terminalHeight} = useTerminalSize();
	const workingDirectory = process.cwd();
	const apiConfig = getOpenAiConfig();
	const advancedModel = apiConfig.advancedModel || '';
	const basicModel = apiConfig.basicModel || '';

	useCursorHide();

	const {
		messages,
		setMessages,
		isSaving,
		pendingMessages,
		setPendingMessages,
		pendingMessagesRef,
		userInterruptedRef,
		remountKey,
		setRemountKey,
		setCurrentContextPercentage,
		currentContextPercentageRef,
		isExecutingTerminalCommand,
		setIsExecutingTerminalCommand,
		customCommandExecution,
		setCustomCommandExecution,
		isCompressing,
		setIsCompressing,
		compressionError,
		setCompressionError,
		showPermissionsPanel,
		setShowPermissionsPanel,
		showSubAgentDepthPanel,
		setShowSubAgentDepthPanel,
		restoreInputContent,
		setRestoreInputContent,
		inputDraftContent,
		setInputDraftContent,
		bashSensitiveCommand,
		setBashSensitiveCommand,
		suppressLoadingIndicator,
		setSuppressLoadingIndicator,
		hookError,
		setHookError,
		pendingUserQuestion,
		setPendingUserQuestion,
		requestUserQuestion,
		compressionStatus,
		setCompressionStatus,
		isResumingSession,
		setIsResumingSession,
		btwPrompt,
		setBtwPrompt,
	} = useChatScreenLocalState();
	const {
		yoloMode,
		setYoloMode,
		planMode,
		setPlanMode,
		vulnerabilityHuntingMode,
		setVulnerabilityHuntingMode,
		toolSearchDisabled,
		setToolSearchDisabled,
		hybridCompressEnabled,
		setHybridCompressEnabled,
		teamMode,
		setTeamMode,
		simpleMode,
		showThinking,
	} = useChatScreenModes({enableYolo, enablePlan});
	const streamingState = useStreamingState();
	const vscodeState = useVSCodeState();
	const snapshotState = useSnapshotState(messages.length);
	const bashMode = useBashMode();
	const terminalExecutionState = useTerminalExecutionState();
	const schedulerExecutionState = useSchedulerExecutionState();
	const backgroundProcesses = useBackgroundProcesses();
	const panelState = usePanelState();
	const {hasFocus} = useTerminalFocus();
	const {
		selectedProcessIndex,
		setSelectedProcessIndex,
		sortedBackgroundProcesses,
	} = useBackgroundProcessSelection(backgroundProcesses.processes);
	const {saveMessage, clearSavedMessages, initializeFromSession} =
		useSessionSave();
	const commandsLoaded = useChatScreenCommands(workingDirectory);
	const {
		codebaseIndexing,
		setCodebaseIndexing,
		codebaseProgress,
		setCodebaseProgress,
		watcherEnabled,
		setWatcherEnabled,
		fileUpdateNotification,
		setFileUpdateNotification,
		codebaseAgentRef,
	} = useCodebaseIndexing(workingDirectory);
	const {
		pendingToolConfirmation,
		alwaysApprovedTools,
		requestToolConfirmation,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		removeFromAlwaysApproved,
		clearAllAlwaysApproved,
	} = useToolConfirmation(workingDirectory);
	const handleCommandExecutionRef = useRef<
		((command: string, result: any) => void) | undefined
	>(undefined);

	useEffect(() => {
		connectionManager.setStreamingState(streamingState.streamStatus);
	}, [streamingState.streamStatus]);

	useChatScreenSessionLifecycle({
		autoResume,
		terminalWidth,
		remountKey,
		setRemountKey,
		setMessages,
		initializeFromSession,
		setIsResumingSession,
	});

	const {
		handleMessageSubmit,
		processMessage,
		handleHistorySelect,
		handleRollbackConfirm,
		handleUserQuestionAnswer,
		handleSessionPanelSelect,
		handleQuit,
		handleReindexCodebase,
		handleToggleCodebase,
		handleReviewCommitConfirm,
		handleEscKey,
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
		teamMode,
		toolSearchDisabled,
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
		codebaseAgentRef,
		setCodebaseIndexing,
		setCodebaseProgress,
		setFileUpdateNotification,
		setWatcherEnabled,
		exitingApplicationText: t.hooks.exitingApplication,
		commandsLoaded,
		terminalExecutionState,
		backgroundProcesses,
		schedulerExecutionState,
		panelState,
		setIsExecutingTerminalCommand,
		setHookError,
		hasFocus,
		setSuppressLoadingIndicator,
		bashSensitiveCommand,
		handleCommandExecution: (command, result) => {
			handleCommandExecutionRef.current?.(command, result);
		},
		pendingToolConfirmation,
		onCompressionStatus: setCompressionStatus,
		setIsResumingSession,
	});

	function handleSwitchProfile() {
		panelState.handleSwitchProfile({
			isStreaming: streamingState.isStreaming,
			hasPendingRollback: !!snapshotState.pendingRollback,
			hasPendingToolConfirmation: !!pendingToolConfirmation,
			hasPendingUserQuestion: !!pendingUserQuestion,
		});
	}

	const handleProfileSelect = panelState.handleProfileSelect;

	const {handleCommandExecution} = useCommandHandler({
		messages,
		setMessages,
		setPendingMessages,
		streamStatus: streamingState.streamStatus,
		setRemountKey,
		clearSavedMessages,
		setIsCompressing,
		setCompressionError,
		setShowSessionPanel: panelState.setShowSessionPanel,
		onResumeSessionById: handleSessionPanelSelect,
		setShowMcpPanel: panelState.setShowMcpPanel,
		setShowUsagePanel: panelState.setShowUsagePanel,
		setShowModelsPanel: panelState.setShowModelsPanel,
		setShowSubAgentDepthPanel,
		setShowCustomCommandConfig: panelState.setShowCustomCommandConfig,
		setShowSkillsCreation: panelState.setShowSkillsCreation,
		setShowRoleCreation: panelState.setShowRoleCreation,
		setShowRoleDeletion: panelState.setShowRoleDeletion,
		setShowRoleList: panelState.setShowRoleList,
		setShowRoleSubagentCreation: panelState.setShowRoleSubagentCreation,
		setShowRoleSubagentDeletion: panelState.setShowRoleSubagentDeletion,
		setShowRoleSubagentList: panelState.setShowRoleSubagentList,
		setShowWorkingDirPanel: panelState.setShowWorkingDirPanel,
		setShowReviewCommitPanel: panelState.setShowReviewCommitPanel,
		setShowDiffReviewPanel: panelState.setShowDiffReviewPanel,
		setShowConnectionPanel: panelState.setShowConnectionPanel,
		setConnectionPanelApiUrl: panelState.setConnectionPanelApiUrl,
		setShowPermissionsPanel,
		setShowBranchPanel: panelState.setShowBranchPanel,
		setShowNewPromptPanel: panelState.setShowNewPromptPanel,
		setShowTodoListPanel: panelState.setShowTodoListPanel,
		onSwitchProfile: handleSwitchProfile,
		setShowBackgroundPanel: backgroundProcesses.enablePanel,
		setYoloMode,
		setPlanMode,
		setVulnerabilityHuntingMode,
		setToolSearchDisabled,
		setHybridCompressEnabled,
		setTeamMode,
		setContextUsage: streamingState.setContextUsage,
		setCurrentContextPercentage,
		currentContextPercentageRef,
		setVscodeConnectionStatus: vscodeState.setVscodeConnectionStatus,
		setIsExecutingTerminalCommand,
		setCustomCommandExecution,
		processMessage,
		setBtwPrompt,
		onQuit: handleQuit,
		onReindexCodebase: handleReindexCodebase,
		onToggleCodebase: handleToggleCodebase,
		onCompressionStatus: setCompressionStatus,
	});

	useEffect(() => {
		handleCommandExecutionRef.current = handleCommandExecution;
	}, [handleCommandExecution]);

	useEffect(() => {
		if (streamingState.contextUsage) {
			updateGlobalTokenUsage({
				prompt_tokens: streamingState.contextUsage.prompt_tokens || 0,
				completion_tokens: streamingState.contextUsage.completion_tokens || 0,
				total_tokens: streamingState.contextUsage.total_tokens || 0,
				cache_creation_input_tokens:
					streamingState.contextUsage.cache_creation_input_tokens,
				cache_read_input_tokens:
					streamingState.contextUsage.cache_read_input_tokens,
				cached_tokens: streamingState.contextUsage.cached_tokens,
				max_tokens: getOpenAiConfig().maxContextTokens || 128000,
			});
		} else {
			updateGlobalTokenUsage(null);
		}
	}, [streamingState.contextUsage]);

	useChatScreenInputHandler({
		backgroundProcesses,
		sortedBackgroundProcesses,
		selectedProcessIndex,
		setSelectedProcessIndex,
		terminalExecutionState,
		pendingToolConfirmation,
		pendingUserQuestion,
		bashSensitiveCommand,
		setBashSensitiveCommand,
		hookError,
		setHookError,
		snapshotState,
		panelState,
		handleEscKey,
		btwPrompt,
	});

	const getFilteredProfiles = () => {
		const allProfiles = getAllProfiles();
		const query = panelState.profileSearchQuery.toLowerCase();
		const currentName = panelState.currentProfileName;
		const profilesWithMemoryState = allProfiles.map(profile => ({
			...profile,
			isActive: profile.displayName === currentName,
		}));

		if (!query) {
			return profilesWithMemoryState;
		}

		return profilesWithMemoryState.filter(
			profile =>
				profile.name.toLowerCase().includes(query) ||
				profile.displayName.toLowerCase().includes(query),
		);
	};

	const hasBlockingPanel =
		panelState.showSessionPanel ||
		panelState.showMcpPanel ||
		panelState.showUsagePanel ||
		panelState.showModelsPanel ||
		panelState.showCustomCommandConfig ||
		panelState.showSkillsCreation ||
		panelState.showRoleCreation ||
		panelState.showRoleDeletion ||
		panelState.showRoleList ||
		panelState.showRoleSubagentCreation ||
		panelState.showRoleSubagentDeletion ||
		panelState.showRoleSubagentList ||
		panelState.showWorkingDirPanel ||
		panelState.showBranchPanel ||
		panelState.showDiffReviewPanel ||
		panelState.showConnectionPanel ||
		panelState.showNewPromptPanel ||
		panelState.showTodoListPanel ||
		showPermissionsPanel ||
		showSubAgentDepthPanel;
	const shouldShowFooter =
		!pendingToolConfirmation &&
		!pendingUserQuestion &&
		!bashSensitiveCommand &&
		!terminalExecutionState.state.needsInput &&
		!schedulerExecutionState.state.isRunning &&
		!hasBlockingPanel &&
		!snapshotState.pendingRollback;
	const footerContextUsage = streamingState.contextUsage
		? {
				inputTokens: streamingState.contextUsage.prompt_tokens,
				maxContextTokens: getOpenAiConfig().maxContextTokens || 4000,
				cacheCreationTokens:
					streamingState.contextUsage.cache_creation_input_tokens,
				cacheReadTokens: streamingState.contextUsage.cache_read_input_tokens,
				cachedTokens: streamingState.contextUsage.cached_tokens,
		  }
		: undefined;

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

	// Show loading state when resuming session
	if (isResumingSession) {
		return (
			<Box
				flexDirection="column"
				justifyContent="center"
				alignItems="center"
				height="100%"
				width={terminalWidth}
			>
				<Text color="cyan">
					<Spinner type="dots" />
				</Text>
				<Text>{t.chatScreen.sessionLoading}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" height="100%" width={terminalWidth}>
			<ChatScreenConversationView
				remountKey={remountKey}
				terminalWidth={terminalWidth}
				workingDirectory={workingDirectory}
				simpleMode={simpleMode}
				messages={messages}
				showThinking={showThinking}
				pendingMessages={pendingMessages}
				pendingToolConfirmation={pendingToolConfirmation}
				pendingUserQuestion={pendingUserQuestion}
				bashSensitiveCommand={bashSensitiveCommand}
				terminalExecutionState={terminalExecutionState}
				schedulerExecutionState={schedulerExecutionState}
				customCommandExecution={customCommandExecution}
				bashMode={bashMode}
				hookError={hookError}
				handleUserQuestionAnswer={handleUserQuestionAnswer}
				setHookError={setHookError}
				compressionStatus={compressionStatus}
			/>

			<ChatScreenPanels
				terminalWidth={terminalWidth}
				workingDirectory={workingDirectory}
				panelState={panelState}
				messages={messages}
				snapshotState={snapshotState}
				advancedModel={advancedModel}
				basicModel={basicModel}
				handleSessionPanelSelect={handleSessionPanelSelect}
				showPermissionsPanel={showPermissionsPanel}
				setShowPermissionsPanel={setShowPermissionsPanel}
				showSubAgentDepthPanel={showSubAgentDepthPanel}
				setShowSubAgentDepthPanel={setShowSubAgentDepthPanel}
				alwaysApprovedTools={alwaysApprovedTools}
				removeFromAlwaysApproved={removeFromAlwaysApproved}
				clearAllAlwaysApproved={clearAllAlwaysApproved}
				setMessages={setMessages}
				t={t}
				onPromptAccept={prompt => {
					setRestoreInputContent({text: prompt});
				}}
				handleRollbackConfirm={handleRollbackConfirm}
			/>

			{shouldShowFooter && (
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
				btwPrompt={btwPrompt}
				onBtwClose={() => setBtwPrompt(null)}
					disabled={
						!!pendingToolConfirmation ||
						!!bashSensitiveCommand ||
						isExecutingTerminalCommand ||
						isCompressing ||
						streamingState.isStopping
					}
					isStopping={streamingState.isStopping}
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
					toolSearchDisabled={toolSearchDisabled}
					hybridCompressEnabled={hybridCompressEnabled}
					teamMode={teamMode}
					setTeamMode={setTeamMode}
					contextUsage={footerContextUsage}
					initialContent={restoreInputContent}
					draftContent={inputDraftContent}
					onDraftChange={setInputDraftContent}
					onContextPercentageChange={setCurrentContextPercentage}
					showProfilePicker={panelState.showProfilePanel}
					setShowProfilePicker={panelState.setShowProfilePanel}
					profileSelectedIndex={panelState.profileSelectedIndex}
					setProfileSelectedIndex={panelState.setProfileSelectedIndex}
					getFilteredProfiles={getFilteredProfiles}
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
					// Loading indicator props
					isStreaming={streamingState.isStreaming}
					isSaving={isSaving}
					hasPendingToolConfirmation={!!pendingToolConfirmation}
					hasPendingUserQuestion={!!pendingUserQuestion}
					hasBlockingOverlay={
						!!bashSensitiveCommand ||
						suppressLoadingIndicator ||
						(bashMode.state.isExecuting && !!bashMode.state.currentCommand) ||
						(terminalExecutionState.state.isExecuting &&
							!terminalExecutionState.state.isBackgrounded &&
							!!terminalExecutionState.state.command) ||
						(customCommandExecution?.isRunning ?? false)
					}
					animationFrame={streamingState.animationFrame}
					retryStatus={streamingState.retryStatus}
					codebaseSearchStatus={streamingState.codebaseSearchStatus}
					isReasoning={streamingState.isReasoning}
					streamTokenCount={streamingState.streamTokenCount}
					elapsedSeconds={streamingState.elapsedSeconds}
					currentModel={streamingState.currentModel}
					compressBlockToast={streamingState.compressBlockToast}
				/>
			)}
		</Box>
	);
}
