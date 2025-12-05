import {useStdout} from 'ink';
import {useCallback} from 'react';
import type {Message} from '../../ui/components/MessageList.js';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {compressContext} from '../../utils/core/contextCompressor.js';
import {navigateTo} from '../integration/useGlobalNavigation.js';
import type {UsageInfo} from '../../api/chat.js';
import {resetTerminal} from '../../utils/execution/terminal.js';
import {
	showSaveDialog,
	isFileDialogSupported,
} from '../../utils/ui/fileDialog.js';
import {exportMessagesToFile} from '../../utils/session/chatExporter.js';

/**
 * 执行上下文压缩
 * @returns 返回压缩后的UI消息列表和token使用信息，如果失败返回null
 */
export async function executeContextCompression(): Promise<{
	uiMessages: Message[];
	usage: UsageInfo;
} | null> {
	try {
		// 从会话文件读取真实的消息记录
		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession || currentSession.messages.length === 0) {
			throw new Error('No active session or no messages to compress');
		}

		// 使用会话文件中的消息进行压缩（这是真实的对话记录）
		const sessionMessages = currentSession.messages;

		// 转换为 ChatMessage 格式（保留所有关键字段）
		const chatMessages = sessionMessages.map(msg => ({
			role: msg.role,
			content: msg.content,
			tool_call_id: msg.tool_call_id,
			tool_calls: msg.tool_calls,
			images: msg.images,
			reasoning: msg.reasoning,
			thinking: msg.thinking, // 保留 thinking 字段（Anthropic Extended Thinking）
			subAgentInternal: msg.subAgentInternal,
		}));

		// Compress the context (全量压缩，保留最后一轮完整对话)
		const compressionResult = await compressContext(chatMessages);

		// 如果返回null，说明无法安全压缩（历史不足或只有当前轮次）
		if (!compressionResult) {
			console.warn('Compression skipped: not enough history to compress');
			return null;
		}

		// Check if beforeCompress hook failed
		if (compressionResult.hookFailed) {
			console.warn('Compression blocked by beforeCompress hook');
			// Return a special result with hookFailed flag to abort AI flow
			// Don't return usage to avoid changing token counts
			return {
				uiMessages: [],
				hookFailed: true,
				hookErrorDetails: compressionResult.hookErrorDetails,
			} as any;
		}

		// 构建新的会话消息列表
		const newSessionMessages: Array<any> = [];

		// 添加压缩摘要到会话（使用 user 角色，因为 Extended Thinking 模式下所有 assistant 消息都需要 thinking 块）
		newSessionMessages.push({
			role: 'user',
			content: `[Context Summary from Previous Conversation]\n\n${compressionResult.summary}`,
			timestamp: Date.now(),
		});

		// 添加保留的最后一轮完整对话（保留完整的消息结构）
		if (
			compressionResult.preservedMessages &&
			compressionResult.preservedMessages.length > 0
		) {
			for (const msg of compressionResult.preservedMessages) {
				// 保留完整的消息结构，包括所有关键字段
				// CRITICAL: Use !== undefined to preserve empty strings and empty arrays
				newSessionMessages.push({
					role: msg.role,
					content: msg.content,
					timestamp: Date.now(),
					...(msg.tool_call_id !== undefined && {
						tool_call_id: msg.tool_call_id,
					}),
					...(msg.tool_calls !== undefined && {tool_calls: msg.tool_calls}),
					...(msg.images !== undefined && {images: msg.images}),
					...(msg.reasoning !== undefined && {reasoning: msg.reasoning}),
					...(msg.thinking !== undefined && {thinking: msg.thinking}), // 保留 thinking 字段（Anthropic Extended Thinking）
					...(msg.subAgentInternal !== undefined && {
						subAgentInternal: msg.subAgentInternal,
					}),
				});
			}
		}

		// 更新当前会话的消息（不新建会话）
		currentSession.messages = newSessionMessages;
		currentSession.messageCount = newSessionMessages.length;
		currentSession.updatedAt = Date.now();

		// 保存更新后的会话文件
		await sessionManager.saveSession(currentSession);

		// 同步更新UI消息列表：从会话消息转换为UI Message格式
		const newUIMessages: Message[] = [];

		for (const sessionMsg of newSessionMessages) {
			// 跳过 tool 角色的消息（工具执行结果），避免UI显示大量JSON
			if (sessionMsg.role === 'tool') {
				continue;
			}

			const uiMessage: Message = {
				role: sessionMsg.role as any,
				content: sessionMsg.content,
				streaming: false,
			};

			// 如果有 tool_calls，显示工具调用信息（但不显示详细参数）
			if (sessionMsg.tool_calls && sessionMsg.tool_calls.length > 0) {
				// 在内容中添加简洁的工具调用摘要
				const toolSummary = sessionMsg.tool_calls
					.map((tc: any) => `[Tool: ${tc.function.name}]`)
					.join(', ');

				// 如果内容为空或很短，显示工具调用摘要
				if (!uiMessage.content || uiMessage.content.length < 10) {
					uiMessage.content = toolSummary;
				}
			}

			newUIMessages.push(uiMessage);
		}

		return {
			uiMessages: newUIMessages,
			usage: {
				prompt_tokens: compressionResult.usage.prompt_tokens,
				completion_tokens: compressionResult.usage.completion_tokens,
				total_tokens: compressionResult.usage.total_tokens,
			},
		};
	} catch (error) {
		console.error('Context compression failed:', error);
		return null;
	}
}

