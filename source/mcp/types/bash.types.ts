/**
 * Type definitions for Terminal Command Service
 */

/**
 * Result of command execution
 */
export interface CommandExecutionResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	command: string;
	executedAt: string;
	/**
	 * Optional AI-provided explanation of what the command does.
	 * Echoed back in the result so the UI (tool result preview) can show it.
	 */
	explanation?: string;
}
