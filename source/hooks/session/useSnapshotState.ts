import {useState, useEffect} from 'react';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {hashBasedSnapshotManager} from '../../utils/codebase/hashBasedSnapshot.js';

export function useSnapshotState(messagesLength: number) {
	const currentSessionId = sessionManager.getCurrentSession()?.id ?? null;
	const [snapshotFileCount, setSnapshotFileCount] = useState<
		Map<number, number>
	>(new Map());
	const [pendingRollback, setPendingRollback] = useState<{
		messageIndex: number;
		fileCount: number;
		filePaths?: string[];
		notebookCount?: number; // 需要回滚的 notebook 数量
		message?: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
		crossSessionRollback?: boolean; // 是否跨会话回滚
		originalSessionId?: string; // 原会话ID(压缩前的会话)
	} | null>(null);

	// Reload when message count or current session changes, and ignore stale async results.
	useEffect(() => {
		let disposed = false;

		const loadSnapshotFileCounts = async () => {
			if (!currentSessionId) {
				if (!disposed) {
					setSnapshotFileCount(new Map());
				}
				return;
			}

			const snapshots = await hashBasedSnapshotManager.listSnapshots(
				currentSessionId,
			);
			if (
				disposed ||
				sessionManager.getCurrentSession()?.id !== currentSessionId
			) {
				return;
			}

			const counts = new Map<number, number>();
			for (const snapshot of snapshots) {
				counts.set(snapshot.messageIndex, snapshot.fileCount);
			}

			setSnapshotFileCount(counts);
		};

		void loadSnapshotFileCounts();
		return () => {
			disposed = true;
		};
	}, [messagesLength, currentSessionId]);

	return {
		snapshotFileCount,
		setSnapshotFileCount,
		pendingRollback,
		setPendingRollback,
	};
}
