import {useRef, useEffect, useCallback} from 'react';
import type {UseChatLogicProps} from './chatLogic/types.js';
import {vscodeConnection} from '../../utils/ui/vscodeConnection.js';
import {codebaseSearchEvents} from '../../utils/codebase/codebaseSearchEvents.js';
import {useMessageProcessing} from './chatLogic/useMessageProcessing.js';
import {useRollback} from './chatLogic/useRollback.js';
import {useChatHandlers} from './chatLogic/useChatHandlers.js';
import {useRemoteEvents} from './chatLogic/useRemoteEvents.js';
import {useI18n} from '../../i18n/index.js';

export type {UseChatLogicProps};

export function useChatLogic(props: UseChatLogicProps) {
	const {
		pendingMessages,
		streamingState,
		setMessages,
		setPendingMessages,
		setRestoreInputContent,
		userInterruptedRef,
		vscodeState,
		commandsLoaded,
		terminalExecutionState,
		backgroundProcesses,
		schedulerExecutionState,
		hasFocus,
	} = props;

	// i18n
	const {t} = useI18n();

	// Sub-hook: message processing (submit, process, pending)
	const {
		handleMessageSubmit,
		processMessage,
		processMessageRef,
		processPendingMessages,
	} = useMessageProcessing(props);

	// Sub-hook: rollback logic
	const {handleHistorySelect, handleRollbackConfirm, rollbackViaSSE} =
		useRollback(props);

	// Sub-hook: misc handlers (quit, reindex, review, session, user question)
	const {
		handleUserQuestionAnswer,
		handleSessionPanelSelect,
		handleQuit,
		handleReindexCodebase,
		handleToggleCodebase,
		handleReviewCommitConfirm,
	} = useChatHandlers(props, {processMessage});

	// Sub-hook: remote event subscriptions (SignalR/connectionManager)
	useRemoteEvents(props, {
		handleMessageSubmit,
		handleUserQuestionAnswer,
		handleHistorySelect,
		handleRollbackConfirm,
	});

	// VSCode auto-connect logic
	const hasAttemptedAutoVscodeConnect = useRef(false);
	useEffect(() => {
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

		const timer = setTimeout(() => {
			(async () => {
				try {
					if (
						vscodeConnection.isConnected() ||
						vscodeConnection.isClientRunning()
					) {
						vscodeConnection.stop();
						vscodeConnection.resetReconnectAttempts();
						await new Promise(resolve => setTimeout(resolve, 100));
					}

					vscodeState.setVscodeConnectionStatus('connecting');
					await vscodeConnection.start();
				} catch (error) {
					vscodeState.setVscodeConnectionStatus('error');
				}
			})();
		}, 0);

		return () => clearTimeout(timer);
	}, [commandsLoaded, vscodeState]);

	// Auto-send pending messages when streaming stops
	useEffect(() => {
		if (streamingState.streamStatus === 'idle' && pendingMessages.length > 0) {
			const timer = setTimeout(() => {
				streamingState.setIsStreaming(true);
				processPendingMessages();
			}, 100);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [streamingState.streamStatus, pendingMessages.length]);

	// Codebase search events
	const setCodebaseSearchStatus = streamingState.setCodebaseSearchStatus;
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
		}) => {
			if (event.type === 'search-complete') {
				setCodebaseSearchStatus(null);
			} else {
				setCodebaseSearchStatus({
					isSearching: true,
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					currentTopN: event.currentTopN,
					message: event.message,
					query: event.query,
					originalResultsCount: event.originalResultsCount,
					suggestion: undefined,
				});
			}
		};

		codebaseSearchEvents.onSearchEvent(handleSearchEvent);

		return () => {
			codebaseSearchEvents.removeSearchEventListener(handleSearchEvent);
		};
	}, [setCodebaseSearchStatus]);

	// ESC interrupt handler
	const handleInterrupt = useCallback(() => {
		if (!streamingState.isStreaming || !streamingState.abortController) {
			return false;
		}

		if (streamingState.isAutoCompressing) {
			streamingState.setCompressBlockToast(t.chatScreen.compressionBlockToast);
			return true;
		}

		userInterruptedRef.current = true;
		streamingState.setIsStopping(true);
		streamingState.setRetryStatus(null);
		streamingState.setCodebaseSearchStatus(null);
		streamingState.abortController.abort();
		setMessages(prev => prev.filter(msg => !msg.toolPending));
		setPendingMessages([]);
		return true;
	}, [streamingState, setMessages, setPendingMessages, t]);

	// Consolidated ESC key handler
	const handleEscKey = useCallback(
		(key: {escape: boolean; ctrl: boolean}, input: string) => {
			if (backgroundProcesses?.showPanel) {
				if (key.escape) {
					backgroundProcesses.hidePanel();
					return true;
				}
				return false;
			}

			if (
				key.ctrl &&
				input === 'b' &&
				terminalExecutionState?.state.isExecuting &&
				!terminalExecutionState?.state.isBackgrounded
			) {
				Promise.all([
					import('../../mcp/bash.js'),
					import('../../hooks/execution/useBackgroundProcesses.js'),
				]).then(([{markCommandAsBackgrounded}, {showBackgroundPanel}]) => {
					markCommandAsBackgrounded();
					showBackgroundPanel();
				});
				terminalExecutionState.moveToBackground();
				return true;
			}

			if (!key.escape) return false;

			// Block ESC during auto-compression (including pre-message compression)
			if (streamingState.isAutoCompressing) {
				streamingState.setCompressBlockToast(
					t.chatScreen.compressionBlockToast,
				);
				return true;
			}

			// Handle scheduler task interruption
			if (schedulerExecutionState?.state.isRunning) {
				schedulerExecutionState.resetTask();
				// Also abort streaming if active
				if (streamingState.isStreaming && streamingState.abortController) {
					userInterruptedRef.current = true;
					streamingState.setIsStopping(true);
					streamingState.abortController.abort();
				}
				return true;
			}

			if (streamingState.isStopping && !streamingState.isStreaming) {
				streamingState.setIsStopping(false);
				return true;
			}

			if (
				streamingState.isStreaming &&
				streamingState.abortController &&
				hasFocus
			) {
				if (pendingMessages.length > 0) {
					const mergedText = pendingMessages
						.map(m => (m.text || '').trim())
						.filter(Boolean)
						.join('\n\n');
					const mergedImages = pendingMessages.flatMap(m => m.images ?? []);

					setRestoreInputContent({
						text: mergedText,
						images:
							mergedImages.length > 0
								? mergedImages.map(img => ({
										type: 'image' as const,
										data: img.data,
										mimeType: img.mimeType,
								  }))
								: undefined,
					});
					setPendingMessages([]);
					return true;
				}

				return handleInterrupt();
			}

			return false;
		},
		[
			backgroundProcesses,
			terminalExecutionState,
			streamingState,
			hasFocus,
			pendingMessages,
			handleInterrupt,
			setRestoreInputContent,
			setPendingMessages,
			schedulerExecutionState,
			t,
		],
	);

	return {
		handleMessageSubmit,
		processMessage: processMessageRef.current!,
		processPendingMessages,
		handleHistorySelect,
		handleRollbackConfirm,
		handleUserQuestionAnswer,
		handleSessionPanelSelect,
		handleQuit,
		handleReindexCodebase,
		handleToggleCodebase,
		handleReviewCommitConfirm,
		rollbackViaSSE,
		handleInterrupt,
		handleEscKey,
	};
}

export type UseChatLogicReturn = ReturnType<typeof useChatLogic>;
