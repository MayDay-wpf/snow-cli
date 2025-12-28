import type {ChatMessage} from '../../api/chat.js';
import type {Message} from '../../ui/components/chat/MessageList.js';
import {formatToolCallMessage} from '../ui/messageFormatter.js';
import {isToolNeedTwoStepDisplay} from '../config/toolDisplayConfig.js';

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
		// 1. Anthropic Extended Thinking
		if (msg.thinking?.thinking) {
			return msg.thinking.thinking;
		}
		// 2. Responses API reasoning summary
		if (msg.reasoning?.summary && Array.isArray(msg.reasoning.summary)) {
			return msg.reasoning.summary
				.map((item: any) => item.text)
				.filter(Boolean)
				.join('\n');
		}
		// 3. DeepSeek R1 reasoning content
		if (msg.reasoning_content && typeof msg.reasoning_content === 'string') {
			return msg.reasoning_content;
		}
		return undefined;
	};

	for (let i = 0; i < sessionMessages.length; i++) {
		const msg = sessionMessages[i];
		if (!msg) continue;

		// Handle sub-agent internal tool call messages
		if (msg.subAgentInternal && msg.role === 'assistant' && msg.tool_calls) {
			// Separate time-consuming tools and quick tools
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

				uiMessages.push({
					role: 'subagent',
					content: `\x1b[38;2;184;122;206m⚇⚡ ${toolDisplay.toolName}\x1b[0m`,
					streaming: false,
					toolCall: {
						name: toolCall.function.name,
						arguments: toolArgs,
					},
					toolCallId: toolCall.id,
					toolPending: false,
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
			const isError = msg.content.startsWith('Error:');

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
				const statusIcon = isError ? '✗' : '✓';
				const statusText = isError ? `\n  └─ ${msg.content}` : '';

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
						toolName === 'filesystem-edit_search')
				) {
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
									filename: resultData.path || resultData.filename,
									completeOldContent: resultData.completeOldContent,
									completeNewContent: resultData.completeNewContent,
									contextStartLine: resultData.contextStartLine,
								},
							};
						} else if (
							resultData.batchResults &&
							Array.isArray(resultData.batchResults)
						) {
							fileToolData = {
								name: toolName,
								arguments: {
									isBatch: true,
									batchResults: resultData.batchResults,
								},
							};
						}
					} catch (e) {
						// Ignore parse errors
					}
				}

				uiMessages.push({
					role: 'subagent',
					content: `\x1b[38;2;0;186;255m⚇${statusIcon} ${toolName}\x1b[0m${statusText}`,
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
					subAgentInternal: true,
				});
			} else {
				// For quick tools, only show errors
				// Success results are handled by updating pendingToolIds in the compact message
				if (isError) {
					const statusText = `\n  └─ ${msg.content}`;
					uiMessages.push({
						role: 'subagent',
						content: `\x1b[38;2;255;100;100m⚇✗ ${toolName}\x1b[0m${statusText}`,
						streaming: false,
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

				// Only add "in progress" message for tools that need two-step display
				const needTwoSteps = isToolNeedTwoStepDisplay(toolCall.function.name);
				if (needTwoSteps) {
					// Add tool call message (in progress)
					uiMessages.push({
						role: 'assistant',
						content: `⚡ ${toolDisplay.toolName}`,
						streaming: false,
						toolCall: {
							name: toolCall.function.name,
							arguments: toolArgs,
						},
						toolDisplay,
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
			const isError = msg.content.startsWith('Error:');
			const isRejectedWithReply = msg.content.includes(
				'Tool execution rejected by user:',
			);
			const statusIcon = isError || isRejectedWithReply ? '✗' : '✓';

			let statusText = '';
			if (isError) {
				statusText = `\n  └─ ${msg.content}`;
			} else if (isRejectedWithReply) {
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
								toolName === 'filesystem-edit_search') &&
							!isError
						) {
							try {
								const resultData = JSON.parse(msg.content);
								// Handle single file edit
								if (resultData.oldContent && resultData.newContent) {
									editDiffData = {
										oldContent: resultData.oldContent,
										newContent: resultData.newContent,
										filename: toolArgs.filePath,
										completeOldContent: resultData.completeOldContent,
										completeNewContent: resultData.completeNewContent,
										contextStartLine: resultData.contextStartLine,
									};
									toolArgs.oldContent = resultData.oldContent;
									toolArgs.newContent = resultData.newContent;
									toolArgs.completeOldContent = resultData.completeOldContent;
									toolArgs.completeNewContent = resultData.completeNewContent;
									toolArgs.contextStartLine = resultData.contextStartLine;
								}
								// Handle batch edit
								else if (
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
				content: `${statusIcon} ${toolName}${statusText}`,
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
			});
			continue;
		}
	}

	return uiMessages;
}
