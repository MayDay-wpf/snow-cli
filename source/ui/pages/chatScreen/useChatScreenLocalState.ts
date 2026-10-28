import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from 'react';
import type {Message} from '../../components/chat/MessageList.js';
import type {HookErrorDetails} from '../../../utils/execution/hookResultInterpreter.js';
import type {CompressionStatus} from '../../components/compression/CompressionStatus.js';
import type {ThinkingStatus} from '../../components/chat/ThinkingStatus.js';
import type {HookStatusEvent} from '../../../utils/execution/hookStatusEvents.js';
import {onHookStatus} from '../../../utils/execution/hookStatusEvents.js';
import {
	StaticFeed,
	MAX_LIVE_BYTES,
	MAX_LIVE_MESSAGES,
	isAppendUpdate,
} from './staticFeed.js';
import {configEvents} from '../../../utils/config/configEvents.js';
import {getFullMessageMode} from '../../../utils/config/themeConfig.js';
import type {
	BashSensitiveCommandState,
	CustomCommandExecutionState,
	DraftContent,
	PendingMessageInput,
	PendingUserQuestionResult,
	PendingUserQuestionState,
	RestoreInputContent,
} from './types.js';

export function useChatScreenLocalState() {
	const [messages, setMessagesRaw] = useState<Message[]>([]);
	const [isSaving] = useState(false);
	const [pendingMessages, setPendingMessages] = useState<PendingMessageInput[]>(
		[],
	);
	const pendingMessagesRef = useRef<PendingMessageInput[]>([]);
	const userInterruptedRef = useRef(false);
	const cutInterruptRef = useRef(false);
	const [remountKey, setRemountKey] = useState(0);

	// 面向 <Static> 的单调长度投喂流：内存里只保留有界的尾部窗口，
	// 被裁掉的内容早已写入终端 scrollback，因此裁剪对显示无影响。
	const feedRef = useRef<StaticFeed | null>(null);
	if (!feedRef.current) {
		feedRef.current = new StaticFeed();
	}

	const feed = feedRef.current;
	const messagesRef = useRef<Message[]>([]);
	// /full-msg：开启后不再裁剪，保留完整会话历史。
	const fullMessageModeRef = useRef(getFullMessageMode());

	const setMessages = useCallback<Dispatch<SetStateAction<Message[]>>>(
		updater => {
			const previous = messagesRef.current;
			const next =
				typeof updater === 'function'
					? (updater as (prev: Message[]) => Message[])(previous)
					: updater;

			if (next === previous) {
				return;
			}

			if (next.length === 0) {
				feed.reset();
			} else if (isAppendUpdate(previous, next)) {
				feed.appendMessages(next.slice(previous.length));
			} else {
				// 收缩 / 原地更新 / 全量替换：统一重建窗口。
				// 用户消息（回滚锚点）在 trim 中永不裁剪，因此无需区分裁剪历史。
				feed.replaceWindow(next);
			}

			// /full-msg 开启时跳过裁剪，保留完整会话历史。
			if (!fullMessageModeRef.current) {
				feed.trim(MAX_LIVE_MESSAGES, MAX_LIVE_BYTES);
			}

			const bounded = feed.liveMessages();
			messagesRef.current = bounded;
			setMessagesRaw(bounded);
		},
		[feed],
	);

	// /full-msg 切换后即时生效：关闭裁剪时立刻收敛窗口。
	useEffect(() => {
		const handleConfigChange = (event: {type: string; value: any}) => {
			if (event.type !== 'fullMessageMode') {
				return;
			}

			const enabled = Boolean(event.value);
			fullMessageModeRef.current = enabled;

			if (!enabled) {
				feed.trim(MAX_LIVE_MESSAGES, MAX_LIVE_BYTES);
				const bounded = feed.liveMessages();
				messagesRef.current = bounded;
				setMessagesRaw(bounded);
			}
		};

		configEvents.onConfigChange(handleConfigChange);

		return () => {
			configEvents.removeConfigChangeListener(handleConfigChange);
		};
	}, [feed]);

	const [currentContextPercentage, setCurrentContextPercentage] = useState(0);
	const currentContextPercentageRef = useRef(0);
	const [isExecutingTerminalCommand, setIsExecutingTerminalCommand] =
		useState(false);
	const [customCommandExecution, setCustomCommandExecution] =
		useState<CustomCommandExecutionState>(null);
	const [isCompressing, setIsCompressing] = useState(false);
	const [compressionError, setCompressionError] = useState<string | null>(null);
	const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
	const [showSubAgentDepthPanel, setShowSubAgentDepthPanel] = useState(false);
	const [restoreInputContent, setRestoreInputContent] =
		useState<RestoreInputContent>(null);
	const [inputDraftContent, setInputDraftContent] =
		useState<DraftContent>(null);
	const [bashSensitiveCommand, setBashSensitiveCommand] =
		useState<BashSensitiveCommandState>(null);
	const [suppressLoadingIndicator, setSuppressLoadingIndicator] =
		useState(false);
	const hadBashSensitiveCommandRef = useRef(false);
	const [hookError, setHookError] = useState<HookErrorDetails | null>(null);
	const [hookStatus, setHookStatus] = useState<HookStatusEvent | null>(null);
	const hookStatusClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [pendingUserQuestion, setPendingUserQuestion] =
		useState<PendingUserQuestionState>(null);
	const [compressionStatus, setCompressionStatus] =
		useState<CompressionStatus | null>(null);
	const [thinkingStatus, setThinkingStatus] = useState<ThinkingStatus | null>(
		null,
	);
	const [isResumingSession, setIsResumingSession] = useState(false);
	const [btwPrompt, setBtwPrompt] = useState<string | null>(null);

	useEffect(() => {
		currentContextPercentageRef.current = currentContextPercentage;
	}, [currentContextPercentage]);

	useEffect(() => {
		pendingMessagesRef.current = pendingMessages;
	}, [pendingMessages]);

	// Live Hook execution status (Unicode icons + spinner in HookStatusDisplay)
	useEffect(() => {
		const unsubscribe = onHookStatus(event => {
			if (hookStatusClearTimerRef.current) {
				clearTimeout(hookStatusClearTimerRef.current);
				hookStatusClearTimerRef.current = null;
			}

			if (!event || event.phase === 'idle') {
				setHookStatus(null);
				return;
			}

			setHookStatus(event);

			// Auto-clear terminal success/failed banner so it does not stick
			if (event.phase === 'success' || event.phase === 'failed') {
				const delayMs = event.phase === 'success' ? 1600 : 3200;
				hookStatusClearTimerRef.current = setTimeout(() => {
					setHookStatus(current =>
						current && current.phase === event.phase ? null : current,
					);
					hookStatusClearTimerRef.current = null;
				}, delayMs);
			}
		});

		return () => {
			unsubscribe();
			if (hookStatusClearTimerRef.current) {
				clearTimeout(hookStatusClearTimerRef.current);
				hookStatusClearTimerRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		const hasPanel = !!bashSensitiveCommand;
		const hadPanel = hadBashSensitiveCommandRef.current;
		hadBashSensitiveCommandRef.current = hasPanel;

		if (hasPanel) {
			setSuppressLoadingIndicator(true);
			return undefined;
		}

		if (hadPanel && !hasPanel) {
			setSuppressLoadingIndicator(true);
			const timer = setTimeout(() => {
				setSuppressLoadingIndicator(false);
			}, 120);
			return () => clearTimeout(timer);
		}

		return undefined;
	}, [bashSensitiveCommand]);

	// restoreInputContent must be cleared only after ChatInput actually consumes it.
	// During rollback confirmation the footer is hidden, so clearing by timeout here
	// can drop the restored user message before the input is remounted.

	const requestUserQuestion = useCallback(
		async (
			question: string,
			options: string[],
			toolCall: any,
			multiSelect?: boolean,
		): Promise<PendingUserQuestionResult> => {
			return new Promise(resolve => {
				setPendingUserQuestion({
					question,
					options,
					toolCall,
					resolve,
					multiSelect,
				});
			});
		},
		[],
	);

	return {
		messages,
		setMessages,
		feed,
		trimmedUserMessageCount: feed.trimmedUserMessages,
		committedMessageCount: feed.committed,
		isSaving,
		pendingMessages,
		setPendingMessages,
		pendingMessagesRef,
		userInterruptedRef,
		cutInterruptRef,
		remountKey,
		setRemountKey,
		currentContextPercentage,
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
		hookStatus,
		setHookStatus,
		pendingUserQuestion,
		setPendingUserQuestion,
		requestUserQuestion,
		compressionStatus,
		setCompressionStatus,
		thinkingStatus,
		setThinkingStatus,
		isResumingSession,
		setIsResumingSession,
		btwPrompt,
		setBtwPrompt,
	};
}
