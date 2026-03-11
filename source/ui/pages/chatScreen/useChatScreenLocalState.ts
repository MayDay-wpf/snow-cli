import {useCallback, useEffect, useRef, useState} from 'react';
import type {Message} from '../../components/chat/MessageList.js';
import type {HookErrorDetails} from '../../../utils/execution/hookResultHandler.js';
import type {CompressionStatus} from '../../components/compression/CompressionStatus.js';
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
	const [pendingUserQuestion, setPendingUserQuestion] =
		useState<PendingUserQuestionState>(null);
	const [compressionStatus, setCompressionStatus] =
		useState<CompressionStatus | null>(null);

	useEffect(() => {
		currentContextPercentageRef.current = currentContextPercentage;
	}, [currentContextPercentage]);

	useEffect(() => {
		pendingMessagesRef.current = pendingMessages;
	}, [pendingMessages]);

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

	useEffect(() => {
		if (restoreInputContent !== null) {
			const timer = setTimeout(() => {
				setRestoreInputContent(null);
			}, 100);
			return () => clearTimeout(timer);
		}

		return undefined;
	}, [restoreInputContent]);

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
	};
}
