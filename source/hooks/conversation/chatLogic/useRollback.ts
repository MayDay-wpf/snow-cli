import {useEffect} from 'react';
import type {UseChatLogicProps} from './types.js';
import type {RollbackMode} from '../../../ui/components/tools/FileRollbackConfirmation.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {hashBasedSnapshotManager} from '../../../utils/codebase/hashBasedSnapshot.js';
import {convertSessionMessagesToUI} from '../../../utils/session/sessionConverter.js';
import {connectionManager} from '../../../utils/connection/ConnectionManager.js';
import {cleanIDEContext} from '../../../utils/core/fileUtils.js';
import {
	getNotebookRollbackCount,
	rollbackNotebooks,
	deleteNotebookSnapshotsFromIndex,
	clearAllNotebookSnapshots,
} from '../../../utils/core/notebookManager.js';

export function useRollback(props: UseChatLogicProps) {
	const {
		messages,
		setMessages,
		snapshotState,
		clearSavedMessages,
		setRemountKey,
		setRestoreInputContent,
		currentContextPercentageRef,
		streamingState,
	} = props;

	// Notify VSCode/Web when a rollback confirmation is needed
	useEffect(() => {
		const pendingRollback = snapshotState.pendingRollback;
		if (!pendingRollback) {
			return;
		}

		void connectionManager.notifyRollbackConfirmationNeeded({
			filePaths: pendingRollback.filePaths || [],
			notebookCount: pendingRollback.notebookCount || 0,
		});
	}, [snapshotState.pendingRollback]);

	const performRollback = async (
		selectedIndex: number,
		rollbackFiles: boolean,
		rollbackConversation: boolean,
		selectedFiles?: string[],
	) => {
		const currentSession = sessionManager.getCurrentSession();

		if (rollbackFiles && currentSession) {
			if (selectedFiles && selectedFiles.length > 0) {
				await hashBasedSnapshotManager.rollbackToMessageIndex(
					currentSession.id,
					selectedIndex,
					selectedFiles,
				);
			} else {
				await hashBasedSnapshotManager.rollbackToMessageIndex(
					currentSession.id,
					selectedIndex,
				);
			}

			try {
				rollbackNotebooks(currentSession.id, selectedIndex);
			} catch (error) {
				console.error('Failed to rollback notebooks:', error);
			}
		}

		if (!rollbackConversation) {
			if (rollbackFiles && currentSession) {
				await hashBasedSnapshotManager.deleteSnapshotsFromIndex(
					currentSession.id,
					selectedIndex,
				);

				const snapshots = await hashBasedSnapshotManager.listSnapshots(
					currentSession.id,
				);
				const counts = new Map<number, number>();
				for (const snapshot of snapshots) {
					counts.set(snapshot.messageIndex, snapshot.fileCount);
				}
				snapshotState.setSnapshotFileCount(counts);
			}

			snapshotState.setPendingRollback(null);
			return;
		}

		if (currentSession) {
			const messagesAfterSelected = messages.slice(selectedIndex);
			const uiUserMessagesToDelete = messagesAfterSelected.filter(
				msg => msg.role === 'user',
			).length;
			const selectedMessage = messages[selectedIndex];
			const isUncommittedUserMessage =
				selectedMessage?.role === 'user' &&
				uiUserMessagesToDelete === 1 &&
				(selectedIndex === messages.length - 1 ||
					(selectedIndex === messages.length - 2 &&
						messages[messages.length - 1]?.discontinued));

			if (isUncommittedUserMessage) {
				const lastSessionMsg =
					currentSession.messages[currentSession.messages.length - 1];
				const sessionEndsWithAssistant =
					lastSessionMsg?.role === 'assistant' && !lastSessionMsg?.tool_calls;

				if (sessionEndsWithAssistant) {
					setMessages(prev => prev.slice(0, selectedIndex));
					clearSavedMessages();

					setTimeout(() => {
						setRemountKey(prev => prev + 1);
						snapshotState.setPendingRollback(null);
					}, 0);
					return;
				}
			}

			let sessionTruncateIndex = currentSession.messages.length;

			if (selectedIndex === 0) {
				sessionTruncateIndex = 0;
			} else {
				let sessionUserMessageCount = 0;

				for (let i = currentSession.messages.length - 1; i >= 0; i--) {
					const msg = currentSession.messages[i];
					if (msg && msg.role === 'user') {
						sessionUserMessageCount++;
						if (sessionUserMessageCount === uiUserMessagesToDelete) {
							sessionTruncateIndex = i;
							break;
						}
					}
				}
			}

			if (sessionTruncateIndex === 0 && currentSession) {
				await hashBasedSnapshotManager.clearAllSnapshots(currentSession.id);

				clearAllNotebookSnapshots(currentSession.id);

				await sessionManager.deleteSession(currentSession.id);

				sessionManager.clearCurrentSession();

				setMessages([]);

				clearSavedMessages();

				snapshotState.setSnapshotFileCount(new Map());

				setTimeout(() => {
					setRemountKey(prev => prev + 1);
					snapshotState.setPendingRollback(null);
				}, 0);

				return;
			}

			await hashBasedSnapshotManager.deleteSnapshotsFromIndex(
				currentSession.id,
				selectedIndex,
			);

			if (!rollbackFiles) {
				deleteNotebookSnapshotsFromIndex(currentSession.id, selectedIndex);
			}

			const snapshots = await hashBasedSnapshotManager.listSnapshots(
				currentSession.id,
			);
			const counts = new Map<number, number>();
			for (const snapshot of snapshots) {
				counts.set(snapshot.messageIndex, snapshot.fileCount);
			}
			snapshotState.setSnapshotFileCount(counts);

			await sessionManager.truncateMessages(sessionTruncateIndex);
		}

		setMessages(prev => prev.slice(0, selectedIndex));

		clearSavedMessages();

		setTimeout(() => {
			setRemountKey(prev => prev + 1);
			snapshotState.setPendingRollback(null);
		}, 0);
	};

	const switchToOriginalCompressedSession = async (
		originalSessionId: string,
		compressedSessionId?: string,
	) => {
		try {
			const originalSession = await sessionManager.loadSession(
				originalSessionId,
			);
			if (!originalSession) {
				console.error('Failed to load original session for rollback');
				return false;
			}

			sessionManager.setCurrentSession(originalSession);

			const uiMessages = convertSessionMessagesToUI(originalSession.messages);

			clearSavedMessages();
			setMessages(uiMessages);

			const snapshots = await hashBasedSnapshotManager.listSnapshots(
				originalSession.id,
			);
			const counts = new Map<number, number>();
			for (const snapshot of snapshots) {
				counts.set(snapshot.messageIndex, snapshot.fileCount);
			}
			snapshotState.setSnapshotFileCount(counts);

			if (compressedSessionId && compressedSessionId !== originalSessionId) {
				try {
					await hashBasedSnapshotManager.clearAllSnapshots(compressedSessionId);
					clearAllNotebookSnapshots(compressedSessionId);
					const deleted = await sessionManager.deleteSession(
						compressedSessionId,
					);
					if (!deleted) {
						console.warn(
							`Failed to delete compressed session after rollback: ${compressedSessionId}`,
						);
					}
				} catch (cleanupError) {
					console.error(
						'Failed to clean up compressed session after rollback:',
						cleanupError,
					);
				}
			}

			console.log(
				`Switched to original session (before compression) with ${originalSession.messageCount} messages`,
			);

			return true;
		} catch (error) {
			console.error('Failed to switch to original session:', error);
			return false;
		}
	};

	const handleHistorySelect = async (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => {
		streamingState.setContextUsage(null);
		currentContextPercentageRef.current = 0;

		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) return;

		if (
			selectedIndex === 0 &&
			currentSession.compressedFrom !== undefined &&
			currentSession.compressedFrom !== null
		) {
			let totalFileCount = 0;
			for (const [index, count] of snapshotState.snapshotFileCount.entries()) {
				if (index >= selectedIndex) {
					totalFileCount += count;
				}
			}

			if (totalFileCount > 0) {
				const filePaths = await hashBasedSnapshotManager.getFilesToRollback(
					currentSession.id,
					selectedIndex,
				);
				const nbCount = getNotebookRollbackCount(
					currentSession.id,
					selectedIndex,
				);
				snapshotState.setPendingRollback({
					messageIndex: selectedIndex,
					fileCount: filePaths.length,
					filePaths,
					notebookCount: nbCount,
					message: cleanIDEContext(message),
					images,
					crossSessionRollback: true,
					originalSessionId: currentSession.compressedFrom,
				});
				return;
			}

			const originalSessionId = currentSession.compressedFrom;
			const switchedToOriginalSession = await switchToOriginalCompressedSession(
				originalSessionId,
				currentSession.id,
			);
			if (switchedToOriginalSession) {
				setRemountKey(prev => prev + 1);
				return;
			}
		}

		const filePaths = await hashBasedSnapshotManager.getFilesToRollback(
			currentSession.id,
			selectedIndex,
		);

		const nbCount = getNotebookRollbackCount(currentSession.id, selectedIndex);

		if (filePaths.length > 0 || nbCount > 0) {
			snapshotState.setPendingRollback({
				messageIndex: selectedIndex,
				fileCount: filePaths.length,
				filePaths,
				notebookCount: nbCount,
				message: cleanIDEContext(message),
				images,
			});
		} else {
			setRestoreInputContent({
				text: cleanIDEContext(message),
				images,
			});
			await performRollback(selectedIndex, false, true);
		}
	};

	const handleRollbackConfirm = async (
		mode: RollbackMode | null,
		selectedFiles?: string[],
	) => {
		if (mode === null) {
			snapshotState.setPendingRollback(null);
			return;
		}

		const shouldRollbackFiles = mode === 'both' || mode === 'files';
		const shouldRollbackConversation =
			mode === 'both' || mode === 'conversation';

		if (snapshotState.pendingRollback) {
			if (shouldRollbackConversation && snapshotState.pendingRollback.message) {
				setRestoreInputContent({
					text: snapshotState.pendingRollback.message,
					images: snapshotState.pendingRollback.images,
				});
			}

			if (snapshotState.pendingRollback.crossSessionRollback) {
				const {originalSessionId} = snapshotState.pendingRollback;
				const compressedSessionId = sessionManager.getCurrentSession()?.id;

				if (shouldRollbackFiles) {
					await performRollback(
						snapshotState.pendingRollback.messageIndex,
						true,
						shouldRollbackConversation,
						selectedFiles,
					);
				}

				if (shouldRollbackConversation && originalSessionId) {
					const switchedToOriginalSession =
						await switchToOriginalCompressedSession(
							originalSessionId,
							shouldRollbackFiles ? undefined : compressedSessionId,
						);
					if (switchedToOriginalSession) {
						setTimeout(() => {
							setRemountKey(prev => prev + 1);
							snapshotState.setPendingRollback(null);
						}, 0);
					} else {
						snapshotState.setPendingRollback(null);
					}
				} else {
					snapshotState.setPendingRollback(null);
				}
			} else {
				await performRollback(
					snapshotState.pendingRollback.messageIndex,
					shouldRollbackFiles,
					shouldRollbackConversation,
					selectedFiles,
				);
			}
		}
	};

	const rollbackViaSSE = async (params: {
		serverUrl: string;
		sessionId: string;
		messageIndex: number;
		rollbackFiles: boolean;
		selectedFiles?: string[];
		requestId?: string;
	}) => {
		const response = await fetch(`${params.serverUrl}/message`, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				type: 'rollback',
				sessionId: params.sessionId,
				requestId: params.requestId,
				rollback: {
					messageIndex: params.messageIndex,
					rollbackFiles: params.rollbackFiles,
					selectedFiles: params.selectedFiles,
				},
			}),
		});

		if (!response.ok) {
			let detail: any = undefined;
			try {
				detail = await response.json();
			} catch {
				// ignore
			}
			throw new Error(
				`Rollback request failed: ${response.status} ${response.statusText}` +
					(detail ? ` (${JSON.stringify(detail)})` : ''),
			);
		}
	};

	return {
		handleHistorySelect,
		performRollback,
		handleRollbackConfirm,
		rollbackViaSSE,
	};
}
