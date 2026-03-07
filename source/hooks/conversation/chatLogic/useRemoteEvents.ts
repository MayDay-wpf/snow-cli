import {useEffect} from 'react';
import type {UseChatLogicProps} from './types.js';
import type {RollbackMode} from '../../../ui/components/tools/FileRollbackConfirmation.js';
import {connectionManager} from '../../../utils/connection/ConnectionManager.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {executeContextCompression} from '../useCommandHandler.js';

interface UseRemoteEventsHandlers {
	handleMessageSubmit: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
	) => Promise<void>;
	handleUserQuestionAnswer: (result: {
		selected: string | string[];
		customInput?: string;
		cancelled?: boolean;
	}) => void;
	handleHistorySelect: (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => Promise<void>;
	handleRollbackConfirm: (
		mode: RollbackMode | null,
		selectedFiles?: string[],
	) => Promise<void>;
}

export function useRemoteEvents(
	props: UseChatLogicProps,
	handlers: UseRemoteEventsHandlers,
) {
	const {
		messages,
		setMessages,
		setPendingMessages,
		streamingState,
		snapshotState,
		userInterruptedRef,
		pendingToolConfirmation,
		pendingUserQuestion,
		handleCommandExecution,
		setIsCompressing,
		setCompressionError,
		clearSavedMessages,
		setRemountKey,
	} = props;

	const {
		handleMessageSubmit,
		handleUserQuestionAnswer,
		handleHistorySelect,
		handleRollbackConfirm,
	} = handlers;

	// Remote message
	useEffect(() => {
		const unsubscribeRemoteMessage = connectionManager.onMessage(
			'remote_message',
			(data: any) => {
				if (data?.message && typeof data.message === 'string') {
					setMessages(prev => [
						...prev,
						{
							role: 'assistant',
							content: 'Remote message received from Web',
							streaming: false,
						},
					]);
					handleMessageSubmit(data.message);
				}
			},
		);

		return () => {
			unsubscribeRemoteMessage();
		};
	}, [handleMessageSubmit]);

	// Tool confirmation from remote
	useEffect(() => {
		const unsubscribeToolConfirmation = connectionManager.onMessage(
			'tool_confirmation_result',
			(data: any) => {
				if (!pendingToolConfirmation) {
					return;
				}

				const result = data?.result;
				if (
					result !== 'approve' &&
					result !== 'approve_always' &&
					result !== 'reject' &&
					result !== 'reject_with_reply'
				) {
					return;
				}

				if (result === 'reject_with_reply') {
					pendingToolConfirmation.resolve({
						type: 'reject_with_reply',
						reason: data?.reason || '',
					});
					return;
				}

				pendingToolConfirmation.resolve(result);
			},
		);

		return () => {
			unsubscribeToolConfirmation();
		};
	}, [pendingToolConfirmation]);

	// User question answer from remote
	useEffect(() => {
		const unsubscribeUserQuestion = connectionManager.onMessage(
			'user_question_result',
			(data: any) => {
				if (!pendingUserQuestion) {
					return;
				}

				let selected: string | string[] = data?.selected;
				if (typeof selected === 'string') {
					const trimmed = selected.trim();
					if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
						try {
							const parsed = JSON.parse(trimmed);
							if (Array.isArray(parsed)) {
								selected = parsed.filter(item => typeof item === 'string');
							}
						} catch {
							// Keep original selected value if parsing fails
						}
					}
				}

				handleUserQuestionAnswer({
					selected,
					customInput:
						typeof data?.customInput === 'string'
							? data.customInput
							: undefined,
					cancelled: Boolean(data?.cancelled),
				});
			},
		);

		return () => {
			unsubscribeUserQuestion();
		};
	}, [pendingUserQuestion, handleUserQuestionAnswer]);

	// Interrupt from remote
	useEffect(() => {
		const unsubscribeInterrupt = connectionManager.onMessage(
			'interrupt_message_processing',
			() => {
				if (!streamingState.isStreaming || !streamingState.abortController) {
					return;
				}

				userInterruptedRef.current = true;
				streamingState.setIsStopping(true);
				streamingState.setRetryStatus(null);
				streamingState.setCodebaseSearchStatus(null);
				streamingState.abortController.abort();
				setMessages(prev => prev.filter(msg => !msg.toolPending));
				setPendingMessages([]);
			},
		);

		return () => {
			unsubscribeInterrupt();
		};
	}, [streamingState, setMessages, setPendingMessages]);

	// Clear session from remote
	useEffect(() => {
		const unsubscribeClearSession = connectionManager.onMessage(
			'clear_session',
			() => {
				import('../../../utils/execution/commandExecutor.js').then(
					({executeCommand}) => {
						executeCommand('clear')
							.then(result => {
								if (handleCommandExecution) {
									handleCommandExecution('clear', result);
								}
							})
							.catch(() => {
								// Ignore command execution errors
							});
					},
				);
			},
		);

		return () => {
			unsubscribeClearSession();
		};
	}, [handleCommandExecution]);

	// Resume session from remote
	useEffect(() => {
		const unsubscribeResumeSession = connectionManager.onMessage(
			'resume_session',
			(data: any) => {
				const sessionId =
					typeof data?.sessionId === 'string' ? data.sessionId.trim() : '';
				if (!sessionId) {
					return;
				}
				import('../../../utils/execution/commandExecutor.js').then(
					({executeCommand}) => {
						executeCommand('resume', sessionId)
							.then(result => {
								if (handleCommandExecution) {
									handleCommandExecution('resume', result);
								}
							})
							.catch(() => {
								// Ignore command execution errors
							});
					},
				);
			},
		);

		return () => {
			unsubscribeResumeSession();
		};
	}, [handleCommandExecution]);

	// Rollback from remote
	useEffect(() => {
		const unsubscribeRollback = connectionManager.onMessage(
			'rollback_message',
			(data: any) => {
				if (streamingState.isStreaming) {
					return;
				}

				const userMessageOrder = Number(data?.userMessageOrder);
				if (!Number.isInteger(userMessageOrder) || userMessageOrder <= 0) {
					return;
				}

				const userMessageEntries = messages
					.map((msg, index) => ({msg, index}))
					.filter(entry => entry.msg.role === 'user');
				const targetEntry = userMessageEntries[userMessageOrder - 1];
				if (!targetEntry) {
					return;
				}

				handleHistorySelect(
					targetEntry.index,
					targetEntry.msg.content || '',
					targetEntry.msg.images,
				).catch(() => {
					// Ignore rollback errors from remote trigger
				});
			},
		);

		return () => {
			unsubscribeRollback();
		};
	}, [messages, streamingState.isStreaming, handleHistorySelect]);

	// Rollback confirmation from remote
	useEffect(() => {
		const unsubscribeRollbackConfirm = connectionManager.onMessage(
			'rollback_confirmation_result',
			(data: any) => {
				if (!snapshotState.pendingRollback) {
					return;
				}

				let mode: RollbackMode | null = null;
				if (typeof data?.rollbackMode === 'string') {
					mode = data.rollbackMode as RollbackMode;
				} else if (typeof data?.rollbackFiles === 'boolean') {
					mode = data.rollbackFiles ? 'both' : 'conversation';
				}

				const selectedFiles = Array.isArray(data?.selectedFiles)
					? data.selectedFiles.filter(
							(x: unknown): x is string => typeof x === 'string',
					  )
					: undefined;

				void handleRollbackConfirm(mode, selectedFiles);
			},
		);

		return () => {
			unsubscribeRollbackConfirm();
		};
	}, [snapshotState.pendingRollback, handleRollbackConfirm]);

	// Compact request from Web client
	useEffect(() => {
		const unsubscribeCompactRequest = connectionManager.onMessage(
			'compact_request',
			async () => {
				if (streamingState.isStreaming) {
					console.log(
						'[Compact] Ignoring compact request: streaming in progress',
					);
					return;
				}

				console.log('[Compact] Received compact request from Web');
				setIsCompressing(true);
				setCompressionError(null);

				try {
					await connectionManager.notifyCompactStarted();

					const currentSession = sessionManager.getCurrentSession();
					if (!currentSession) {
						throw new Error('No active session to compress');
					}

					const compressionResult = await executeContextCompression(
						currentSession.id,
					);

					if (!compressionResult) {
						throw new Error('Compression failed');
					}

					console.log('[Compact] Compression completed successfully');

					clearSavedMessages();
					setMessages(compressionResult.uiMessages);
					setRemountKey(prev => prev + 1);

					await connectionManager.notifyCompactCompleted({
						success: true,
						messageCount: compressionResult.uiMessages.length,
					});
				} catch (error) {
					const errorMsg =
						error instanceof Error
							? error.message
							: 'Unknown compression error';
					console.error('[Compact] Compression error:', errorMsg);
					setCompressionError(errorMsg);

					await connectionManager.notifyCompactCompleted({
						success: false,
						error: errorMsg,
					});
				} finally {
					setIsCompressing(false);
				}
			},
		);

		return () => {
			unsubscribeCompactRequest();
		};
	}, [
		streamingState.isStreaming,
		setIsCompressing,
		setCompressionError,
		clearSavedMessages,
		setMessages,
		setRemountKey,
	]);
}
