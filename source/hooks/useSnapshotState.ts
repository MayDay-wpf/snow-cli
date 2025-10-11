import {useState, useEffect} from 'react';
import {sessionManager} from '../utils/sessionManager.js';
import {incrementalSnapshotManager} from '../utils/incrementalSnapshot.js';

export function useSnapshotState(messagesLength: number) {
	const [snapshotFileCount, setSnapshotFileCount] = useState<Map<number, number>>(new Map());
	const [pendingRollback, setPendingRollback] = useState<{
		messageIndex: number;
		fileCount: number;
	} | null>(null);

	// Load snapshot file counts when session changes
	useEffect(() => {
		const loadSnapshotFileCounts = async () => {
			const currentSession = sessionManager.getCurrentSession();
			if (!currentSession) return;

			const snapshots = await incrementalSnapshotManager.listSnapshots(
				currentSession.id,
			);
			const counts = new Map<number, number>();

			for (const snapshot of snapshots) {
				counts.set(snapshot.messageIndex, snapshot.fileCount);
			}

			setSnapshotFileCount(counts);
		};

		loadSnapshotFileCounts();
	}, [messagesLength]); // Reload when messages change

	return {
		snapshotFileCount,
		setSnapshotFileCount,
		pendingRollback,
		setPendingRollback,
	};
}
