import React, {useState, useEffect, Suspense, lazy} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import ChatInput from './ChatInput.js';
import StatusLine from '../common/StatusLine.js';
import LoadingIndicator from './LoadingIndicator.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import type {Message} from './MessageList.js';
import {BackgroundProcessPanel} from '../bash/BackgroundProcessPanel.js';
import type {BackgroundProcess} from '../../../hooks/execution/useBackgroundProcesses.js';
import TodoTree from '../special/TodoTree.js';
import type {TodoItem} from '../../../mcp/types/todo.types.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {todoEvents} from '../../../utils/events/todoEvents.js';
import {connectionManager} from '../../../utils/connection/ConnectionManager.js';

const ReviewCommitPanel = lazy(() => import('../panels/ReviewCommitPanel.js'));
import type {ReviewCommitSelection} from '../panels/ReviewCommitPanel.js';
const BtwPanel = lazy(() => import('../panels/BtwPanel.js'));

type ChatFooterProps = {
	onSubmit: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
	) => Promise<void>;
	onCommand: (commandName: string, result: any) => Promise<void>;
	onHistorySelect: (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => Promise<void>;
	onSwitchProfile: () => void;
	handleProfileSelect: (profileName: string) => void;
	handleHistorySelect: (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => Promise<void>;

	// Review commit panel props
	showReviewCommitPanel: boolean;
	setShowReviewCommitPanel: React.Dispatch<React.SetStateAction<boolean>>;
	onReviewCommitConfirm: (
		selection: ReviewCommitSelection[],
		notes: string,
	) => void | Promise<void>;

	disabled: boolean;
	isStopping: boolean;
	isProcessing: boolean;
	chatHistory: Message[];
	yoloMode: boolean;
	setYoloMode: (value: boolean) => void;
	planMode: boolean;
	setPlanMode: (value: boolean) => void;
	vulnerabilityHuntingMode: boolean;
	setVulnerabilityHuntingMode: (value: boolean) => void;
	toolSearchDisabled: boolean;
	hybridCompressEnabled: boolean;
	teamMode: boolean;
	setTeamMode: (value: boolean) => void;
	contextUsage?: {
		inputTokens: number;
		maxContextTokens: number;
		cacheCreationTokens?: number;
		cacheReadTokens?: number;
		cachedTokens?: number;
	};
	initialContent: {
		text: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
	} | null;
	// 输入框草稿内容：用于 ChatFooter 被条件隐藏后恢复时，保留输入框内容
	draftContent: {
		text: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
	} | null;
	onDraftChange: (
		content: {
			text: string;
			images?: Array<{type: 'image'; data: string; mimeType: string}>;
		} | null,
	) => void;
	onContextPercentageChange: (percentage: number) => void;
	showProfilePicker: boolean;
	setShowProfilePicker: (value: boolean | ((prev: boolean) => boolean)) => void;
	profileSelectedIndex: number;
	setProfileSelectedIndex: (index: number | ((prev: number) => number)) => void;
	getFilteredProfiles: () => any[];
	profileSearchQuery: string;
	setProfileSearchQuery: (query: string) => void;

	vscodeConnectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
	editorContext?: {
		activeFile?: string;
		selectedText?: string;
		cursorPosition?: {line: number; character: number};
		workspaceFolder?: string;
	};
	codebaseIndexing: boolean;
	codebaseProgress: {
		totalFiles: number;
		processedFiles: number;
		totalChunks: number;
		currentFile: string;
		status: string;
		error?: string;
	} | null;
	watcherEnabled: boolean;
	fileUpdateNotification: {file: string; timestamp: number} | null;
	currentProfileName: string;
	isCompressing: boolean;
	compressionError: string | null;
	copyStatusMessage?: {
		text: string;
		isError?: boolean;
		timestamp: number;
	} | null;

	// Background process panel props
	backgroundProcesses: BackgroundProcess[];
	showBackgroundPanel: boolean;
	selectedProcessIndex: number;
	terminalWidth: number;

	// BTW panel props
	btwPrompt: string | null;
	onBtwClose: () => void;

	// Loading indicator props
	isStreaming: boolean;
	isSaving: boolean;
	hasPendingToolConfirmation: boolean;
	hasPendingUserQuestion: boolean;
	hasBlockingOverlay: boolean;
	animationFrame: number;
	retryStatus: {
		isRetrying: boolean;
		errorMessage?: string;
		remainingSeconds?: number;
		attempt: number;
	} | null;
	codebaseSearchStatus: {
		isSearching: boolean;
		attempt: number;
		maxAttempts: number;
		currentTopN: number;
		message: string;
		query?: string;
		originalResultsCount?: number;
		suggestion?: string;
	} | null;
	isReasoning: boolean;
	streamTokenCount: number;
	elapsedSeconds: number;
	currentModel?: string | null;
	compressBlockToast?: string | null;
};

const ChatFooter = React.memo(function ChatFooter(props: ChatFooterProps) {
	const {t} = useI18n();
	const [todos, setTodos] = useState<TodoItem[]>([]);
	const [showTodos, setShowTodos] = useState(false);

	// 实例连接状态
	const [connectionStatus, setConnectionStatus] = useState<
		'disconnected' | 'connecting' | 'connected' | 'reconnecting'
	>('disconnected');
	const [connectionInstanceName, setConnectionInstanceName] =
		useState<string>('');
	const [copyStatusMessage, setCopyStatusMessage] = useState<{
		text: string;
		isError?: boolean;
		timestamp: number;
	} | null>(null);

	// 订阅连接状态变化
	useEffect(() => {
		const unsubscribe = connectionManager.onStatusChange(state => {
			setConnectionStatus(state.status);
			if (state.instanceName) {
				setConnectionInstanceName(state.instanceName);
			}
		});
		return unsubscribe;
	}, []);

	// 使用事件监听 TODO 更新，替代轮询
	useEffect(() => {
		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) {
			setShowTodos(false);
			setTodos([]);
			return;
		}

		const handleTodoUpdate = (data: {sessionId: string; todos: TodoItem[]}) => {
			// 只处理当前会话的 TODO 更新
			if (data.sessionId === currentSession.id) {
				setTodos(data.todos);
				if (data.todos.length > 0 && props.isProcessing) {
					setShowTodos(true);
				}
			}
		};

		// 监听 TODO 更新事件
		todoEvents.onTodoUpdate(handleTodoUpdate);

		// 清理监听器
		return () => {
			todoEvents.offTodoUpdate(handleTodoUpdate);
		};
	}, [props.isProcessing]);

	// 对话结束后自动隐藏
	useEffect(() => {
		if (!props.isProcessing && showTodos) {
			const timeoutId = setTimeout(() => {
				setShowTodos(false);
			}, 1000);

			return () => {
				clearTimeout(timeoutId);
			};
		}

		return;
	}, [props.isProcessing, showTodos]);

	useEffect(() => {
		if (!copyStatusMessage) return;
		const timeoutId = setTimeout(() => {
			setCopyStatusMessage(null);
		}, 2000);
		return () => {
			clearTimeout(timeoutId);
		};
	}, [copyStatusMessage]);

	return (
		<>
		{!props.showReviewCommitPanel && (
			<>
				<LoadingIndicator
					isStreaming={props.isStreaming}
					isStopping={props.isStopping}
					isSaving={props.isSaving}
					hasPendingToolConfirmation={props.hasPendingToolConfirmation}
					hasPendingUserQuestion={props.hasPendingUserQuestion}
					hasBlockingOverlay={props.hasBlockingOverlay}
					terminalWidth={props.terminalWidth}
					animationFrame={props.animationFrame}
					retryStatus={props.retryStatus}
					codebaseSearchStatus={props.codebaseSearchStatus}
					isReasoning={props.isReasoning}
					streamTokenCount={props.streamTokenCount}
					elapsedSeconds={props.elapsedSeconds}
					currentModel={props.currentModel}
					teamMode={props.teamMode}
				/>

				{props.btwPrompt ? (
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> Loading...
								</Text>
							</Box>
						}
					>
						<BtwPanel
							prompt={props.btwPrompt}
							onClose={props.onBtwClose}
						/>
					</Suspense>
				) : (
					<ChatInput
						onSubmit={props.onSubmit}
						onCommand={props.onCommand}
						placeholder={t.chatScreen.inputPlaceholder}
						disabled={props.disabled}
						disableKeyboardNavigation={props.showBackgroundPanel}
						isProcessing={props.isProcessing}
						chatHistory={props.chatHistory}
						onHistorySelect={props.handleHistorySelect}
						yoloMode={props.yoloMode}
						setYoloMode={props.setYoloMode}
						planMode={props.planMode}
						setPlanMode={props.setPlanMode}
						vulnerabilityHuntingMode={props.vulnerabilityHuntingMode}
						setVulnerabilityHuntingMode={props.setVulnerabilityHuntingMode}
						teamMode={props.teamMode}
						setTeamMode={props.setTeamMode}
						contextUsage={props.contextUsage}
						initialContent={props.initialContent}
						draftContent={props.draftContent}
						onDraftChange={props.onDraftChange}
						onContextPercentageChange={props.onContextPercentageChange}
						showProfilePicker={props.showProfilePicker}
						setShowProfilePicker={props.setShowProfilePicker}
						profileSelectedIndex={props.profileSelectedIndex}
						setProfileSelectedIndex={props.setProfileSelectedIndex}
						getFilteredProfiles={props.getFilteredProfiles}
						handleProfileSelect={props.handleProfileSelect}
						profileSearchQuery={props.profileSearchQuery}
						setProfileSearchQuery={props.setProfileSearchQuery}
						onSwitchProfile={props.onSwitchProfile}
						onCopyInputSuccess={() => {
							setCopyStatusMessage({
								text: `✔ ${t.chatScreen.inputCopySuccess}`,
								timestamp: Date.now(),
							});
						}}
						onCopyInputError={errorMessage => {
							setCopyStatusMessage({
								text: `✖ ${t.chatScreen.inputCopyFailedPrefix}: ${errorMessage}`,
								isError: true,
								timestamp: Date.now(),
							});
						}}
					/>
				)}

					{showTodos && todos.length > 0 && (
						<Box marginTop={1}>
							<TodoTree todos={todos} />
						</Box>
					)}

					<StatusLine
						yoloMode={props.yoloMode}
						planMode={props.planMode}
						vulnerabilityHuntingMode={props.vulnerabilityHuntingMode}
						toolSearchDisabled={props.toolSearchDisabled}
						hybridCompressEnabled={props.hybridCompressEnabled}
						teamMode={props.teamMode}
						vscodeConnectionStatus={props.vscodeConnectionStatus}
						editorContext={props.editorContext}
						connectionStatus={connectionStatus}
						connectionInstanceName={connectionInstanceName}
						contextUsage={props.contextUsage}
						codebaseIndexing={props.codebaseIndexing}
						codebaseProgress={props.codebaseProgress}
						watcherEnabled={props.watcherEnabled}
						fileUpdateNotification={props.fileUpdateNotification}
						copyStatusMessage={copyStatusMessage}
						currentProfileName={props.currentProfileName}
						compressBlockToast={props.compressBlockToast}
					/>

					{props.isCompressing && (
						<Box marginTop={1}>
							<Text color="cyan">
								<Spinner type="dots" /> {t.chatScreen.compressionInProgress}
							</Text>
						</Box>
					)}

					{props.compressionError && (
						<Box marginTop={1}>
							<Text color="red">
								{t.chatScreen.compressionFailed.replace(
									'{error}',
									props.compressionError,
								)}
							</Text>
						</Box>
					)}

					{props.showBackgroundPanel && (
						<BackgroundProcessPanel
							processes={props.backgroundProcesses}
							selectedIndex={props.selectedProcessIndex}
							terminalWidth={props.terminalWidth}
						/>
					)}
				</>
			)}

			{props.showReviewCommitPanel && (
				<Box marginTop={1}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> Loading...
								</Text>
							</Box>
						}
					>
						<ReviewCommitPanel
							visible={props.showReviewCommitPanel}
							onClose={() => props.setShowReviewCommitPanel(false)}
							onConfirm={props.onReviewCommitConfirm}
							maxHeight={6}
						/>
					</Suspense>
				</Box>
			)}
		</>
	);
});

export default ChatFooter;
