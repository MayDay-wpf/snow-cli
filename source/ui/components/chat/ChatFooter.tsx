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
import {getTodoService} from '../../../utils/execution/mcpToolsManager.js';
import {connectionManager} from '../../../utils/connection/ConnectionManager.js';
import {CompanionSprite} from '../../../buddy/CompanionSprite.js';

const ReviewCommitPanel = lazy(() => import('../panels/ReviewCommitPanel.js'));
import type {ReviewCommitSelection} from '../panels/ReviewCommitPanel.js';
import {IdeSelectPanel} from '../panels/IdeSelectPanel.js';
const BtwPanel = lazy(() => import('../panels/BtwPanel.js'));
const DiffReviewPanel = lazy(() => import('../panels/DiffReviewPanel.js'));
const SkillsListPanel = lazy(() => import('../panels/SkillsListPanel.js'));

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
	/** 在 ProfilePanel 中按右方向键时进入 ProfileEditPanel 编辑该 profile */
	handleProfileEdit?: (profileName: string) => void;
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

	// Diff review panel props
	showDiffReviewPanel: boolean;
	setShowDiffReviewPanel: React.Dispatch<React.SetStateAction<boolean>>;
	diffReviewMessages: Array<{
		role: string;
		content: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
		subAgentDirected?: unknown;
	}>;
	diffReviewSnapshotFileCount: Map<number, number>;

	disabled: boolean;
	isStopping: boolean;
	isProcessing: boolean;
	isPaused: boolean;
	chatHistory: Message[];
	yoloMode: boolean;
	setYoloMode: (value: boolean) => void;
	planMode: boolean;
	setPlanMode: (value: boolean) => void;
	vulnerabilityHuntingMode: boolean;
	setVulnerabilityHuntingMode: (value: boolean) => void;
	toolSearchDisabled: boolean;
	hybridCompressEnabled: boolean;
	imageCompressEnabled: boolean;
	teamMode: boolean;
	ultraTodoEnabled: boolean;
	telemetryEnabled: boolean;
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
	onInitialContentConsumed: () => void;
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
	isAutoCompressing?: boolean;
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

	// IDE select panel props
	showIdeSelectPanel: boolean;
	setShowIdeSelectPanel: React.Dispatch<React.SetStateAction<boolean>>;
	onIdeConnectionChange: (
		status: 'connected' | 'disconnected',
		message?: string,
	) => void;
	onIdeWorkingDirectoryChanged?: (newCwd: string) => void;

	// Skills list panel props
	showSkillsListPanel: boolean;
	setShowSkillsListPanel: React.Dispatch<React.SetStateAction<boolean>>;

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

	// 使用事件监听 TODO 更新，替代轮询；同时监听当前会话切换，避免压缩后仍绑定旧会话 ID。
	useEffect(() => {
		let disposed = false;
		let observedSessionId = sessionManager.getCurrentSession()?.id ?? null;

		const loadTodosForCurrentSession = async (force = false) => {
			const currentSession = sessionManager.getCurrentSession();
			const nextSessionId = currentSession?.id ?? null;

			if (!force && nextSessionId === observedSessionId) {
				return;
			}

			observedSessionId = nextSessionId;

			if (!currentSession) {
				if (!disposed) {
					setShowTodos(false);
					setTodos([]);
				}
				return;
			}

			try {
				const todoList = await getTodoService().getTodoList(currentSession.id);
				if (
					disposed ||
					sessionManager.getCurrentSession()?.id !== currentSession.id
				) {
					return;
				}

				setTodos(todoList?.todos ?? []);
			} catch (error) {
				console.error('Failed to load current session TODO list:', error);
				if (!disposed) {
					setTodos([]);
				}
			}
		};

		const handleTodoUpdate = (data: {sessionId: string; todos: TodoItem[]}) => {
			// 始终按事件发生时的当前会话判断，避免压缩切换会话后闭包仍引用旧会话。
			const currentSession = sessionManager.getCurrentSession();
			if (currentSession && data.sessionId === currentSession.id) {
				observedSessionId = currentSession.id;
				setTodos(data.todos);
				if (data.todos.length > 0 && props.isProcessing) {
					setShowTodos(true);
				}
			}
		};

		const unsubscribeSessionChanges = sessionManager.onMessagesChanged(() => {
			void loadTodosForCurrentSession(false);
		});

		void loadTodosForCurrentSession(true);
		todoEvents.onTodoUpdate(handleTodoUpdate);

		return () => {
			disposed = true;
			unsubscribeSessionChanges();
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

	// 统一处理：ChatFooter 内部会把 ChatInput 替换为 ReviewCommitPanel / IdeSelectPanel
	// 这两类面板（见下方条件渲染）。这些面板打开时 footer 整体仍在渲染，
	// ChatScreen 的 shouldShowFooter 侧通用逻辑覆盖不到，需要在此清空 draft，
	// 避免面板关闭后 ChatInput 重新挂载时把旧文本恢复进输入框。
	useEffect(() => {
		if (
			props.showReviewCommitPanel ||
			props.showIdeSelectPanel ||
			props.showDiffReviewPanel ||
			props.showSkillsListPanel
		) {
			props.onDraftChange(null);
		}
	}, [props.showReviewCommitPanel, props.showIdeSelectPanel, props.showDiffReviewPanel, props.showSkillsListPanel]);

	return (
		<>
			{!props.showReviewCommitPanel &&
				!props.showIdeSelectPanel &&
				!props.showDiffReviewPanel &&
				!props.showSkillsListPanel && (
					<>
						<LoadingIndicator
							isStreaming={props.isStreaming}
							isStopping={props.isStopping}
							isSaving={props.isSaving}
							isCompressing={props.isCompressing}
							isAutoCompressing={props.isAutoCompressing}
							isPaused={props.isPaused}
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

						{showTodos && todos.length > 0 && (
							<Box marginTop={1}>
								<TodoTree todos={todos} />
							</Box>
						)}

						{props.btwPrompt ? (
							<Suspense
								fallback={
									<Box>
										<Text>
											<Spinner type="dots" />{' '}
											{(t as any).panelChrome?.loading || 'Loading…'}
										</Text>
									</Box>
								}
							>
								<BtwPanel prompt={props.btwPrompt} onClose={props.onBtwClose} />
							</Suspense>
						) : (
							<>
								<Box width="100%" paddingRight={1}>
									<CompanionSprite
										terminalColumns={Math.max(0, props.terminalWidth - 1)}
									/>
								</Box>
								<ChatInput
									onSubmit={props.onSubmit}
									onCommand={props.onCommand}
									placeholder={t.chatScreen.inputPlaceholder}
									disabled={props.disabled}
									disableKeyboardNavigation={props.showBackgroundPanel}
									isProcessing={props.isProcessing}
									isPaused={props.isPaused}
									chatHistory={props.chatHistory}
									onHistorySelect={props.handleHistorySelect}
									yoloMode={props.yoloMode}
									setYoloMode={props.setYoloMode}
									planMode={props.planMode}
									setPlanMode={props.setPlanMode}
									vulnerabilityHuntingMode={props.vulnerabilityHuntingMode}
									setVulnerabilityHuntingMode={
										props.setVulnerabilityHuntingMode
									}
									teamMode={props.teamMode}
									setTeamMode={props.setTeamMode}
									contextUsage={props.contextUsage}
									initialContent={props.initialContent}
									draftContent={props.draftContent}
									onDraftChange={props.onDraftChange}
									onContextPercentageChange={props.onContextPercentageChange}
									onInitialContentConsumed={props.onInitialContentConsumed}
									showProfilePicker={props.showProfilePicker}
									setShowProfilePicker={props.setShowProfilePicker}
									profileSelectedIndex={props.profileSelectedIndex}
									setProfileSelectedIndex={props.setProfileSelectedIndex}
									getFilteredProfiles={props.getFilteredProfiles}
									handleProfileSelect={props.handleProfileSelect}
									handleProfileEdit={props.handleProfileEdit}
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
							</>
						)}

						<StatusLine
							yoloMode={props.yoloMode}
							planMode={props.planMode}
							vulnerabilityHuntingMode={props.vulnerabilityHuntingMode}
							toolSearchDisabled={props.toolSearchDisabled}
							hybridCompressEnabled={props.hybridCompressEnabled}
							imageCompressEnabled={props.imageCompressEnabled}
							teamMode={props.teamMode}
							ultraTodoEnabled={props.ultraTodoEnabled}
							telemetryEnabled={props.telemetryEnabled}
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
									<Spinner type="dots" /> {(t as any).panelChrome?.loading || 'Loading…'}
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

			{props.showIdeSelectPanel && (
				<IdeSelectPanel
					visible={props.showIdeSelectPanel}
					onClose={() => props.setShowIdeSelectPanel(false)}
					onConnectionChange={props.onIdeConnectionChange}
					onWorkingDirectoryChanged={props.onIdeWorkingDirectoryChanged}
				/>
			)}

			{props.showSkillsListPanel && (
				<Box marginTop={1} flexDirection="column">
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> {(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<SkillsListPanel
							onClose={() => props.setShowSkillsListPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{props.showDiffReviewPanel && (
				<Suspense
					fallback={
						<Box>
							<Text>
								<Spinner type="dots" /> {(t as any).panelChrome?.loading || 'Loading…'}
							</Text>
						</Box>
					}
				>
					<DiffReviewPanel
						messages={props.diffReviewMessages}
						snapshotFileCount={props.diffReviewSnapshotFileCount}
						onClose={() => props.setShowDiffReviewPanel(false)}
						terminalWidth={props.terminalWidth}
					/>
				</Suspense>
			)}
		</>
	);
});

export default ChatFooter;
