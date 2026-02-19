import {exec, spawn} from 'child_process';
// Type definitions
import type {CommandExecutionResult} from './types/bash.types.js';
// Utility functions
import {
	isDangerousCommand,
	isSelfDestructiveCommand,
	truncateOutput,
} from './utils/bash/security.utils.js';
import {processManager} from '../utils/core/processManager.js';
import {
	appendTerminalOutput,
	setTerminalNeedsInput,
	registerInputCallback,
	flushOutputBuffer,
} from '../hooks/execution/useTerminalExecutionState.js';
import {logger} from '../utils/core/logger.js';
// SSH support
import {SSHClient, parseSSHUrl} from '../utils/ssh/sshClient.js';
import {
	getWorkingDirectories,
	type SSHConfig,
} from '../utils/config/workingDirConfig.js';
import {detectWindowsPowerShell} from '../prompt/shared/promptHelpers.js';

// Global flag to track if command should be moved to background
let shouldMoveToBackground = false;

/**
 * Mark command to be moved to background
 * Called from UI when Ctrl+B is pressed
 */
export function markCommandAsBackgrounded() {
	shouldMoveToBackground = true;
}

/**
 * Reset background flag
 */
export function resetBackgroundFlag() {
	shouldMoveToBackground = false;
}

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
	 * Check if the working directory is a remote SSH path
	 */
	private isSSHPath(dirPath: string): boolean {
		return dirPath.startsWith('ssh://');
	}

	/**
	 * Get SSH config for a remote path from working directories
	 */
	private async getSSHConfigForPath(sshUrl: string): Promise<SSHConfig | null> {
		const workingDirs = await getWorkingDirectories();
		for (const dir of workingDirs) {
			if (dir.isRemote && dir.sshConfig && sshUrl.startsWith(dir.path)) {
				return dir.sshConfig;
			}
		}
		// Try to match by host/user/port
		const parsed = parseSSHUrl(sshUrl);
		if (parsed) {
			for (const dir of workingDirs) {
				if (dir.isRemote && dir.sshConfig) {
					const dirParsed = parseSSHUrl(dir.path);
					if (
						dirParsed &&
						dirParsed.host === parsed.host &&
						dirParsed.username === parsed.username &&
						dirParsed.port === parsed.port
					) {
						return dir.sshConfig;
					}
				}
			}
		}
		return null;
	}

	/**
	 * Execute command on remote SSH server
	 */
	private async executeRemoteCommand(
		command: string,
		remotePath: string,
		sshConfig: SSHConfig,
		timeout: number,
		abortSignal?: AbortSignal,
	): Promise<{stdout: string; stderr: string; exitCode: number}> {
		const sshClient = new SSHClient();

		try {
			// Connect to SSH server
			const connectResult = await sshClient.connect(
				sshConfig,
				sshConfig.password,
			);

			if (!connectResult.success) {
				throw new Error(
					`SSH connection failed: ${connectResult.error || 'Unknown error'}`,
				);
			}

			// Wrap command with cd to remote path
			const fullCommand = `cd "${remotePath}" && ${command}`;

			// Send initial output to UI
			appendTerminalOutput(`[SSH] Executing on ${sshConfig.host}: ${command}`);

			// Execute command on remote server with timeout/abort support.
			const result = await sshClient.exec(fullCommand, {
				timeout,
				signal: abortSignal,
			});

			// Send output to UI
			if (result.stdout) {
				const lines = result.stdout.split('\n').filter(line => line.trim());
				lines.forEach(line => appendTerminalOutput(line));
			}
			if (result.stderr) {
				const lines = result.stderr.split('\n').filter(line => line.trim());
				lines.forEach(line => appendTerminalOutput(line));
			}

			return {
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.code,
			};
		} finally {
			sshClient.disconnect();
		}
	}

	/**
	 * Execute a terminal command in the working directory
	 * Supports both local and remote SSH directories
	 * @param command - The command to execute (e.g., "npm -v", "git status")
	 * @param timeout - Timeout in milliseconds (default: 30000ms = 30s)
	 * @param abortSignal - Optional AbortSignal to cancel command execution (e.g., ESC key)
	 * @returns Execution result including stdout, stderr, and exit code
	 * @throws Error if command execution fails critically
	 */
	async executeCommand(
		command: string,
		timeout: number = 30000,
		abortSignal?: AbortSignal,
		isInteractive: boolean = false,
	): Promise<CommandExecutionResult> {
		const executedAt = new Date().toISOString();

		try {
			// Security check: reject potentially dangerous commands
			if (isDangerousCommand(command)) {
				throw new Error(
					`Dangerous command detected and blocked: ${command.slice(0, 50)}`,
				);
			}

			// Self-protection: reject commands that would kill the CLI's own process
			const selfDestruct = isSelfDestructiveCommand(command);
			if (selfDestruct.isSelfDestructive) {
				throw new Error(
					`[SELF-PROTECTION] Command blocked: ${selfDestruct.reason}. ` +
						`${selfDestruct.suggestion}`,
				);
			}

			// Check if working directory is a remote SSH path
			if (this.isSSHPath(this.workingDirectory)) {
				const parsed = parseSSHUrl(this.workingDirectory);
				if (!parsed) {
					throw new Error(`Invalid SSH URL: ${this.workingDirectory}`);
				}

				const sshConfig = await this.getSSHConfigForPath(this.workingDirectory);
				if (!sshConfig) {
					throw new Error(
						`No SSH configuration found for: ${this.workingDirectory}. Please add this remote directory first.`,
					);
				}

				// Execute command on remote server
				const result = await this.executeRemoteCommand(
					command,
					parsed.path,
					sshConfig,
					timeout,
					abortSignal,
				);

				return {
					stdout: truncateOutput(result.stdout, this.maxOutputLength),
					stderr: truncateOutput(result.stderr, this.maxOutputLength),
					exitCode: result.exitCode,
					command,
					executedAt,
				};
			}

			// Local execution: Execute command using system default shell and register the process.
			// Using spawn (instead of exec) avoids relying on inherited stdio and is
			// more resilient in some terminals where `exec` can fail with `spawn EBADF`.
			const isWindows = process.platform === 'win32';

			// Detect shell type using the same logic as promptHelpers
			let shell: string;
			let shellArgs: string[];

			if (isWindows) {
				const psType = detectWindowsPowerShell();
				if (psType) {
					// Use PowerShell (pwsh for 7.x, powershell for 5.x)
					shell = psType === 'pwsh' ? 'pwsh' : 'powershell';
					const utf8WrappedCommand = `& { $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ${command} }`;
					shellArgs = ['-NoProfile', '-Command', utf8WrappedCommand];
				} else {
					// Fallback to cmd if not in PowerShell environment
					shell = 'cmd';
					const utf8Command = `chcp 65001>nul && ${command}`;
					shellArgs = ['/c', utf8Command];
				}
			} else {
				shell = 'sh';
				shellArgs = ['-c', command];
			}

			const childProcess = spawn(shell, shellArgs, {
				cwd: this.workingDirectory,
				stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin for interactive input
				windowsHide: true,
				env: {
					...process.env,
					...(process.platform !== 'win32' && {
						LANG: 'en_US.UTF-8',
						LC_ALL: 'en_US.UTF-8',
					}),
				},
			});

			// Register child process for cleanup
			processManager.register(childProcess);

			// Setup abort signal handler if provided
			let abortHandler: (() => void) | undefined;
			let killTimeout: NodeJS.Timeout | null = null;
			if (abortSignal) {
				abortHandler = () => {
					// CRITICAL: Set abort flag first to stop data processing immediately
					isAborted = true;

					// CRITICAL: Destroy stdout/stderr streams immediately to stop data flow
					// This is more aggressive than pause() - it clears the internal buffer
					// and ensures no more 'data' events will be emitted
					childProcess.stdout?.destroy();
					childProcess.stderr?.destroy();

					// Also pause as a safety measure
					childProcess.stdout?.pause();
					childProcess.stderr?.pause();

					if (childProcess.pid && !childProcess.killed) {
						// Kill the process immediately when abort signal is triggered
						try {
							if (process.platform === 'win32') {
								// Windows: Use taskkill to kill entire process tree
								exec(`taskkill /PID ${childProcess.pid} /T /F 2>NUL`, {
									windowsHide: true,
								});
							} else {
								// Unix: Send SIGTERM first, then SIGKILL immediately as fallback
								// For commands like 'find' that produce massive output,
								// we need immediate termination
								childProcess.kill('SIGTERM');

								// Force SIGKILL after a very short delay (100ms) to ensure termination
								// This is necessary because SIGTERM may be ignored or delayed
								killTimeout = setTimeout(() => {
									if (!childProcess.killed) {
										try {
											childProcess.kill('SIGKILL');
										} catch {
											// Ignore errors
										}
									}
								}, 100);
							}
						} catch {
							// Ignore errors if process already dead
						}
					}
				};
				abortSignal.addEventListener('abort', abortHandler);
			}

			// Register input callback for interactive commands
			const inputHandler = (input: string) => {
				if (childProcess.stdin && !childProcess.stdin.destroyed) {
					childProcess.stdin.write(input + '\n');
					// Clear the input prompt after sending input
					setTerminalNeedsInput(false);
				}
			};
			registerInputCallback(inputHandler);

			// CRITICAL: Flag to prevent data processing after abort
			// Must be defined outside Promise so abortHandler can access it
			let isAborted = false;

			// Convert to promise
			const {stdout, stderr} = await new Promise<{
				stdout: string;
				stderr: string;
			}>((resolve, reject) => {
				let timeoutTimer: NodeJS.Timeout | null = null;
				let timedOut = false;

				const safeClearTimeout = () => {
					if (timeoutTimer) {
						clearTimeout(timeoutTimer);
						timeoutTimer = null;
					}
				};

				const triggerTimeout = () => {
					if (timedOut) return;
					timedOut = true;
					safeClearTimeout();

					// Kill the underlying process tree so we don't keep waiting on streams.
					if (childProcess.pid && !childProcess.killed) {
						try {
							if (process.platform === 'win32') {
								exec(`taskkill /PID ${childProcess.pid} /T /F 2>NUL`, {
									windowsHide: true,
								});
							} else {
								childProcess.kill('SIGTERM');
							}
						} catch {
							// Ignore.
						}
					}

					const timeoutError: any = new Error(
						`Command timed out after ${timeout}ms: ${command}`,
					);
					timeoutError.code = 'ETIMEDOUT';
					reject(timeoutError);
				};

				if (typeof timeout === 'number' && timeout > 0) {
					timeoutTimer = setTimeout(triggerTimeout, timeout);
				}
				if (abortSignal) {
					abortSignal.addEventListener('abort', () => {
						safeClearTimeout();
					});
				}
				let stdoutData = '';
				let stderrData = '';
				let backgroundProcessId: string | null = null;
				let lastOutputTime = Date.now();
				let inputCheckInterval: NodeJS.Timeout | null = null;
				let inputPromptTriggered = false;
				// Note: isAborted is defined outside Promise so abortHandler can access it

				// Patterns that indicate the command is waiting for input (from output)
				const inputPromptPatterns = [
					/password[:\s]*$/i,
					/\[y\/n\][:\s]*$/i,
					/\[yes\/no\][:\s]*$/i,
					/\(y\/n\)[:\s]*$/i,
					/\(yes\/no\)[:\s]*$/i,
					/continue\?[:\s]*$/i,
					/proceed\?[:\s]*$/i,
					/confirm[:\s]*$/i,
					/enter[:\s]*$/i,
					/input[:\s]*$/i,
					/passphrase[:\s]*$/i,
					/username[:\s]*$/i,
					/login[:\s]*$/i,
					/\?[:\s]*$/,
					/:\s*$/,
				];

				// Check if output indicates waiting for input
				const checkForInputPrompt = (output: string) => {
					const lastLine = output.split('\n').pop()?.trim() || '';
					for (const pattern of inputPromptPatterns) {
						if (pattern.test(lastLine)) {
							return lastLine;
						}
					}
					return null;
				};

				// Add to background processes if PID available
				if (childProcess.pid) {
					import('../hooks/execution/useBackgroundProcesses.js')
						.then(({addBackgroundProcess}) => {
							backgroundProcessId = addBackgroundProcess(
								command,
								childProcess.pid!,
							);
						})
						.catch(() => {
							// Ignore error if module not available
						});
				}

				// Check for input prompt periodically when output stops
				inputCheckInterval = setInterval(() => {
					const timeSinceLastOutput = Date.now() - lastOutputTime;

					// If AI marked this command as interactive, trigger input prompt after 500ms
					if (
						isInteractive &&
						!inputPromptTriggered &&
						timeSinceLastOutput > 500
					) {
						inputPromptTriggered = true;
						setTerminalNeedsInput(true, 'Waiting for input...');
						return;
					}

					// If no output for 500ms and we have some output, check for input prompt
					if (timeSinceLastOutput > 500 && (stdoutData || stderrData)) {
						const combinedOutput = stdoutData + stderrData;
						const prompt = checkForInputPrompt(combinedOutput);
						if (prompt && !inputPromptTriggered) {
							inputPromptTriggered = true;
							setTerminalNeedsInput(true, prompt);
						}
					}
				}, 200);

				// Check background flag periodically
				const backgroundCheckInterval = setInterval(() => {
					if (shouldMoveToBackground) {
						safeClearTimeout();
						clearInterval(backgroundCheckInterval);
						if (inputCheckInterval) clearInterval(inputCheckInterval);

						resetBackgroundFlag();
						// Resolve immediately with partial output
						resolve({
							stdout:
								stdoutData +
								'\n[Command moved to background, execution continues...]',
							stderr: stderrData,
						});
					}
				}, 100);
				childProcess.stdout?.on('data', chunk => {
					// CRITICAL: Skip processing if aborted to prevent event loop blocking
					if (isAborted) return;

					stdoutData += chunk;
					lastOutputTime = Date.now();

					// Clear input prompt when new output arrives
					setTerminalNeedsInput(false);
					// Send real-time output to UI
					const lines = String(chunk)
						.split('\n')
						.filter(line => line.trim());
					lines.forEach(line => appendTerminalOutput(line));
				});
				childProcess.stderr?.on('data', chunk => {
					// CRITICAL: Skip processing if aborted to prevent event loop blocking
					if (isAborted) return;

					stderrData += chunk;
					lastOutputTime = Date.now();

					// Clear input prompt when new output arrives
					setTerminalNeedsInput(false);
					// Send real-time output to UI
					const lines = String(chunk)
						.split('\n')
						.filter(line => line.trim());
					lines.forEach(line => appendTerminalOutput(line));
				});

				childProcess.on('error', error => {
					safeClearTimeout();
					clearInterval(backgroundCheckInterval);
					if (inputCheckInterval) clearInterval(inputCheckInterval);
					registerInputCallback(null);
					setTerminalNeedsInput(false);

					// Enhanced error logging for debugging spawn failures
					const errnoError = error as NodeJS.ErrnoException;
					logger.error('Spawn process failed', {
						command,
						errorMessage: error.message,
						errorCode: errnoError.code,
						errno: errnoError.errno,
						syscall: errnoError.syscall,
						cwd: this.workingDirectory,
					});

					// Update process status
					if (backgroundProcessId) {
						import('../hooks/execution/useBackgroundProcesses.js')
							.then(({updateBackgroundProcessStatus}) => {
								updateBackgroundProcessStatus(
									backgroundProcessId!,
									'failed',
									1,
								);
							})
							.catch(() => {});
					}
					reject(error);
				});

				childProcess.on('close', (code, signal) => {
					safeClearTimeout();
					// Clean up kill timeout to prevent memory leaks
					if (killTimeout) {
						clearTimeout(killTimeout);
						killTimeout = null;
					}
					clearInterval(backgroundCheckInterval);
					if (inputCheckInterval) clearInterval(inputCheckInterval);
					registerInputCallback(null);
					setTerminalNeedsInput(false);

					// PERFORMANCE: Flush any remaining buffered output before command ends
					flushOutputBuffer();

					// Update process status
					if (backgroundProcessId) {
						const status = code === 0 ? 'completed' : 'failed';
						import('../hooks/execution/useBackgroundProcesses.js')
							.then(({updateBackgroundProcessStatus}) => {
								updateBackgroundProcessStatus(
									backgroundProcessId!,
									status,
									code || undefined,
								);
							})
							.catch(() => {});
					}

					// Clean up abort handler
					if (abortHandler && abortSignal) {
						abortSignal.removeEventListener('abort', abortHandler);
					}

					if (signal) {
						// Process was killed by signal (e.g., timeout, manual kill, ESC key)
						// CRITICAL: Still preserve stdout/stderr for debugging
						const error: any = new Error(`Process killed by signal ${signal}`);
						if (timedOut) {
							error.code = 'ETIMEDOUT';
						} else {
							error.code = code || 1;
						}
						error.stdout = stdoutData;
						error.stderr = stderrData;
						error.signal = signal;
						reject(error);
					} else if (code === 0) {
						resolve({stdout: stdoutData, stderr: stderrData});
					} else {
						const error: any = new Error(`Process exited with code ${code}`);
						error.code = code;
						error.stdout = stdoutData;
						error.stderr = stderrData;
						reject(error);
					}
				});
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

			// Check if aborted by user (ESC key)
			if (abortSignal?.aborted) {
				return {
					stdout: truncateOutput(error.stdout || '', this.maxOutputLength),
					stderr: truncateOutput(
						error.stderr ||
							'Command execution interrupted by user (ESC key pressed)',
						this.maxOutputLength,
					),
					exitCode: 130, // Standard exit code for SIGINT/user interrupt
					command,
					executedAt,
				};
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
			'Execute terminal commands like npm, git, build scripts, etc. **REMOTE SSH SUPPORT**: When workingDirectory is a remote SSH path (ssh://...), commands are automatically executed on the remote server via SSH - DO NOT wrap commands with "ssh user@host" yourself, just provide the raw command (e.g., "cat /etc/os-release" instead of "ssh root@host cat /etc/os-release"). BEST PRACTICE: For file modifications, prefer filesystem-edit/filesystem-create tools first. Primary use cases: (1) Running build/test/lint scripts, (2) Version control operations, (3) Package management, (4) System utilities.',
		inputSchema: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description:
						'Terminal command to execute directly. For remote SSH working directories, provide raw commands without ssh wrapper - the system handles SSH connection automatically.',
				},
				workingDirectory: {
					type: 'string',
					description:
						'REQUIRED: Working directory where the command should be executed. Can be a local path (e.g., "D:/projects/myapp") or a remote SSH path (e.g., "ssh://user@host:port/path"). For remote paths, the command will be executed on the remote server via SSH.',
				},
				timeout: {
					type: 'number',
					description: 'Timeout in milliseconds (default: 30000)',
					default: 30000,
					maximum: 300000,
				},
				isInteractive: {
					type: 'boolean',
					description:
						'Set to true if the command requires user input (e.g., Read-Host, password prompts, y/n confirmations, interactive installers). When true, an input prompt will be shown to allow user to provide input. Default: false.',
					default: false,
				},
			},
			required: ['command', 'workingDirectory'],
		},
	},
];
