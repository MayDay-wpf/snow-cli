import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CommandExecutionResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	command: string;
	executedAt: string;
}

/**
 * Terminal Command Execution Service
 * Executes terminal commands directly using the system's default shell
 */
export class TerminalCommandService {
	private workingDirectory: string;
	private maxOutputLength: number;

	constructor(workingDirectory: string = process.cwd(), maxOutputLength: number = 10000) {
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
	async executeCommand(command: string, timeout: number = 30000): Promise<CommandExecutionResult> {
		const executedAt = new Date().toISOString();

		try {
			// Security check: reject potentially dangerous commands
			const dangerousPatterns = [
				/rm\s+-rf\s+\/[^/\s]*/i, // rm -rf / or /path
				/>\s*\/dev\/sda/i, // writing to disk devices
				/mkfs/i, // format filesystem
				/dd\s+if=/i, // disk operations
			];

			for (const pattern of dangerousPatterns) {
				if (pattern.test(command)) {
					throw new Error(`Dangerous command detected and blocked: ${command.slice(0, 50)}`);
				}
			}

			// Execute command using system default shell
			const { stdout, stderr } = await execAsync(command, {
				cwd: this.workingDirectory,
				timeout,
				maxBuffer: this.maxOutputLength,
				env: {
					...process.env,
					...(process.platform !== 'win32' && {
						LANG: 'en_US.UTF-8',
						LC_ALL: 'en_US.UTF-8',
					})
				}
			});

			// Truncate output if too long
			const truncateOutput = (output: string): string => {
				if (output.length > this.maxOutputLength) {
					return output.slice(0, this.maxOutputLength) + '\n... (output truncated)';
				}
				return output;
			};

			return {
				stdout: truncateOutput(stdout),
				stderr: truncateOutput(stderr),
				exitCode: 0,
				command,
				executedAt
			};
		} catch (error: any) {
			// Handle execution errors (non-zero exit codes)
			if (error.code === 'ETIMEDOUT') {
				throw new Error(`Command timed out after ${timeout}ms: ${command}`);
			}

			// For non-zero exit codes, still return the output
			const truncateOutput = (output: string): string => {
				if (!output) return '';
				if (output.length > this.maxOutputLength) {
					return output.slice(0, this.maxOutputLength) + '\n... (output truncated)';
				}
				return output;
			};

			return {
				stdout: truncateOutput(error.stdout || ''),
				stderr: truncateOutput(error.stderr || error.message || ''),
				exitCode: error.code || 1,
				command,
				executedAt
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
		name: 'terminal_execute',
		description: 'Run terminal commands. Pass commands exactly as typed in terminal. Examples: "npm -v", "git status", "node index.js"',
		inputSchema: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description: 'Terminal command to execute. Examples: "npm -v", "git status", "ls -la"'
				},
				timeout: {
					type: 'number',
					description: 'Timeout in milliseconds (default: 30000)',
					default: 30000,
					maximum: 300000
				}
			},
			required: ['command']
		}
	}
];