type CommandHandlerOptions = {
	messages: Message[];
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setRemountKey: React.Dispatch<React.SetStateAction<number>>;
	clearSavedMessages: () => void;
	setIsCompressing: React.Dispatch<React.SetStateAction<boolean>>;
	setCompressionError: React.Dispatch<React.SetStateAction<string | null>>;
	setShowSessionPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowMcpPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowUsagePanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowHelpPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowCustomCommandConfig: React.Dispatch<React.SetStateAction<boolean>>;
	setYoloMode: React.Dispatch<React.SetStateAction<boolean>>;
	setContextUsage: React.Dispatch<React.SetStateAction<UsageInfo | null>>;
	setVscodeConnectionStatus: React.Dispatch<
		React.SetStateAction<'disconnected' | 'connecting' | 'connected' | 'error'>
	>;
	processMessage: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => Promise<void>;
	onQuit?: () => void;
};

export function useCommandHandler(options: CommandHandlerOptions) {
	const {stdout} = useStdout();

	const handleCommandExecution = useCallback(
		async (commandName: string, result: any) => {
			// Handle /compact command
			if (
				commandName === 'compact' &&
				result.success &&
				result.action === 'compact'
			) {
				// Set compressing state (不添加命令面板消息)
				options.setIsCompressing(true);
				options.setCompressionError(null);

				try {
					// 使用提取的压缩函数
					const compressionResult = await executeContextCompression();

					if (!compressionResult) {
						throw new Error('Compression failed');
					}

					// 更新UI
					options.clearSavedMessages();
					options.setMessages(compressionResult.uiMessages);
					options.setRemountKey(prev => prev + 1);

					// Update token usage with compression result
					options.setContextUsage(compressionResult.usage);
				} catch (error) {
					// Show error message
					const errorMsg =
						error instanceof Error
							? error.message
							: 'Unknown compression error';
					options.setCompressionError(errorMsg);

					const errorMessage: Message = {
						role: 'assistant',
						content: `**Compression Failed**\n\n${errorMsg}`,
						streaming: false,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				} finally {
					options.setIsCompressing(false);
				}
				return;
			}

			// Handle /ide command
			if (commandName === 'ide') {
				if (result.success) {
					// Connection successful, set status to connected immediately
					// The轮询 mechanism will also update the status, but we do it here for immediate feedback
					options.setVscodeConnectionStatus('connected');
					// Don't add command message to keep UI clean
				} else {
					options.setVscodeConnectionStatus('error');
				}
				return;
			}

			if (result.success && result.action === 'clear') {
				// Execute onSessionStart hook BEFORE clearing session
				(async () => {
					try {
						const {unifiedHooksExecutor} = await import(
							'../../utils/execution/unifiedHooksExecutor.js'
						);
						const hookResult = await unifiedHooksExecutor.executeHooks(
							'onSessionStart',
							{
								messages: [],
								messageCount: 0,
							},
						);

						// Check for hook failures
						let shouldAbort = false;
						let warningMessage: string | null = null;
						if (!hookResult.success) {
							const commandError = hookResult.results.find(
								r => r.type === 'command' && !r.success,
							);

							if (commandError && commandError.type === 'command') {
								const {exitCode, command, output, error} = commandError;
								const combinedOutput =
									[output, error].filter(Boolean).join('\n\n') || '(no output)';

								if (exitCode === 1) {
									// Warning: save to display AFTER clearing screen
									warningMessage = `[WARN] onSessionStart hook warning:\nCommand: ${command}\nOutput: ${combinedOutput}`;
								} else if (exitCode >= 2 || exitCode < 0) {
									// Critical error: display using HookErrorDisplay component
									const errorMessage: Message = {
										role: 'assistant',
										content: '', // Content will be rendered by HookErrorDisplay
										hookError: {
											type: 'error',
											exitCode,
											command,
											output,
											error,
										},
									};

									options.setMessages(prev => [...prev, errorMessage]);
									shouldAbort = true;
								}
							}
						}

						// If hook failed critically, don't clear session
						if (shouldAbort) {
							return;
						}

						// Hook passed, now clear session
						resetTerminal(stdout);
						sessionManager.clearCurrentSession();
						options.clearSavedMessages();
						options.setMessages([]);
						options.setRemountKey(prev => prev + 1);
						options.setContextUsage(null);

						// Add command message
						const commandMessage: Message = {
							role: 'command',
							content: '',
							commandName: commandName,
						};
						options.setMessages([commandMessage]);

						// Display warning AFTER clearing screen
						if (warningMessage) {
							console.log(warningMessage);
						}
					} catch (error) {
						console.error('Failed to execute onSessionStart hook:', error);
						// On exception, still clear session
						resetTerminal(stdout);
						sessionManager.clearCurrentSession();
						options.clearSavedMessages();
						options.setMessages([]);
						options.setRemountKey(prev => prev + 1);
						options.setContextUsage(null);

						const commandMessage: Message = {
							role: 'command',
							content: '',
							commandName: commandName,
						};
						options.setMessages([commandMessage]);
					}
				})();
			} else if (result.success && result.action === 'showSessionPanel') {
				options.setShowSessionPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showMcpPanel') {
				options.setShowMcpPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showUsagePanel') {
				options.setShowUsagePanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showHelpPanel') {
				options.setShowHelpPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (
				result.success &&
				result.action === 'showCustomCommandConfig'
			) {
				options.setShowCustomCommandConfig(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (
				result.success &&
				result.action === 'executeCustomCommand' &&
				result.prompt
			) {
				// Execute custom command (prompt type - send to AI)
				const commandMessage: Message = {
					role: 'command',
					content: result.message || '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
				// Send command to AI for execution
				options.processMessage(result.prompt, undefined, false, false);
			} else if (
				result.success &&
				result.action === 'executeTerminalCommand' &&
				result.prompt
			) {
				// Execute terminal command (execute type - run in terminal)
				const {spawn} = require('child_process');

				// Show executing status
				const statusMessage: Message = {
					role: 'command',
					content: 'Executing...',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, statusMessage]);

				// Use spawn for streaming output
				const child = spawn('sh', ['-c', result.prompt], {
					timeout: 30000,
				});

				let outputBuffer = '';

				// Stream stdout
				child.stdout.on('data', (data: Buffer) => {
					const text = data.toString();
					outputBuffer += text;

					// Add new message for each chunk (plain output, no icons)
					const chunkMessage: Message = {
						role: 'assistant',
						content: text,
						plainOutput: true,
					};
					options.setMessages(prev => [...prev, chunkMessage]);
				});

				// Stream stderr
				child.stderr.on('data', (data: Buffer) => {
					const text = data.toString();
					outputBuffer += text;

					// Add new message for each chunk (plain output, no icons)
					const chunkMessage: Message = {
						role: 'assistant',
						content: text,
						plainOutput: true,
					};
					options.setMessages(prev => [...prev, chunkMessage]);
				});

				// Handle completion
				child.on('close', () => {
					// Remove executing status message
					options.setMessages(prev =>
						prev.filter(msg => msg !== statusMessage),
					);

					// If no output, add a message
					if (!outputBuffer) {
						const noOutputMessage: Message = {
							role: 'command',
							content: 'Command executed (no output)',
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, noOutputMessage]);
					}
				});

				// Handle error
				child.on('error', (error: any) => {
					// Remove executing status message
					options.setMessages(prev =>
						prev.filter(msg => msg !== statusMessage),
					);

					// Add error message
					const errorMessage: Message = {
						role: 'command',
						content: `Command failed: ${error.message}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				});
			} else if (
				result.success &&
				result.action === 'deleteCustomCommand' &&
				result.prompt
			) {
				// Delete custom command
				const {
					deleteCustomCommand,
					registerCustomCommands,
				} = require('../../utils/commands/custom.js');

				try {
					await deleteCustomCommand(result.prompt);
					await registerCustomCommands();

					const successMessage: Message = {
						role: 'command',
						content: `Custom command '${result.prompt}' deleted successfully`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, successMessage]);
				} catch (error: any) {
					const errorMessage: Message = {
						role: 'command',
						content: `Failed to delete command: ${error.message}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (result.success && result.action === 'home') {
				// Reset terminal before navigating to welcome screen
				resetTerminal(stdout);
				navigateTo('welcome');
			} else if (result.success && result.action === 'toggleYolo') {
				// Toggle YOLO mode without adding command message
				options.setYoloMode(prev => !prev);
				// Don't add command message to keep UI clean
			} else if (
				result.success &&
				result.action === 'initProject' &&
				result.prompt
			) {
				// Add command execution feedback
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
				// Auto-send the prompt using basicModel, hide the prompt from UI
				options.processMessage(result.prompt, undefined, true, true);
			} else if (
				result.success &&
				result.action === 'review' &&
				result.prompt
			) {
				// Clear current session and start new one for code review
				sessionManager.clearCurrentSession();
				options.clearSavedMessages();
				options.setMessages([]);
				options.setRemountKey(prev => prev + 1);
				// Reset context usage (token statistics)
				options.setContextUsage(null);

				// Add command execution feedback
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages([commandMessage]);
				// Auto-send the review prompt using advanced model (not basic model), hide the prompt from UI
				options.processMessage(result.prompt, undefined, false, true);
			} else if (result.success && result.action === 'exportChat') {
				// Handle export chat command
				// Show loading message first
				const loadingMessage: Message = {
					role: 'command',
					content: 'Opening file save dialog...',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, loadingMessage]);

				try {
					// Check if file dialog is supported
					if (!isFileDialogSupported()) {
						const errorMessage: Message = {
							role: 'command',
							content:
								'File dialog not supported on this platform. Export cancelled.',
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
						return;
					}

					// Generate default filename with timestamp
					const timestamp = new Date()
						.toISOString()
						.replace(/[:.]/g, '-')
						.split('.')[0];
					const defaultFilename = `snow-chat-${timestamp}.txt`;

					// Show native save dialog
					const filePath = await showSaveDialog(
						defaultFilename,
						'Export Chat Conversation',
					);

					if (!filePath) {
						// User cancelled
						const cancelMessage: Message = {
							role: 'command',
							content: 'Export cancelled by user.',
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, cancelMessage]);
						return;
					}

					// Export messages to file
					await exportMessagesToFile(options.messages, filePath);

					// Show success message
					const successMessage: Message = {
						role: 'command',
						content: `✓ Chat exported successfully to:\n${filePath}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, successMessage]);
				} catch (error) {
					// Show error message
					const errorMsg =
						error instanceof Error ? error.message : 'Unknown error';
					const errorMessage: Message = {
						role: 'command',
						content: `✗ Export failed: ${errorMsg}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (result.success && result.action === 'quit') {
				// Handle quit command - exit the application cleanly
				if (options.onQuit) {
					options.onQuit();
				}
			} else if (result.message) {
				// For commands that just return a message (like /role, /init without AGENTS.md, etc.)
				// Display the message as a command message
				const commandMessage: Message = {
					role: 'command',
					content: result.message,
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			}
		},
		[stdout, options],
	);

	return {handleCommandExecution};
}
