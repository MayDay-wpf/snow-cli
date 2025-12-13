import {useState, useCallback} from 'react';

export interface TerminalExecutionState {
	isExecuting: boolean;
	command: string | null;
	timeout: number | null;
}

// Global state for terminal execution (shared across components)
let globalSetState: ((state: TerminalExecutionState) => void) | null = null;

/**
 * Hook to manage terminal execution state
 * Used by ChatScreen to display execution status
 */
export function useTerminalExecutionState() {
	const [state, setState] = useState<TerminalExecutionState>({
		isExecuting: false,
		command: null,
		timeout: null,
	});

	// Register global setter on mount
	if (!globalSetState) {
		globalSetState = setState;
	}

	const startExecution = useCallback((command: string, timeout: number) => {
		setState({
			isExecuting: true,
			command,
			timeout,
		});
	}, []);

	const endExecution = useCallback(() => {
		setState({
			isExecuting: false,
			command: null,
			timeout: null,
		});
	}, []);

	return {
		state,
		startExecution,
		endExecution,
	};
}

/**
 * Set terminal execution state from anywhere (e.g., tool executor)
 * This allows non-React code to update the UI state
 */
export function setTerminalExecutionState(state: TerminalExecutionState) {
	if (globalSetState) {
		globalSetState(state);
	}
}
