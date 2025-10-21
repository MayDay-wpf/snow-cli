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
}
