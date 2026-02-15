import {useState, useCallback} from 'react';
import {isSensitiveCommand} from '../../utils/execution/sensitiveCommandManager.js';

export interface BashCommand {
	id: string;
	command: string;
	startIndex: number;
	endIndex: number;
	timeout?: number; // 超时时间（毫秒），默认30000
}

export interface CommandExecutionResult {
	success: boolean;
	stdout: string;
	stderr: string;
	command: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
}

export interface BashModeState {
	isExecuting: boolean;
	currentCommand: string | null;
	currentTimeout: number | null; // 当前命令的超时时间
	output: string[]; // 实时输出行
	executionResults: Map<string, CommandExecutionResult>;
}

export function useBashMode() {
	const [state, setState] = useState<BashModeState>({
		isExecuting: false,
		currentCommand: null,
		currentTimeout: null,
		output: [],
		executionResults: new Map(),
	});

	/**
	 * 解析用户消息中的命令注入模式命令
	 * 格式：!`command` 或 !`command`<timeout>
	 * timeout 单位：毫秒，可选，默认30000
	 * 严格语法：感叹号和反引号必须全部存在
	 */
	const parseBashCommands = useCallback((message: string): BashCommand[] => {
		const commands: BashCommand[] = [];
		// 匹配 !`...`<timeout> 或 !`...` 格式（命令注入模式）
		const regex = /!`([^`]+)`(?:<(\d+)>)?/g;
		let match;

		while ((match = regex.exec(message)) !== null) {
			const command = match[1]?.trim();
			const timeoutStr = match[2];
			const timeout = timeoutStr ? parseInt(timeoutStr, 10) : 30000;

			if (command) {
				commands.push({
					id: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
					command,
					startIndex: match.index,
					endIndex: match.index + match[0].length,
					timeout,
				});
			}
		}

		return commands;
	}, []);

	/**
	 * 解析用户消息中的 Bash 模式命令
	 * 格式：!!`command` 或 !!`command`<timeout>
	 * timeout 单位：毫秒，可选，默认30000
	 * 严格语法：双感叹号和反引号必须全部存在
	 */
	const parsePureBashCommands = useCallback(
		(message: string): BashCommand[] => {
			const commands: BashCommand[] = [];
			// 匹配 !!`...`<timeout> 或 !!`...` 格式（纯 Bash 模式）
			const regex = /!!`([^`]+)`(?:<(\d+)>)?/g;
			let match;

			while ((match = regex.exec(message)) !== null) {
				const command = match[1]?.trim();
				const timeoutStr = match[2];
				const timeout = timeoutStr ? parseInt(timeoutStr, 10) : 30000;

				if (command) {
					commands.push({
						id: `cmd-${Date.now()}-${Math.random()
							.toString(36)
							.substring(2, 9)}`,
						command,
						startIndex: match.index,
						endIndex: match.index + match[0].length,
						timeout,
					});
				}
			}

			return commands;
		},
		[],
	);

	/**
	 * 检查命令是否为敏感命令
	 */
	const checkSensitiveCommand = useCallback((command: string) => {
		return isSensitiveCommand(command);
	}, []);

	/**
	 * 执行单个命令
	 */
	const executeCommand = useCallback(
		async (
			command: string,
			timeout: number = 30000,
		): Promise<CommandExecutionResult> => {
			setState(prev => ({
				...prev,
				isExecuting: true,
				currentCommand: command,
				currentTimeout: timeout,
				output: [],
			}));

			return new Promise(resolve => {
				const {spawn} = require('child_process');
				const isWindows = process.platform === 'win32';

				// Windows 默认优先使用 PowerShell（pwsh/powershell），避免 cmd.exe 的 codepage 导致中文乱码。
				// 如果 PowerShell 不可用，则回退到 cmd /c，并尽量切到 UTF-8 codepage。
				const shellCandidates: Array<{
					shell: string;
					args: string[];
					decode: (buf: Buffer) => string;
				}> = isWindows
					? [
							{
								shell: 'pwsh',
								args: [
									'-NoProfile',
									'-NonInteractive',
									'-ExecutionPolicy',
									'Bypass',
									'-Command',
									[
										// 通过环境变量传递命令，避免包含空格时参数绑定/转义导致被截断。
										'$cmd = $env:SNOW_CLI_BASH_COMMAND',
										'if ([string]::IsNullOrWhiteSpace($cmd)) { throw "Missing SNOW_CLI_BASH_COMMAND" }',
										'try {',
										'  $utf8 = [System.Text.UTF8Encoding]::new()',
										'  [Console]::OutputEncoding = $utf8',
										'  $OutputEncoding = $utf8',
										'} catch {}',
										'Invoke-Expression $cmd',
									].join('\n'),
								],
								decode: (buf: Buffer) => buf.toString('utf8'),
							},
							{
								shell: 'powershell',
								args: [
									'-NoProfile',
									'-NonInteractive',
									'-ExecutionPolicy',
									'Bypass',
									'-Command',
									[
										// 通过环境变量传递命令，避免包含空格时参数绑定/转义导致被截断。
										'$cmd = $env:SNOW_CLI_BASH_COMMAND',
										'if ([string]::IsNullOrWhiteSpace($cmd)) { throw "Missing SNOW_CLI_BASH_COMMAND" }',
										'try {',
										'  $utf8 = [System.Text.UTF8Encoding]::new()',
										'  [Console]::OutputEncoding = $utf8',
										'  $OutputEncoding = $utf8',
										'} catch {}',
										'Invoke-Expression $cmd',
									].join('\n'),
								],
								decode: (buf: Buffer) => buf.toString('utf8'),
							},
							{
								shell: 'cmd',
								args: ['/d', '/s', '/c', `chcp 65001 >NUL & ${command}`],
								decode: (buf: Buffer) => {
									// cmd.exe 的默认输出通常是 CP936/GBK；这里尽力用 GB18030 解码，避免中文乱码。
									try {
										const {TextDecoder} = require('util');
										const decoder = new TextDecoder('gb18030');
										return decoder.decode(buf);
									} catch {
										return buf.toString('utf8');
									}
								},
							},
					  ]
					: [
							{
								shell: 'sh',
								args: ['-c', command],
								decode: (buf: Buffer) => buf.toString('utf8'),
							},
					  ];

				const spawnWithFallback = (index: number) => {
					const selected = shellCandidates[index];
					if (!selected) {
						resolve({
							success: false,
							stdout: '',
							stderr: isWindows
								? 'No available shell found (tried pwsh, powershell, cmd)'
								: 'No available shell found',
							command,
							exitCode: null,
							signal: null,
						});
						return;
					}

					const child = spawn(selected.shell, selected.args, {
						cwd: process.cwd(),
						env: {
							...process.env,
							SNOW_CLI_BASH_COMMAND: command,
						},
						windowsHide: true,
					});

					let stdout = '';
					let stderr = '';
					let settled = false;
					let timeoutTimer: NodeJS.Timeout | null = null;

					const safeCleanup = () => {
						if (timeoutTimer) {
							clearTimeout(timeoutTimer);
							timeoutTimer = null;
						}
					};

					const safeResolve = (result: CommandExecutionResult) => {
						if (settled) return;
						settled = true;
						safeCleanup();

						setState(prev => {
							const newResults = new Map(prev.executionResults);
							newResults.set(command, result);
							return {
								...prev,
								isExecuting: false,
								currentCommand: null,
								currentTimeout: null,
								output: [],
								executionResults: newResults,
							};
						});

						resolve(result);
					};

					const killProcessTree = () => {
						if (!child.pid || child.killed) return;
						try {
							if (process.platform === 'win32') {
								// /T: kill child processes; /F: force
								const {exec} = require('child_process');
								exec(`taskkill /PID ${child.pid} /T /F 2>NUL`, {
									windowsHide: true,
								});
							} else {
								child.kill('SIGTERM');
							}
						} catch {
							// Ignore.
						}
					};

					const triggerTimeout = () => {
						// 超时后：杀进程树 + 返回一个失败结果，避免 UI 一直卡在 isExecuting=true。
						killProcessTree();
						safeResolve({
							success: false,
							stdout: stdout.trim(),
							stderr: `Command timed out after ${timeout}ms: ${command}`,
							command,
							exitCode: null,
							signal: 'SIGTERM',
						});
					};

					if (typeof timeout === 'number' && timeout > 0) {
						timeoutTimer = setTimeout(triggerTimeout, timeout);
					}

					// PERFORMANCE: Batch output lines to avoid excessive setState calls
					// When commands produce output extremely fast (e.g. recursive dir listing),
					// unbatched setState per data event can trigger "Maximum update depth exceeded".
					const outputBuffer: string[] = [];
					let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
					const OUTPUT_BATCH_SIZE = 15; // Flush every 15 lines
					const OUTPUT_FLUSH_DELAY = 80; // Or flush after 80ms of inactivity

					const flushOutputBuffer = () => {
						if (outputFlushTimer) {
							clearTimeout(outputFlushTimer);
							outputFlushTimer = null;
						}
						if (outputBuffer.length === 0) return;
						const linesToFlush = outputBuffer.splice(0, outputBuffer.length);
						setState(prev => ({
							...prev,
							output: [...prev.output, ...linesToFlush],
						}));
					};

					const appendOutputLines = (lines: string[]) => {
						outputBuffer.push(...lines);
						if (outputBuffer.length >= OUTPUT_BATCH_SIZE) {
							flushOutputBuffer();
							return;
						}
						if (outputFlushTimer) {
							clearTimeout(outputFlushTimer);
						}
						outputFlushTimer = setTimeout(flushOutputBuffer, OUTPUT_FLUSH_DELAY);
					};

					child.stdout?.on('data', (data: Buffer) => {
						const text = selected.decode(data);
						stdout += text;
						// 实时更新输出到 UI（批处理）
						const lines = text
							.split('\n')
							.map((line: string) => line.replace(/\r$/, ''))
							.filter((line: string) => line.trim());
						if (lines.length > 0) {
							appendOutputLines(lines);
						}
					});

					child.stderr?.on('data', (data: Buffer) => {
						const text = selected.decode(data);
						stderr += text;
						// 实时更新输出到 UI（批处理）
						const lines = text
							.split('\n')
							.map((line: string) => line.replace(/\r$/, ''))
							.filter((line: string) => line.trim());
						if (lines.length > 0) {
							appendOutputLines(lines);
						}
					});

					child.on(
						'close',
						(code: number | null, signal: NodeJS.Signals | null) => {
							// Flush any remaining buffered output before resolving
							flushOutputBuffer();
							// 正常退出：返回真实 code/signal
							safeResolve({
								success: code === 0,
								stdout: stdout.trim(),
								stderr: stderr.trim(),
								command,
								exitCode: code,
								signal,
							});
						},
					);

					child.on('error', (error: any) => {
						// 常见：Windows 没安装 pwsh 时会触发 ENOENT，这里自动回退。
						if (
							isWindows &&
							error &&
							(error.code === 'ENOENT' ||
								String(error.message || '').includes('ENOENT'))
						) {
							spawnWithFallback(index + 1);
							return;
						}

						safeResolve({
							success: false,
							stdout: '',
							stderr: error?.message || 'Command execution failed',
							command,
							exitCode: null,
							signal: null,
						});
					});
				};

				spawnWithFallback(0);
			});
		},
		[],
	);

	/**
	 * 处理用户消息，解析并执行命令注入模式命令，返回替换后的消息
	 */
	const processBashMessage = useCallback(
		async (
			message: string,
			onSensitiveCommand?: (command: string) => Promise<boolean>,
		): Promise<{
			processedMessage: string;
			hasCommands: boolean;
			hasRejectedCommands: boolean; // 是否有命令被用户拒绝
			results: CommandExecutionResult[];
		}> => {
			const commands = parseBashCommands(message);

			if (commands.length === 0) {
				return {
					processedMessage: message,
					hasCommands: false,
					hasRejectedCommands: false,
					results: [],
				};
			}

			const results: CommandExecutionResult[] = [];
			let processedMessage = message;
			let offset = 0; // 跟踪替换导致的位置偏移
			let hasRejectedCommands = false;

			// 按顺序执行所有命令
			for (const cmd of commands) {
				// 检查敏感命令
				const sensitiveCheck = checkSensitiveCommand(cmd.command);
				if (sensitiveCheck.isSensitive && onSensitiveCommand) {
					const shouldContinue = await onSensitiveCommand(cmd.command);
					if (!shouldContinue) {
						// 用户拒绝执行，标记并跳过
						hasRejectedCommands = true;
						continue;
					}
				}

				// 执行命令
				const result = await executeCommand(cmd.command, cmd.timeout || 30000);
				results.push(result);

				// 构建替换文本
				const output = result.success
					? result.stdout || '(no output)'
					: (() => {
							const lines: string[] = [];

							lines.push('Command execution failed.');

							if (typeof result.exitCode === 'number') {
								lines.push(`Exit code: ${result.exitCode}`);
							} else {
								lines.push('Exit code: (unknown)');
							}

							if (result.signal) {
								lines.push(`Signal: ${result.signal}`);
							}

							lines.push('');
							lines.push('STDOUT:');
							lines.push(result.stdout || '(empty)');
							lines.push('');
							lines.push('STDERR:');
							lines.push(result.stderr || '(empty)');

							return lines.join('\n');
					  })();

				const replacement = `\n--- Command: ${cmd.command} ---\n${output}\n--- End of output ---\n`;

				// 替换原始命令位置
				const adjustedStart = cmd.startIndex + offset;
				const adjustedEnd = cmd.endIndex + offset;

				processedMessage =
					processedMessage.slice(0, adjustedStart) +
					replacement +
					processedMessage.slice(adjustedEnd);

				// 更新偏移量
				offset += replacement.length - (cmd.endIndex - cmd.startIndex);
			}

			return {
				processedMessage,
				hasCommands: true,
				hasRejectedCommands,
				results,
			};
		},
		[parseBashCommands, checkSensitiveCommand, executeCommand],
	);

	/**
	 * 处理纯 Bash 模式消息，执行命令但不发送给 AI
	 */
	const processPureBashMessage = useCallback(
		async (
			message: string,
			onSensitiveCommand?: (command: string) => Promise<boolean>,
		): Promise<{
			shouldSendToAI: boolean; // 是否应该发送给 AI
			hasCommands: boolean;
			hasRejectedCommands: boolean;
			results: CommandExecutionResult[];
		}> => {
			const commands = parsePureBashCommands(message);

			if (commands.length === 0) {
				return {
					shouldSendToAI: true,
					hasCommands: false,
					hasRejectedCommands: false,
					results: [],
				};
			}

			const results: CommandExecutionResult[] = [];
			let hasRejectedCommands = false;

			// 按顺序执行所有命令
			for (const cmd of commands) {
				// 检查敏感命令
				const sensitiveCheck = checkSensitiveCommand(cmd.command);
				if (sensitiveCheck.isSensitive && onSensitiveCommand) {
					const shouldContinue = await onSensitiveCommand(cmd.command);
					if (!shouldContinue) {
						// 用户拒绝执行，标记并跳过
						hasRejectedCommands = true;
						continue;
					}
				}

				// 执行命令
				const result = await executeCommand(cmd.command, cmd.timeout || 30000);
				results.push(result);
			}

			return {
				shouldSendToAI: false, // 纯 Bash 模式不发送给 AI
				hasCommands: true,
				hasRejectedCommands,
				results,
			};
		},
		[parsePureBashCommands, checkSensitiveCommand, executeCommand],
	);

	/**
	 * 重置状态
	 */
	const resetState = useCallback(() => {
		setState({
			isExecuting: false,
			currentCommand: null,
			currentTimeout: null,
			output: [],
			executionResults: new Map(),
		});
	}, []);

	return {
		state,
		parseBashCommands,
		parsePureBashCommands,
		checkSensitiveCommand,
		executeCommand,
		processBashMessage,
		processPureBashMessage,
		resetState,
	};
}
