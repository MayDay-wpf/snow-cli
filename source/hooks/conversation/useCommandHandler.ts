import {useStdout} from 'ink';
import {useCallback} from 'react';
import type {Message} from '../../ui/components/chat/MessageList.js';
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
 * @param sessionId - 可选的会话ID，如果提供则使用该ID加载会话进行压缩
 * @returns 返回压缩后的UI消息列表和token使用信息，如果失败返回null
 */
export async function executeContextCompression(sessionId?: string): Promise<{
	uiMessages: Message[];
	usage: UsageInfo;
} | null> {
	try {
		// 必须提供 sessionId 才能执行压缩，避免压缩错误的会话
		if (!sessionId) {
			console.warn(
				'Context compression skipped: No active session ID available',
			);
			return null;
		}

		// CRITICAL: Save current session to disk BEFORE loading for compression
		// This ensures all recently added messages (including tool_calls) are persisted
		// Otherwise loadSession might read stale data, causing compressed session to miss tool_calls
		console.log(`Saving current session ${sessionId} before compression...`);
		const currentSessionBeforeSave = sessionManager.getCurrentSession();
		if (currentSessionBeforeSave && currentSessionBeforeSave.id === sessionId) {
			await sessionManager.saveSession(currentSessionBeforeSave);
			console.log(`Session ${sessionId} saved, now loading for compression...`);
		}

		// 使用提供的 sessionId 加载会话（从文件读取，确保数据完整）
		console.log(`Loading session ${sessionId} for compression...`);
		const currentSession = await sessionManager.loadSession(sessionId);

		if (!currentSession) {
			console.warn(
				`Context compression skipped: Failed to load session ${sessionId}`,
			);
			return null;
		}

		if (currentSession.messages.length === 0) {
			console.warn(`Session ${sessionId} has no messages to compress`);
			return null;
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

		// 构建单条user消息，将压缩摘要和保留的消息内容合并为文本
		// 这样避免了复杂的参数对齐问题（tool_calls、tool_call_id等）
		let finalContent = `[Context Summary from Previous Conversation]\n\n${compressionResult.summary}`;

		// 如果有保留的消息，将其内容转换为文本附加到user消息中
		if (
			compressionResult.preservedMessages &&
			compressionResult.preservedMessages.length > 0
		) {
			finalContent +=
				'\n\n---\n\n[Last Interaction - Preserved for Continuity]\n\n';

			for (const msg of compressionResult.preservedMessages) {
				if (msg.role === 'user') {
					finalContent += `**User:**\n${msg.content}\n\n`;
				} else if (msg.role === 'assistant') {
					finalContent += `**Assistant:**\n${msg.content}`;

					// 如果有tool_calls，以可读的JSON格式附加
					if (msg.tool_calls && msg.tool_calls.length > 0) {
						finalContent += '\n\n**[Tool Calls Initiated]:**\n```json\n';
						finalContent += JSON.stringify(msg.tool_calls, null, 2);
						finalContent += '\n```\n\n';
					} else {
						finalContent += '\n\n';
					}
				} else if (msg.role === 'tool') {
					// 工具执行结果
					finalContent += `**[Tool Result - ${msg.tool_call_id}]:**\n`;
					// 尝试格式化JSON，如果失败则直接显示原始内容
					try {
						const parsed = JSON.parse(msg.content);
						finalContent +=
							'```json\n' + JSON.stringify(parsed, null, 2) + '\n```\n\n';
					} catch {
						finalContent += `${msg.content}\n\n`;
					}
				}
			}
		}

		// 添加单条user消息
		newSessionMessages.push({
			role: 'user',
			content: finalContent,
			timestamp: Date.now(),
		});

		// 创建新会话而不是覆盖旧会话
		// 这样可以保留压缩前的完整历史，支持回滚到压缩前的任意快照点
		const compressedSession = await sessionManager.createNewSession(false);

		// 设置新会话的消息
		compressedSession.messages = newSessionMessages;
		compressedSession.messageCount = newSessionMessages.length;
		compressedSession.updatedAt = Date.now();

		// 保留原会话的标题和摘要
		compressedSession.title = currentSession.title;
		compressedSession.summary = currentSession.summary;

		// 记录压缩关系
		compressedSession.compressedFrom = currentSession.id;
		compressedSession.compressedAt = Date.now();
		compressedSession.originalMessageIndex =
			compressionResult.preservedMessageStartIndex;

		// 保存新会话
		await sessionManager.saveSession(compressedSession);

		// CRITICAL: Reload the new session from disk after compression
		// This ensures the in-memory session object is fully synchronized with the persisted data
		// Without this, subsequent saveMessage calls might save to the old session file
		console.log(
			`Reloading compressed session ${compressedSession.id} from disk...`,
		);
		const reloadedSession = await sessionManager.loadSession(
			compressedSession.id,
		);

		if (reloadedSession) {
			// Set the reloaded session as current (with fresh data from disk)
			sessionManager.setCurrentSession(reloadedSession);
			console.log(
				`Compressed session ${compressedSession.id} reloaded and set as current`,
			);
		} else {
			// Fallback: set the in-memory session if reload fails
			sessionManager.setCurrentSession(compressedSession);
			console.warn(
				`Failed to reload compressed session, using in-memory version`,
			);
		}

		// 新会话有独立的快照系统，不需要重映射旧会话的快照
		// 旧会话的快照保持不变，如果需要回滚到压缩前，可以切换回旧会话

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
	setShowSkillsCreation: React.Dispatch<React.SetStateAction<boolean>>;
	setShowWorkingDirPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowPermissionsPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowBackgroundPanel: () => void;
	setYoloMode: React.Dispatch<React.SetStateAction<boolean>>;
	setPlanMode: React.Dispatch<React.SetStateAction<boolean>>;
	setVulnerabilityHuntingMode: React.Dispatch<React.SetStateAction<boolean>>;
	setContextUsage: React.Dispatch<React.SetStateAction<UsageInfo | null>>;
	setCurrentContextPercentage: React.Dispatch<React.SetStateAction<number>>;
	setVscodeConnectionStatus: React.Dispatch<
		React.SetStateAction<'disconnected' | 'connecting' | 'connected' | 'error'>
	>;
	setIsExecutingTerminalCommand: React.Dispatch<React.SetStateAction<boolean>>;
	processMessage: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => Promise<void>;
	onQuit?: () => void;
	onReindexCodebase?: () => Promise<void>;
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
				options.setIsCompressing(true);
				options.setCompressionError(null);

				try {
					// 获取当前会话ID
					const currentSession = sessionManager.getCurrentSession();
					if (!currentSession) {
						throw new Error('No active session to compress');
					}

					console.log(
						'[Compact] Executing compression for session:',
						currentSession.id,
					);
					// 使用提取的压缩函数，传入当前会话ID
					const compressionResult = await executeContextCompression(
						currentSession.id,
					);

					if (!compressionResult) {
						throw new Error('Compression failed');
					}

					console.log('[Compact] Compression completed successfully');
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
					console.error('[Compact] Compression error:', errorMsg);
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
						options.setCurrentContextPercentage(0);

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
						options.setCurrentContextPercentage(0);

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
			} else if (result.success && result.action === 'showUsagePanel') {
				options.setShowUsagePanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showBackgroundPanel') {
				options.setShowBackgroundPanel();
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
			} else if (result.success && result.action === 'showSkillsCreation') {
				options.setShowSkillsCreation(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showWorkingDirPanel') {
				options.setShowWorkingDirPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showPermissionsPanel') {
				options.setShowPermissionsPanel(true);
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

				// Disable input while command is executing
				options.setIsExecutingTerminalCommand(true);

				// Show executing status
				const statusMessage: Message = {
					role: 'command',
					content: 'Executing...',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, statusMessage]);

				// Use spawn for streaming output
				// Windows 使用 cmd.exe，Unix-like 系统使用 sh
				const isWindows = process.platform === 'win32';
				const shell = isWindows ? 'cmd' : 'sh';
				const shellArgs = isWindows
					? ['/c', result.prompt]
					: ['-c', result.prompt];

				const child = spawn(shell, shellArgs, {
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
					// Re-enable input
					options.setIsExecutingTerminalCommand(false);

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
					// Re-enable input
					options.setIsExecutingTerminalCommand(false);

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
					// Use the location from result, default to 'global' if not provided
					const location = result.location || 'global';
					const projectRoot =
						location === 'project' ? process.cwd() : undefined;

					await deleteCustomCommand(result.prompt, location, projectRoot);
					await registerCustomCommands(projectRoot);

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
			} else if (result.success && result.action === 'togglePlan') {
				// Toggle Plan mode without adding command message
				options.setPlanMode(prev => {
					const newValue = !prev;
					// If enabling Plan mode, disable Vulnerability Hunting mode
					if (newValue) {
						options.setVulnerabilityHuntingMode(false);
					}
					return newValue;
				});
				// Don't add command message to keep UI clean
			} else if (
				result.success &&
				result.action === 'toggleVulnerabilityHunting'
			) {
				// Toggle Vulnerability Hunting mode without adding command message
				options.setVulnerabilityHuntingMode(prev => {
					const newValue = !prev;
					// If enabling Vulnerability Hunting mode, disable Plan mode
					if (newValue) {
						options.setPlanMode(false);
					}
					return newValue;
				});
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
			} else if (result.success && result.action === 'reindexCodebase') {
				// Handle reindex codebase command - silent execution
				if (options.onReindexCodebase) {
					try {
						await options.onReindexCodebase();
					} catch (error) {
						const errorMsg =
							error instanceof Error ? error.message : 'Unknown error';
						const errorMessage: Message = {
							role: 'command',
							content: `Failed to rebuild codebase index: ${errorMsg}`,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
					}
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
