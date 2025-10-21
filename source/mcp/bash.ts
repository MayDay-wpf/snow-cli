import {exec} from 'child_process';
import {promisify} from 'util';
// Type definitions
import type {CommandExecutionResult} from './types/bash.types.js';
// Utility functions
import {
	isDangerousCommand,
	truncateOutput,
} from './utils/bash/security.utils.js';

const execAsync = promisify(exec);

/**
 * Terminal Command Execution Service
 * Executes terminal commands directly using the system's default shell
 */
export class TerminalCommandService {
	private workingDirectory: string;
	private maxOutputLength: number;

	constructor(
		workingDirectory: string = process.cwd(),
		maxOutputLength: number = 10000,
	) {
		this.workingDirectory = workingDirectory;
		this.maxOutputLength = maxOutputLength;
	}

	/**
	 * Execute a terminal command in the working directory
	 * @param command - The command to execute (e.g., "npm -v", "git status")
	 * @param timeout - Timeout in milliseconds (default: 30000ms = 30s)
	 * @returns Execution result including stdout, stderr, and exit code
	 * @throws Error if command execution fails critically
	 */
	async executeCommand(
		command: string,
		timeout: number = 30000,
	): Promise<CommandExecutionResult> {
		const executedAt = new Date().toISOString();

		try {
			// Security check: reject potentially dangerous commands
			if (isDangerousCommand(command)) {
				throw new Error(
					`Dangerous command detected and blocked: ${command.slice(0, 50)}`,
				);
			}

			// Execute command using system default shell
			const {stdout, stderr} = await execAsync(command, {
				cwd: this.workingDirectory,
				timeout,
				maxBuffer: this.maxOutputLength,
				env: {
					...process.env,
					...(process.platform !== 'win32' && {
						LANG: 'en_US.UTF-8',
						LC_ALL: 'en_US.UTF-8',
					}),
				},
			});

			// Truncate output if too long
			return {
				stdout: truncateOutput(stdout, this.maxOutputLength),
				stderr: truncateOutput(stderr, this.maxOutputLength),
				exitCode: 0,
				command,
				executedAt,
			};
		} catch (error: any) {
			// Handle execution errors (non-zero exit codes)
			if (error.code === 'ETIMEDOUT') {
				throw new Error(`Command timed out after ${timeout}ms: ${command}`);
			}

			// For non-zero exit codes, still return the output
			return {
				stdout: truncateOutput(error.stdout || '', this.maxOutputLength),
				stderr: truncateOutput(
					error.stderr || error.message || '',
					this.maxOutputLength,
				),
				exitCode: error.code || 1,
				command,
				executedAt,
			};
		}
	}

	/**
	 * Get current working directory
	 * @returns Current working directory path
	 */
	getWorkingDirectory(): string {
		return this.workingDirectory;
	}

	/**
	 * Change working directory for future commands
	 * @param newPath - New working directory path
	 * @throws Error if path doesn't exist or is not a directory
	 */
	setWorkingDirectory(newPath: string): void {
		this.workingDirectory = newPath;
	}
}

// Export a default instance
export const terminalService = new TerminalCommandService();

// MCP Tool definitions
export const mcpTools = [
	{
		name: 'terminal-execute',
		description:
			'Execute terminal commands like npm, git, build scripts, etc. BEST PRACTICE: For file modifications, prefer filesystem-edit/filesystem-create tools first - they are more reliable and provide better error handling. Terminal commands (sed, awk, echo >file, cat <<EOF) can be used for file editing, but only as a fallback option when filesystem tools are not suitable. Primary use cases: (1) Running build/test/lint scripts, (2) Version control operations, (3) Package management, (4) System utilities, (5) Fallback file editing when needed.',
		inputSchema: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description:
						'Terminal command to execute. For file editing, filesystem tools are generally preferred.',
				},
				timeout: {
					type: 'number',
					description: 'Timeout in milliseconds (default: 30000)',
					default: 30000,
					maximum: 300000,
				},
			},
			required: ['command'],
		},
	},
];
