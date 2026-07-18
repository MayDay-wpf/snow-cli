import type {ChatMessage} from '../../api/chat.js';
import type {Message} from '../../ui/components/chat/MessageList.js';
import {formatToolCallMessage} from '../ui/messageFormatter.js';
import {
	isToolNeedTwoStepDisplay,
	extractFilesystemEditDiffDataForPersistence,
} from '../config/toolDisplayConfig.js';
import {enrichPendingEditArgs} from '../ui/diffPreview.js';
import {formatToolTitleLine} from '../../ui/components/special/toolIcons.js';

/**
 * 从后续的 tool result 消息中提取 editDiffData。
 *
 * 当 resume 会话时，pending 消息需要恢复 DiffViewer 显示。但此时文件
 * 已经被编辑过，enrichPendingEditArgs 从磁盘读取的文件内容无法正确
 * 计算 diff（searchContent 找不到、hash 锚点失效等）。
 *
 * 因此需要从后续的 tool result 消息中提取保存的 editDiffData —— 这是
 * 工具执行时提取的原始 diff 元数据，包含了正确的 oldContent/newContent。
 *
 * @param sessionMessages - 完整的会话消息列表
 * @param startIndex - 当前 assistant 消息的索引
 * @param toolCallId - 要查找的 tool_call ID
 * @returns editDiffData 或 undefined
 */
function findToolResultDiffData(
	sessionMessages: ChatMessage[],
	startIndex: number,
	toolCallId: string,
): Record<string, any> | undefined {
	for (let j = startIndex + 1; j < sessionMessages.length; j++) {
		const nextMsg = sessionMessages[j];
		if (!nextMsg) break;
		// tool result 消息的 tool_call_id 匹配
		if (nextMsg.role === 'tool' && nextMsg.tool_call_id === toolCallId) {
			// 优先使用保存的 editDiffData 字段
			const savedEditDiffData = (nextMsg as any).editDiffData;
			if (
				savedEditDiffData &&
				(typeof savedEditDiffData.oldContent === 'string' ||
					typeof savedEditDiffData.content === 'string' ||
					Array.isArray(savedEditDiffData.batchResults))
			) {
				return savedEditDiffData;
			}
			// 回退：从 content JSON 中提取
			const toolName = findToolNameForToolCall(
				sessionMessages,
				startIndex,
				toolCallId,
			);
			if (toolName) {
				return extractFilesystemEditDiffDataForPersistence(
					toolName,
					nextMsg.content,
				);
			}
			return undefined;
		}
		// 遇到下一个 assistant 消息就停止
		if (nextMsg.role === 'assistant' && !nextMsg.subAgentInternal) {
			break;
		}
	}
	return undefined;
}

/**
 * 向前查找 assistant 消息中某个 tool_call 的工具名。
 */
function findToolNameForToolCall(
	sessionMessages: ChatMessage[],
	assistantIndex: number,
	toolCallId: string,
): string | undefined {
	const msg = sessionMessages[assistantIndex];
	if (!msg || !msg.tool_calls) return undefined;
	const tc = msg.tool_calls.find(t => t.id === toolCallId);
	return tc?.function.name;
}

/**
 * Whether a tool_call already has a matching tool result after the assistant message.
 * Used so resume does not rebuild live "pending" rows for completed tools.
 */
function hasMatchingToolResult(
	sessionMessages: ChatMessage[],
	startIndex: number,
	toolCallId: string,
): boolean {
	for (let j = startIndex + 1; j < sessionMessages.length; j++) {
		const nextMsg = sessionMessages[j];
		if (!nextMsg) break;
		if (nextMsg.role === 'tool' && nextMsg.tool_call_id === toolCallId) {
			return true;
		}
		// Stop at the next top-level assistant turn
		if (nextMsg.role === 'assistant' && !nextMsg.subAgentInternal) {
			break;
		}
	}
	return false;
}

/**
 * Clean thinking content by removing XML-like tags
 * Some third-party APIs (e.g., DeepSeek R1) may include <think></think> or <thinking></thinking> tags
 */
function cleanThinkingContent(content: string): string {
	return content.replace(/\s*<\/?think(?:ing)?>\s*/gi, '').trim();
}

