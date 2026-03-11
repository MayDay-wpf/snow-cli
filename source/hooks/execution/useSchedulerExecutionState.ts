import {useState, useCallback} from 'react';

export interface SchedulerExecutionState {
	/** 是否正在执行倒计时 */
	isRunning: boolean;
	/** 任务描述 */
	description: string | null;
	/** 总等待时长（秒） */
	totalDuration: number;
	/** 剩余时间（秒） */
	remainingSeconds: number;
	/** 任务开始时间 */
	startedAt: string | null;
	/** 任务是否已完成 */
	isCompleted: boolean;
	/** 完成时间 */
	completedAt: string | null;
}

// Global state for scheduler execution (shared across components)
let globalSetState: ((state: SchedulerExecutionState) => void) | null = null;
let globalState: SchedulerExecutionState | null = null;

/**
 * Hook to manage scheduler execution state
 * Used by ChatScreen to display countdown UI
 */
export function useSchedulerExecutionState() {
	const [state, setState] = useState<SchedulerExecutionState>({
		isRunning: false,
		description: null,
		totalDuration: 0,
		remainingSeconds: 0,
		startedAt: null,
		isCompleted: false,
		completedAt: null,
	});

	// Always update global setter to ensure it's current
	globalSetState = setState;
	globalState = state;

	const startTask = useCallback((description: string, duration: number) => {
		const now = new Date().toISOString();
		setState({
			isRunning: true,
			description,
			totalDuration: duration,
			remainingSeconds: duration,
			startedAt: now,
			isCompleted: false,
			completedAt: null,
		});
	}, []);

	const updateRemainingTime = useCallback((seconds: number) => {
		if (globalSetState && globalState) {
			globalSetState({
				...globalState,
				remainingSeconds: Math.max(0, seconds),
			});
		}
	}, []);

	const completeTask = useCallback(() => {
		const now = new Date().toISOString();
		setState(prev => ({
			...prev,
			isRunning: false,
			isCompleted: true,
			completedAt: now,
			remainingSeconds: 0,
		}));
	}, []);

	const resetTask = useCallback(() => {
		setState({
			isRunning: false,
			description: null,
			totalDuration: 0,
			remainingSeconds: 0,
			startedAt: null,
			isCompleted: false,
			completedAt: null,
		});
	}, []);

	return {
		state,
		startTask,
		updateRemainingTime,
		completeTask,
		resetTask,
	};
}

/**
 * Set scheduler execution state from anywhere (e.g., tool executor)
 * This allows non-React code to update the UI state
 */
export function setSchedulerExecutionState(state: SchedulerExecutionState) {
	if (globalSetState) {
		globalSetState(state);
	}
}

/**
 * Start a scheduler task from anywhere
 */
export function startSchedulerTask(description: string, duration: number) {
	if (globalSetState) {
		const now = new Date().toISOString();
		globalSetState({
			isRunning: true,
			description,
			totalDuration: duration,
			remainingSeconds: duration,
			startedAt: now,
			isCompleted: false,
			completedAt: null,
		});
	}
}

/**
 * Update remaining time from anywhere
 */
export function updateSchedulerRemainingTime(seconds: number) {
	if (globalSetState && globalState) {
		globalSetState({
			...globalState,
			remainingSeconds: Math.max(0, seconds),
		});
	}
}

/**
 * Mark task as completed from anywhere
 */
export function completeSchedulerTask() {
	if (globalSetState && globalState) {
		const now = new Date().toISOString();
		globalSetState({
			...globalState,
			isRunning: false,
			isCompleted: true,
			completedAt: now,
			remainingSeconds: 0,
		});
	}
}

/**
 * Reset scheduler state from anywhere
 */
export function resetSchedulerState() {
	if (globalSetState) {
		globalSetState({
			isRunning: false,
			description: null,
			totalDuration: 0,
			remainingSeconds: 0,
			startedAt: null,
			isCompleted: false,
			completedAt: null,
		});
	}
}

/**
 * Get current scheduler state
 */
export function getSchedulerState(): SchedulerExecutionState | null {
	return globalState;
}
