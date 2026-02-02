import {useState, useCallback} from 'react';

export interface TerminalExecutionState {
	isExecuting: boolean;
	command: string | null;
	timeout: number | null;
	isBackgrounded: boolean;
	output: string[];
	/** Whether the command is waiting for user input (interactive mode) */
	needsInput: boolean;
	/** Prompt text shown when waiting for input (e.g., "Password:", "[Y/n]") */
	inputPrompt: string | null;
}

// Global state for terminal execution (shared across components)
let globalSetState: ((state: TerminalExecutionState) => void) | null = null;
let globalState: TerminalExecutionState | null = null;

/**
 * Hook to manage terminal execution state
 * Used by ChatScreen to display execution status
 */
export function useTerminalExecutionState() {
	const [state, setState] = useState<TerminalExecutionState>({
		isExecuting: false,
		command: null,
		timeout: null,
		isBackgrounded: false,
		output: [],
		needsInput: false,
		inputPrompt: null,
	});

	// Always update global setter to ensure it's current
	// This prevents race conditions where setState might be stale or null
	globalSetState = setState;
	globalState = state;

	const startExecution = useCallback((command: string, timeout: number) => {
		setState({
			isExecuting: true,
			command,
			timeout,
			isBackgrounded: false,
			output: [],
			needsInput: false,
			inputPrompt: null,
		});
	}, []);

	const endExecution = useCallback(() => {
		// Flush any remaining buffered output before ending execution
		flushOutputBuffer();

		setState({
			isExecuting: false,
			command: null,
			timeout: null,
			isBackgrounded: false,
			output: [],
			needsInput: false,
			inputPrompt: null,
		});
	}, []);

	const moveToBackground = useCallback(() => {
		setState(prev => ({
			...prev,
			isBackgrounded: true,
		}));
	}, []);

	return {
		state,
		startExecution,
		endExecution,
		moveToBackground,
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

// Batch buffer for output lines to reduce state updates
let outputBuffer: string[] = [];
let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
const OUTPUT_BATCH_SIZE = 10; // Flush every 10 lines
const OUTPUT_FLUSH_DELAY = 50; // Or flush after 50ms of inactivity

/**
 * Flush buffered output lines to state
 * Exported to allow manual flushing when needed (e.g., before command ends)
 */
export function flushOutputBuffer() {
	if (outputFlushTimer) {
		clearTimeout(outputFlushTimer);
		outputFlushTimer = null;
	}

	if (outputBuffer.length === 0 || !globalSetState || !globalState) {
		return;
	}

	const linesToFlush = outputBuffer.splice(0, outputBuffer.length);
	globalSetState({
		...globalState,
		output: [...globalState.output, ...linesToFlush],
	});
}

/**
 * Append output line to terminal execution state
 * Called from bash.ts during command execution
 * PERFORMANCE: Batches multiple lines to reduce state updates
 */
export function appendTerminalOutput(line: string) {
	if (!globalSetState || !globalState) {
		return;
	}

	outputBuffer.push(line);

	// Flush immediately if buffer is full
	if (outputBuffer.length >= OUTPUT_BATCH_SIZE) {
		flushOutputBuffer();
		return;
	}

	// Otherwise, debounce flush
	if (outputFlushTimer) {
		clearTimeout(outputFlushTimer);
	}
	outputFlushTimer = setTimeout(flushOutputBuffer, OUTPUT_FLUSH_DELAY);
}

/**
 * Set terminal input needed state
 * Called from bash.ts when interactive input is detected
 */
export function setTerminalNeedsInput(needsInput: boolean, prompt?: string) {
	if (globalSetState && globalState) {
		globalSetState({
			...globalState,
			needsInput,
			inputPrompt: prompt || null,
		});
	}
}

// Global callback for sending input to the running process
let globalInputCallback: ((input: string) => void) | null = null;

/**
 * Register a callback to receive user input
 * Called from bash.ts to set up input handling
 */
export function registerInputCallback(
	callback: ((input: string) => void) | null,
) {
	globalInputCallback = callback;
}

/**
 * Send user input to the running process
 * Called from UI when user submits input
 */
export function sendTerminalInput(input: string) {
	if (globalInputCallback) {
		globalInputCallback(input);
	}
}