function isValidTimestamp(timestamp: unknown): timestamp is number {
	return typeof timestamp === 'number' && Number.isFinite(timestamp);
}

function appendAiCompletionTimeMessage(
	uiMessages: Message[],
	timestamp: unknown,
	durationMs?: number,
): void {
	if (!isValidTimestamp(timestamp)) {
		return;
	}

	uiMessages.push({
		role: 'assistant',
		content: '',
		streaming: false,
		aiCompletionTime: new Date(timestamp),
		aiCompletionDurationMs:
			typeof durationMs === 'number' &&
			Number.isFinite(durationMs) &&
			durationMs >= 0
				? durationMs
				: undefined,
	});
}

/**
 * Convert API format session messages to UI format messages
 * Process messages in order to maintain correct sequence
 */
export function convertSessionMessagesToUI(
	sessionMessages: ChatMessage[],
): Message[] {
	const uiMessages: Message[] = [];

	// Track which tool_calls have been processed
	const processedToolCalls = new Set<string>();

	// Helper function to extract thinking content from all sources
	const extractThinkingFromMessage = (msg: any): string | undefined => {
		let content: string | undefined;
		// 1. Anthropic Extended Thinking
		if (msg.thinking?.thinking) {
			content = msg.thinking.thinking;
		}
		// 2. Responses API reasoning summary
		else if (msg.reasoning?.summary && Array.isArray(msg.reasoning.summary)) {
			content = msg.reasoning.summary
				.map((item: any) => item.text)
				.filter(Boolean)
				.join('\n');
		}
		// 3. DeepSeek R1 reasoning content
		else if (
			msg.reasoning_content &&
			typeof msg.reasoning_content === 'string'
		) {
			content = msg.reasoning_content;
		}

		return content ? cleanThinkingContent(content) : undefined;
	};

	for (let i = 0; i < sessionMessages.length; i++) {
		const msg = sessionMessages[i];
		if (!msg) continue;

		if (
			msg.subAgentInternal &&
			msg.subAgentContent &&
			msg.role === 'assistant'
		) {
			uiMessages.push({
				role: 'subagent',
				content: msg.content,
				streaming: false,
				thinking: extractThinkingFromMessage(msg),
				subAgentInternal: true,
				subAgentContent: true,
				subAgent: msg.subAgent,
			});
			continue;
		}

		// Handle sub-agent internal tool call messages
		if (msg.subAgentInternal && msg.role === 'assistant' && msg.tool_calls) {
			const timeConsumingTools = msg.tool_calls.filter(tc =>
				isToolNeedTwoStepDisplay(tc.function.name),
			);
			const quickTools = msg.tool_calls.filter(
				tc => !isToolNeedTwoStepDisplay(tc.function.name),
			);

			// Display time-consuming tools individually
			for (const toolCall of timeConsumingTools) {
				const toolDisplay = formatToolCallMessage(toolCall as any);
				let toolArgs;
				try {
					toolArgs = JSON.parse(toolCall.function.arguments);
				} catch (e) {
					toolArgs = {};
				}

				// Build parameter display for terminal-execute
				let paramDisplay = '';
				if (toolCall.function.name === 'terminal-execute' && toolArgs.command) {
					paramDisplay = ` "${toolArgs.command}"`;
				} else if (toolDisplay.args.length > 0) {
					const params = toolDisplay.args
						.map((arg: any) => `${arg.key}: ${arg.value}`)
						.join(', ');
					paramDisplay = ` (${params})`;
				}

				// Prefer saved editDiffData from the subsequent tool result
				// (same rationale as the non-subagent path above).
				const subAgentSavedDiffData = findToolResultDiffData(
					sessionMessages,
					i,
					toolCall.id,
				);
				const subAgentEnrichedArgs = subAgentSavedDiffData
					? {...toolArgs, ...subAgentSavedDiffData}
					: enrichPendingEditArgs(toolCall.function.name, toolArgs);
				uiMessages.push({
					role: 'subagent',
					content: `\x1b[38;2;184;122;206m\u2687\u26A1 ${toolDisplay.toolName}${paramDisplay}\x1b[0m`,
					streaming: false,
					toolCall: {
						name: toolCall.function.name,
						arguments: subAgentEnrichedArgs,
					},
					toolCallId: toolCall.id,
					toolPending: false,
					messageStatus: 'pending',
					subAgentInternal: true,
				});
				processedToolCalls.add(toolCall.id);
			}

			// Display quick tools in compact mode
			if (quickTools.length > 0) {
				// Find agent name from next tool result message
				let agentName = 'Sub-Agent';
				for (let j = i + 1; j < sessionMessages.length; j++) {
					const nextMsg = sessionMessages[j];
					if (nextMsg && nextMsg.subAgentInternal && nextMsg.role === 'tool') {
						// Try to find agent name from context
						// For now, use a default name
						break;
					}
				}

				const toolLines = quickTools.map((tc: any, index: number) => {
					const display = formatToolCallMessage(tc);
					const isLast = index === quickTools.length - 1;
					const prefix = isLast ? '└─' : '├─';

					// Build parameter display
					const params = display.args
						.map((arg: any) => `${arg.key}: ${arg.value}`)
						.join(', ');

					return `\n  \x1b[2m${prefix} ${display.toolName}${
						params ? ` (${params})` : ''
					}\x1b[0m`;
				});

				uiMessages.push({
					role: 'subagent',
					content: `\x1b[38;2;184;122;206m⚇ ${agentName}${toolLines.join(
						'',
					)}\x1b[0m`,
					streaming: false,
					subAgentInternal: true,
					pendingToolIds: quickTools.map((tc: any) => tc.id),
				});

				for (const tc of quickTools) {
					processedToolCalls.add(tc.id);
				}
			}
			continue;
		}

		// Handle sub-agent internal tool result messages
		if (msg.subAgentInternal && msg.role === 'tool' && msg.tool_call_id) {
			const status =
				msg.messageStatus ??
				(msg.content.startsWith('Error:') ? 'error' : 'success');
			const isError = status === 'error';

			// Find tool name from previous assistant message
			let toolName = 'tool';
			let isTimeConsumingTool = false;

			for (let j = i - 1; j >= 0; j--) {
				const prevMsg = sessionMessages[j];
				if (!prevMsg) continue;

				if (
					prevMsg.role === 'assistant' &&
					prevMsg.tool_calls &&
					prevMsg.subAgentInternal
				) {
					const tc = prevMsg.tool_calls.find(t => t.id === msg.tool_call_id);
					if (tc) {
						toolName = tc.function.name;
						isTimeConsumingTool = isToolNeedTwoStepDisplay(toolName);
						break;
					}
				}
			}

			// For time-consuming tools, always show result with full details
			if (isTimeConsumingTool) {
				// UI only shows simple failure message, detailed error is sent to AI via msg.content
				const statusText = '';

				let terminalResultData:
					| {
							stdout?: string;
							stderr?: string;
							exitCode?: number;
							command?: string;
					  }
					| undefined;

				// Extract terminal result data
				if (toolName === 'terminal-execute' && !isError) {
					try {
						const resultData = JSON.parse(msg.content);
						if (
							resultData.stdout !== undefined ||
							resultData.stderr !== undefined
						) {
							terminalResultData = {
								stdout: resultData.stdout,
								stderr: resultData.stderr,
								exitCode: resultData.exitCode,
								command: resultData.command,
							};
						}
					} catch (e) {
						// Ignore parse errors
					}
				}

				// Extract filesystem diff data
				let fileToolData: any = undefined;
				if (
					!isError &&
					(toolName === 'filesystem-create' ||
						toolName === 'filesystem-edit' ||
						toolName === 'filesystem-replaceedit')
				) {
					const editDiffData = (msg as any).editDiffData;
					if (
						editDiffData &&
						(typeof editDiffData.oldContent === 'string' ||
							typeof editDiffData.content === 'string' ||
							Array.isArray(editDiffData.batchResults))
					) {
						fileToolData = {
							name: toolName,
							arguments: editDiffData,
						};
					}
					try {
						const resultData = JSON.parse(msg.content);

						if (resultData.content) {
							fileToolData = {
								name: toolName,
								arguments: {
									content: resultData.content,
									path: resultData.path || resultData.filename,
								},
							};
						} else if (resultData.oldContent && resultData.newContent) {
							fileToolData = {
								name: toolName,
								arguments: {
									oldContent: resultData.oldContent,
									newContent: resultData.newContent,
									filename:
										resultData.filePath ||
										resultData.path ||
										resultData.filename,
									completeOldContent: resultData.completeOldContent,
									completeNewContent: resultData.completeNewContent,
									contextStartLine: resultData.contextStartLine,
								},
							};
						} else if (
							!fileToolData &&
							resultData.results &&
							Array.isArray(resultData.results)
						) {
							fileToolData = {
								name: toolName,
								arguments: {
									isBatch: true,
									batchResults: resultData.results,
								},
							};
						}
					} catch (e) {
						// Ignore parse errors
					}
				}

				uiMessages.push({
					role: 'subagent',
					content: `${formatToolTitleLine(
						toolName,
						isError ? 'error' : 'success',
					)}${statusText}`,
					streaming: false,
					toolResult: !isError ? msg.content : undefined,
					terminalResult: terminalResultData,
					toolCall: terminalResultData
						? {
								name: toolName,
								arguments: terminalResultData,
						  }
						: fileToolData
						? fileToolData
						: undefined,
					messageStatus: status,
					subAgentInternal: true,
				});
			} else {
				// For quick tools, only show errors
				// Success results are handled by updating pendingToolIds in the compact message
				if (isError) {
					// UI only shows simple failure message, detailed error is sent to AI
					uiMessages.push({
						role: 'subagent',
						content: formatToolTitleLine(toolName, 'error'),
						streaming: false,
						messageStatus: 'error',
						subAgentInternal: true,
					});
				}
				// Note: Success results for quick tools are not shown individually
				// They are represented by the completion checkmark on the compact "Quick Tools" message
			}
			continue;
		}

		// Handle regular assistant messages with tool_calls
		if (
			msg.role === 'assistant' &&
			msg.tool_calls &&
			msg.tool_calls.length > 0 &&
			!msg.subAgentInternal
		) {
			// If there's thinking content or text content before tool calls, display it first
			const thinkingContent = extractThinkingFromMessage(msg);
			if ((msg.content && msg.content.trim()) || thinkingContent) {
				uiMessages.push({
					role: 'assistant',
					content: msg.content?.trim() || '',
					streaming: false,
					thinking: thinkingContent,
				});
			}

			// Generate parallel group ID for non-time-consuming tools
			const hasMultipleTools = msg.tool_calls.length > 1;
			const hasNonTimeConsumingTool = msg.tool_calls.some(
				tc => !isToolNeedTwoStepDisplay(tc.function.name),
			);
			const parallelGroupId =
				hasMultipleTools && hasNonTimeConsumingTool
					? `parallel-${i}-${Math.random()}`
					: undefined;

			for (const toolCall of msg.tool_calls) {
				// Skip if already processed
				if (processedToolCalls.has(toolCall.id)) continue;

				const toolDisplay = formatToolCallMessage(toolCall as any);
				let toolArgs;
				try {
					toolArgs = JSON.parse(toolCall.function.arguments);
				} catch (e) {
					toolArgs = {};
				}

				// Only rebuild a pending row for two-step tools that never finished.
				// Completed tools already have a tool result message; live UI removes
				// the pending row after success, so resume must not recreate it as
				// toolPending (PendingToolCalls would treat history as still running).
				const needTwoSteps = isToolNeedTwoStepDisplay(toolCall.function.name);
				const toolCompleted = hasMatchingToolResult(
					sessionMessages,
					i,
					toolCall.id,
				);
				if (needTwoSteps && !toolCompleted) {
					// When resuming a session, the file on disk has already been
					// edited, so enrichPendingEditArgs (which reads the current
					// file) cannot compute a correct diff. Instead, prefer the
					// editDiffData saved in the subsequent tool result message —
					// it contains the original oldContent/newContent captured at
					// execution time.
					const savedDiffData = findToolResultDiffData(
						sessionMessages,
						i,
						toolCall.id,
					);
					const enrichedArgs = savedDiffData
						? {...toolArgs, ...savedDiffData}
						: enrichPendingEditArgs(toolCall.function.name, toolArgs);
					// Incomplete historical tool: show as pending in Static, not as a
					// live spinner row (toolPending is reserved for active execution).
					uiMessages.push({
						role: 'assistant',
						content: formatToolTitleLine(toolCall.function.name, 'pending'),
						streaming: false,
						toolCall: {
							name: toolCall.function.name,
							arguments: enrichedArgs,
						},
						toolDisplay,
						toolCallId: toolCall.id,
						toolPending: false,
						messageStatus: 'pending',
					});
				}

				// Store parallel group info for this tool call
				if (parallelGroupId && !needTwoSteps) {
					processedToolCalls.add(toolCall.id);
					// Mark this tool call with parallel group (will be used when processing tool results)
					(toolCall as any).parallelGroupId = parallelGroupId;
				} else {
					processedToolCalls.add(toolCall.id);
				}
			}
			continue;
		}

		// Handle regular tool result messages (non-subagent)
		if (msg.role === 'tool' && msg.tool_call_id && !msg.subAgentInternal) {
			const isRejectedWithReply = msg.content.includes(
				'Tool execution rejected by user:',
			);
			const status =
				msg.messageStatus ??
				(msg.content.startsWith('Error:') || isRejectedWithReply
					? 'error'
					: 'success');
			const isError = status === 'error';

			// UI only shows simple failure message, detailed error is sent to AI via msg.content
			let statusText = '';
			// Keep rejection reason display for user feedback (not error details)
			if (isRejectedWithReply) {
				// Extract rejection reason
				const reason =
					msg.content.split('Tool execution rejected by user:')[1]?.trim() ||
					'';
				statusText = reason ? `\n  └─ Rejection reason: ${reason}` : '';
			}

			// Find tool name and args from previous assistant message
			let toolName = 'tool';
			let toolArgs: any = {};
			let editDiffData:
				| {
						oldContent?: string;
						newContent?: string;
						content?: string;
						path?: string;
						filename?: string;
						completeOldContent?: string;
						completeNewContent?: string;
						contextStartLine?: number;
						batchResults?: any[];
						isBatch?: boolean;
				  }
				| undefined;
			let terminalResultData:
				| {
						stdout?: string;
						stderr?: string;
						exitCode?: number;
						command?: string;
				  }
				| undefined;

			for (let j = i - 1; j >= 0; j--) {
				const prevMsg = sessionMessages[j];
				if (!prevMsg) continue;

				if (
					prevMsg.role === 'assistant' &&
					prevMsg.tool_calls &&
					!prevMsg.subAgentInternal
				) {
					const tc = prevMsg.tool_calls.find(t => t.id === msg.tool_call_id);
					if (tc) {
						toolName = tc.function.name;
						try {
							toolArgs = JSON.parse(tc.function.arguments);
						} catch (e) {
							toolArgs = {};
						}

						// Extract edit diff data
						if (
							(toolName === 'filesystem-edit' ||
								toolName === 'filesystem-replaceedit' ||
								toolName === 'filesystem-create') &&
							!isError
						) {
							if (
								(msg as any).editDiffData &&
								(typeof (msg as any).editDiffData.oldContent === 'string' ||
									typeof (msg as any).editDiffData.content === 'string' ||
									Array.isArray((msg as any).editDiffData.batchResults))
							) {
								editDiffData = (msg as any).editDiffData;
								toolArgs = {...toolArgs, ...(msg as any).editDiffData};
							}
							try {
								const resultData = JSON.parse(msg.content);
								// Handle single file create
								if (resultData.content) {
									editDiffData = {
										content: resultData.content,
										path: resultData.path || resultData.filename,
									};
									toolArgs.content = resultData.content;
									toolArgs.path = resultData.path || resultData.filename;
								}
								// Handle single file edit
								else if (resultData.oldContent && resultData.newContent) {
									editDiffData = {
										oldContent: resultData.oldContent,
										newContent: resultData.newContent,
										filename: resultData.filePath || toolArgs.filePath,
										completeOldContent: resultData.completeOldContent,
										completeNewContent: resultData.completeNewContent,
										contextStartLine: resultData.contextStartLine,
									};
									toolArgs.oldContent = resultData.oldContent;
									toolArgs.newContent = resultData.newContent;
									toolArgs.filename = resultData.filePath || toolArgs.filePath;
									toolArgs.completeOldContent = resultData.completeOldContent;
									toolArgs.completeNewContent = resultData.completeNewContent;
									toolArgs.contextStartLine = resultData.contextStartLine;
								}
								// Handle batch edit/create
								else if (
									!editDiffData &&
									resultData.results &&
									Array.isArray(resultData.results)
								) {
									editDiffData = {
										batchResults: resultData.results,
										isBatch: true,
									} as any;
									toolArgs.batchResults = resultData.results;
									toolArgs.isBatch = true;
								}
							} catch (e) {
								// Ignore parse errors
							}
						}

						// Extract terminal result data
						if (toolName === 'terminal-execute' && !isError) {
							try {
								const resultData = JSON.parse(msg.content);
								if (
									resultData.stdout !== undefined ||
									resultData.stderr !== undefined
								) {
									terminalResultData = {
										stdout: resultData.stdout,
										stderr: resultData.stderr,
										exitCode: resultData.exitCode,
										command: toolArgs.command,
									};
								}
							} catch (e) {
								// Ignore parse errors
							}
						}

						break;
					}
				}
			}

			// Check if this tool result is part of a parallel group
			let parallelGroupId: string | undefined;
			for (let j = i - 1; j >= 0; j--) {
				const prevMsg = sessionMessages[j];
				if (!prevMsg) continue;

				if (
					prevMsg.role === 'assistant' &&
					prevMsg.tool_calls &&
					!prevMsg.subAgentInternal
				) {
					const tc = prevMsg.tool_calls.find(t => t.id === msg.tool_call_id);
					if (tc) {
						parallelGroupId = (tc as any).parallelGroupId;
						break;
					}
				}
			}

			const isNonTimeConsuming = !isToolNeedTwoStepDisplay(toolName);

			uiMessages.push({
				role: 'assistant',
				content: `${formatToolTitleLine(
					toolName,
					isError ? 'error' : 'success',
				)}${statusText}`,
				streaming: false,
				toolResult: !isError ? msg.content : undefined,
				toolCall:
					editDiffData || terminalResultData
						? {
								name: toolName,
								arguments: toolArgs,
						  }
						: undefined,
				terminalResult: terminalResultData,
				messageStatus: status,
				// Add toolDisplay for non-time-consuming tools
				toolDisplay:
					isNonTimeConsuming && !editDiffData
						? formatToolCallMessage({
								id: msg.tool_call_id || '',
								type: 'function' as const,
								function: {
									name: toolName,
									arguments: JSON.stringify(toolArgs),
								},
						  } as any)
						: undefined,
				// Mark parallel group for non-time-consuming tools
				parallelGroup:
					isNonTimeConsuming && parallelGroupId ? parallelGroupId : undefined,
			});
			continue;
		}

		// Handle regular user and assistant messages
		if (msg.role === 'user' || msg.role === 'assistant') {
			uiMessages.push({
				role: msg.role,
				content: msg.content,
				streaming: false,
				images: msg.images,
				thinking: extractThinkingFromMessage(msg),
				editorContext: msg.role === 'user' ? msg.editorContext : undefined,
			});

			if (msg.role === 'assistant') {
				// 计算本轮耗时：向前查找最近的 user 消息 timestamp，
				// 用 assistant 的 timestamp 减去它得到总耗时（毫秒）。
				let durationMs: number | undefined;
				const assistantTimestamp = (msg as any).timestamp;
				if (isValidTimestamp(assistantTimestamp)) {
					for (let j = i - 1; j >= 0; j--) {
						const prevMsg = sessionMessages[j];
						if (
							prevMsg &&
							prevMsg.role === 'user' &&
							!prevMsg.subAgentInternal
						) {
							const userTimestamp = (prevMsg as any).timestamp;
							if (isValidTimestamp(userTimestamp)) {
								const diff = assistantTimestamp - userTimestamp;
								if (diff >= 0) {
									durationMs = diff;
								}
							}
							break;
						}
					}
				}
				appendAiCompletionTimeMessage(
					uiMessages,
					assistantTimestamp,
					durationMs,
				);
			}

			continue;
		}
	}

	return uiMessages;
}
