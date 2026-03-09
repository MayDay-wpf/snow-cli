import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {SubAgentMessage} from '../../../utils/execution/subAgentExecutor.js';
import {formatToolCallMessage} from '../../../utils/ui/messageFormatter.js';
import {isToolNeedTwoStepDisplay} from '../../../utils/config/toolDisplayConfig.js';

type CtxUsage = {percentage: number; inputTokens: number; maxTokens: number};

/**
 * Format token count for display (e.g., 1234 → "1.2K", 123456 → "123K")
 */
function formatTokenCount(tokens: number | undefined): string {
	if (!tokens) return '0';
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}K`;
	}
	return String(tokens);
}

/**
 * Manages sub-agent message handling with internal streaming state.
 * Encapsulates the token counting accumulators and context usage tracking
 * that were previously closure variables in useConversation.
 */
export class SubAgentUIHandler {
	readonly latestCtxUsage: Record<string, CtxUsage> = {};
	private contentAccumulator = '';
	private contentBuffer = '';
	private tokenCount = 0;
	private lastFlushTime = 0;
	private readonly FLUSH_INTERVAL = 100;

	constructor(
		private encoder: any,
		private setStreamTokenCount: (count: number) => void,
		private saveMessage: (msg: any) => Promise<void>,
	) {}

	/**
	 * Process a sub-agent message and return the updated messages array.
	 * Designed to be called inside setMessages(prev => handler.handleMessage(prev, msg)).
	 */
	handleMessage(prev: Message[], subAgentMessage: SubAgentMessage): Message[] {
		const {message} = subAgentMessage;

		switch (message.type) {
			case 'context_usage':
				return this.handleContextUsage(prev, subAgentMessage);
			case 'context_compressing':
				return this.handleContextCompressing(prev, subAgentMessage);
			case 'context_compressed':
				return this.handleContextCompressed(prev, subAgentMessage);
			case 'inter_agent_sent':
				return this.handleInterAgentSent(prev, subAgentMessage);
			case 'inter_agent_received':
				return prev;
			case 'agent_spawned':
				return this.handleAgentSpawned(prev, subAgentMessage);
			case 'spawned_agent_completed':
				return this.handleSpawnedAgentCompleted(prev, subAgentMessage);
			case 'tool_calls':
				return this.handleToolCalls(prev, subAgentMessage);
			case 'tool_result':
				return this.handleToolResult(prev, subAgentMessage);
			case 'content':
				return this.handleContent(prev, subAgentMessage);
			case 'done':
				return this.handleDone(prev, subAgentMessage);
			default:
				return prev;
		}
	}

	private handleContextUsage(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const ctxData = {
			percentage: subAgentMessage.message.percentage,
			inputTokens: subAgentMessage.message.inputTokens,
			maxTokens: subAgentMessage.message.maxTokens,
		};
		this.latestCtxUsage[subAgentMessage.agentId] = ctxData;

		let targetIndex = -1;
		for (let i = prev.length - 1; i >= 0; i--) {
			const m = prev[i];
			if (
				m &&
				m.role === 'subagent' &&
				m.subAgent?.agentId === subAgentMessage.agentId
			) {
				targetIndex = i;
				break;
			}
		}
		if (targetIndex !== -1) {
			const updated = [...prev];
			const existing = updated[targetIndex];
			if (existing) {
				updated[targetIndex] = {...existing, subAgentContextUsage: ctxData};
			}
			return updated;
		}
		return prev;
	}

	private handleContextCompressing(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		return [
			...prev,
			{
				role: 'subagent' as const,
				content: `\x1b[36m⚇ ${subAgentMessage.agentName}\x1b[0m \x1b[33m✵ Auto-compressing context (${subAgentMessage.message.percentage}%)...\x1b[0m`,
				streaming: false,
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
			},
		];
	}

	private handleContextCompressed(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const msg = subAgentMessage.message as any;
		return [
			...prev,
			{
				role: 'subagent' as const,
				content: `\x1b[36m⚇ ${subAgentMessage.agentName}\x1b[0m \x1b[32m✵ Context compressed (~${formatTokenCount(msg.beforeTokens)} → ~${formatTokenCount(msg.afterTokensEstimate)})\x1b[0m`,
				streaming: false,
				messageStatus: 'success' as const,
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
			},
		];
	}

	private handleInterAgentSent(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const msg = subAgentMessage.message as any;
		const statusIcon = msg.success ? '→' : '✗';
		const targetName = msg.targetAgentName || msg.targetAgentId;
		const truncatedContent =
			msg.content.length > 80
				? msg.content.substring(0, 80) + '...'
				: msg.content;
		return [
			...prev,
			{
				role: 'subagent' as const,
				content: `\x1b[38;2;255;165;0m⚇${statusIcon} [${subAgentMessage.agentName}] → [${targetName}]\x1b[0m: ${truncatedContent}`,
				streaming: false,
				messageStatus: msg.success
					? ('success' as const)
					: ('error' as const),
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
			},
		];
	}

	private handleAgentSpawned(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const msg = subAgentMessage.message as any;
		const promptText = msg.spawnedPrompt
			? msg.spawnedPrompt.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
			: '';
		const truncatedPrompt =
			promptText.length > 100
				? promptText.substring(0, 100) + '...'
				: promptText;
		const promptLine = truncatedPrompt
			? `\n  \x1b[2m└─ prompt: "${truncatedPrompt}"\x1b[0m`
			: '';
		return [
			...prev,
			{
				role: 'subagent' as const,
				content: `\x1b[38;2;150;120;255m⚇⊕ [${subAgentMessage.agentName}] spawned [${msg.spawnedAgentName}]\x1b[0m${promptLine}`,
				streaming: false,
				messageStatus: 'success' as const,
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
			},
		];
	}

	private handleSpawnedAgentCompleted(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const msg = subAgentMessage.message as any;
		const statusIcon = msg.success ? '✓' : '✗';
		return [
			...prev,
			{
				role: 'subagent' as const,
				content: `\x1b[38;2;150;120;255m⚇${statusIcon} Spawned [${msg.spawnedAgentName}] completed\x1b[0m (parent: ${subAgentMessage.agentName})`,
				streaming: false,
				messageStatus: msg.success
					? ('success' as const)
					: ('error' as const),
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
			},
		];
	}

	private handleToolCalls(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const toolCalls = subAgentMessage.message.tool_calls;
		if (!toolCalls || toolCalls.length === 0) return prev;

		const internalAgentTools = new Set([
			'send_message_to_agent',
			'query_agents_status',
			'spawn_sub_agent',
		]);
		const displayableToolCalls = toolCalls.filter(
			(tc: any) => !internalAgentTools.has(tc.function.name),
		);

		if (displayableToolCalls.length === 0) return prev;

		const timeConsumingTools = displayableToolCalls.filter((tc: any) =>
			isToolNeedTwoStepDisplay(tc.function.name),
		);
		const quickTools = displayableToolCalls.filter(
			(tc: any) => !isToolNeedTwoStepDisplay(tc.function.name),
		);

		const newMessages: any[] = [];
		const inheritedCtxUsage = this.latestCtxUsage[subAgentMessage.agentId];

		// Time-consuming tools: individual messages with full details
		for (const toolCall of timeConsumingTools) {
			const toolDisplay = formatToolCallMessage(toolCall);
			let toolArgs;
			try {
				toolArgs = JSON.parse(toolCall.function.arguments);
			} catch {
				toolArgs = {};
			}

			let paramDisplay = '';
			if (
				toolCall.function.name === 'terminal-execute' &&
				toolArgs.command
			) {
				paramDisplay = ` "${toolArgs.command}"`;
			} else if (toolDisplay.args.length > 0) {
				const params = toolDisplay.args
					.map((arg: any) => `${arg.key}: ${arg.value}`)
					.join(', ');
				paramDisplay = ` (${params})`;
			}

			newMessages.push({
				role: 'subagent' as const,
				content: `\x1b[38;2;184;122;206m⚇⚡ ${toolDisplay.toolName}${paramDisplay}\x1b[0m`,
				streaming: false,
				toolCall: {name: toolCall.function.name, arguments: toolArgs},
				toolCallId: toolCall.id,
				toolPending: true,
				messageStatus: 'pending',
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
				subAgentContextUsage: inheritedCtxUsage,
			});
		}

		// Quick tools: compact tree display
		if (quickTools.length > 0) {
			const toolLines = quickTools.map((tc: any, index: any) => {
				const display = formatToolCallMessage(tc);
				const isLast = index === quickTools.length - 1;
				const prefix = isLast ? '└─' : '├─';
				const params = display.args
					.map((arg: any) => `${arg.key}: ${arg.value}`)
					.join(', ');
				return `\n  \x1b[2m${prefix} ${display.toolName}${params ? ` (${params})` : ''}\x1b[0m`;
			});

			newMessages.push({
				role: 'subagent' as const,
				content: `\x1b[36m⚇ ${subAgentMessage.agentName}\x1b[0m${toolLines.join('')}`,
				streaming: false,
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
				pendingToolIds: quickTools.map((tc: any) => tc.id),
				subAgentContextUsage: inheritedCtxUsage,
			});
		}

		// Fire-and-forget save
		const sessionMsg = {
			role: 'assistant' as const,
			content: toolCalls
				.map((tc: any) => {
					const display = formatToolCallMessage(tc);
					return isToolNeedTwoStepDisplay(tc.function.name)
						? `⚇⚡ ${display.toolName}`
						: `⚇ ${display.toolName}`;
				})
				.join(', '),
			subAgentInternal: true,
			tool_calls: toolCalls,
		};
		this.saveMessage(sessionMsg).catch(err =>
			console.error('Failed to save sub-agent tool call:', err),
		);

		return [...prev, ...newMessages];
	}

	private handleToolResult(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const msg = subAgentMessage.message as any;
		const isError = msg.content.startsWith('Error:');
		const isTimeConsuming = isToolNeedTwoStepDisplay(msg.tool_name);

		// Fire-and-forget save
		const sessionMsg = {
			role: 'tool' as const,
			tool_call_id: msg.tool_call_id,
			content: msg.content,
			messageStatus: isError ? 'error' : 'success',
			subAgentInternal: true,
		};
		this.saveMessage(sessionMsg).catch(err =>
			console.error('Failed to save sub-agent tool result:', err),
		);

		if (isTimeConsuming) {
			return this.handleTimeConsumingToolResult(prev, subAgentMessage, msg, isError);
		}

		// Quick tool: error → new message, success → update pending
		if (isError) {
			return [
				...prev,
				{
					role: 'subagent' as const,
					content: `\x1b[38;2;255;100;100m⚇✗ ${msg.tool_name}\x1b[0m`,
					streaming: false,
					messageStatus: 'error' as const,
					subAgent: {
						agentId: subAgentMessage.agentId,
						agentName: subAgentMessage.agentName,
						isComplete: false,
					},
					subAgentInternal: true,
				},
			];
		}

		// Success: remove from pendingToolIds
		const pendingMsgIndex = prev.findIndex(
			m =>
				m.role === 'subagent' &&
				m.subAgent?.agentId === subAgentMessage.agentId &&
				!m.subAgent?.isComplete &&
				m.pendingToolIds?.includes(msg.tool_call_id),
		);

		if (pendingMsgIndex !== -1) {
			const updated = [...prev];
			const pendingMsg = updated[pendingMsgIndex];
			if (pendingMsg?.pendingToolIds) {
				updated[pendingMsgIndex] = {
					...pendingMsg,
					pendingToolIds: pendingMsg.pendingToolIds.filter(
						id => id !== msg.tool_call_id,
					),
				};
			}
			return updated;
		}

		return prev;
	}

	private handleTimeConsumingToolResult(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
		msg: any,
		isError: boolean,
	): Message[] {
		const statusIcon = isError ? '✗' : '✓';

		let terminalResultData: any;
		if (msg.tool_name === 'terminal-execute' && !isError) {
			try {
				const resultData = JSON.parse(msg.content);
				if (resultData.stdout !== undefined || resultData.stderr !== undefined) {
					terminalResultData = {
						stdout: resultData.stdout,
						stderr: resultData.stderr,
						exitCode: resultData.exitCode,
						command: resultData.command,
					};
				}
			} catch {
				// show regular result
			}
		}

		let fileToolData: any;
		if (
			!isError &&
			(msg.tool_name === 'filesystem-create' ||
				msg.tool_name === 'filesystem-edit' ||
				msg.tool_name === 'filesystem-edit_search')
		) {
			try {
				const resultData = JSON.parse(msg.content);
				if (resultData.content) {
					fileToolData = {
						name: msg.tool_name,
						arguments: {
							content: resultData.content,
							path: resultData.path || resultData.filename,
						},
					};
				} else if (resultData.oldContent && resultData.newContent) {
					fileToolData = {
						name: msg.tool_name,
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
					resultData.batchResults &&
					Array.isArray(resultData.batchResults)
				) {
					fileToolData = {
						name: msg.tool_name,
						arguments: {
							isBatch: true,
							batchResults: resultData.batchResults,
						},
					};
				}
			} catch {
				// show regular result
			}
		}

		return [
			...prev,
			{
				role: 'subagent' as const,
				content: `\x1b[38;2;0;186;255m⚇${statusIcon} ${msg.tool_name}\x1b[0m`,
				streaming: false,
				messageStatus: isError ? 'error' : 'success',
				toolResult: !isError ? msg.content : undefined,
				terminalResult: terminalResultData,
				toolCall: terminalResultData
					? {name: msg.tool_name, arguments: terminalResultData}
					: fileToolData || undefined,
				subAgent: {
					agentId: subAgentMessage.agentId,
					agentName: subAgentMessage.agentName,
					isComplete: false,
				},
				subAgentInternal: true,
			},
		];
	}

	private handleContent(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const incomingContent = subAgentMessage.message.content;
		this.contentAccumulator += incomingContent;
		this.contentBuffer += incomingContent;
		try {
			const deltaTokens = this.encoder.encode(incomingContent);
			this.tokenCount += deltaTokens.length;
		} catch {
			// Ignore encoding errors
		}

		const now = Date.now();
		if (now - this.lastFlushTime < this.FLUSH_INTERVAL) {
			return prev;
		}

		this.setStreamTokenCount(this.tokenCount);
		this.lastFlushTime = now;
		const contentToApply = this.contentBuffer;
		this.contentBuffer = '';

		const existingIndex = this.findStreamingMessageIndex(prev, subAgentMessage.agentId);

		if (existingIndex !== -1 && contentToApply) {
			const updated = [...prev];
			const existing = updated[existingIndex];
			if (existing) {
				updated[existingIndex] = {
					...existing,
					content: (existing.content || '') + contentToApply,
					streaming: true,
				};
			}
			return updated;
		}

		// Do not create text-only sub-agent messages from content chunks
		return prev;
	}

	private handleDone(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const contentToApply = this.contentBuffer;
		this.contentAccumulator = '';
		this.contentBuffer = '';
		this.tokenCount = 0;
		this.lastFlushTime = 0;
		this.setStreamTokenCount(0);

		const existingIndex = this.findStreamingMessageIndex(prev, subAgentMessage.agentId);
		if (existingIndex !== -1) {
			const updated = [...prev];
			const existing = updated[existingIndex];
			if (existing?.subAgent) {
				updated[existingIndex] = {
					...existing,
					content: (existing.content || '') + contentToApply,
					streaming: false,
					subAgent: {...existing.subAgent, isComplete: true},
				};
			}
			return updated;
		}
		return prev;
	}

	private findStreamingMessageIndex(
		messages: Message[],
		agentId: string,
	): number {
		return messages.findIndex(
			m =>
				m.role === 'subagent' &&
				m.subAgent?.agentId === agentId &&
				!m.subAgent?.isComplete &&
				m.streaming === true &&
				!m.pendingToolIds,
		);
	}
}
