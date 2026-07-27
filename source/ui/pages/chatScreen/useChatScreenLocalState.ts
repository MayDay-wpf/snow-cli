import {useCallback, useEffect, useRef, useState} from 'react';
import type {Message} from '../../components/chat/MessageList.js';
import type {HookErrorDetails} from '../../../utils/execution/hookResultInterpreter.js';
import type {CompressionStatus} from '../../components/compression/CompressionStatus.js';
import type {ThinkingStatus} from '../../components/chat/ThinkingStatus.js';
import type {HookStatusEvent} from '../../../utils/execution/hookStatusEvents.js';
import {onHookStatus} from '../../../utils/execution/hookStatusEvents.js';
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
	const [messages, setMessages] = useState<Message[]>([]);
	const [isSaving] = useState(false);
	const [pendingMessages, setPendingMessages] = useState<PendingMessageInput[]>(
		[],
	);
	const pendingMessagesRef = useRef<PendingMessageInput[]>([]);
	const userInterruptedRef = useRef(false);
	const cutInterruptRef = useRef(false);
	const [remountKey, setRemountKey] = useState(0);
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
	const [showDisplayPanel, setShowDisplayPanel] = useState(false);
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
		): Promise<PendingUserQuestionResult> => {
			return new Promise(resolve => {
				setPendingUserQuestion({
					question,
					options,
					toolCall,
					resolve,
				});
			});
		},
		[],
	);

	return {
		messages,
		setMessages,
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
		showDisplayPanel,
		setShowDisplayPanel,
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
