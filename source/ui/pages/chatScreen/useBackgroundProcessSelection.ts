import {useEffect, useMemo, useState} from 'react';
import type {BackgroundProcess} from '../../../hooks/execution/useBackgroundProcesses.js';

export function useBackgroundProcessSelection(processes: BackgroundProcess[]) {
	const [selectedProcessIndex, setSelectedProcessIndex] = useState(0);

	const sortedBackgroundProcesses = useMemo(() => {
		return [...processes].sort((a, b) => {
			if (a.status === 'running' && b.status !== 'running') return -1;
			if (a.status !== 'running' && b.status === 'running') return 1;
			return b.startedAt.getTime() - a.startedAt.getTime();
		});
	}, [processes]);

	useEffect(() => {
		if (
			sortedBackgroundProcesses.length > 0 &&
			selectedProcessIndex >= sortedBackgroundProcesses.length
		) {
			setSelectedProcessIndex(sortedBackgroundProcesses.length - 1);
		}
	}, [sortedBackgroundProcesses.length, selectedProcessIndex]);

	return {
		selectedProcessIndex,
		setSelectedProcessIndex,
		sortedBackgroundProcesses,
	};
}
