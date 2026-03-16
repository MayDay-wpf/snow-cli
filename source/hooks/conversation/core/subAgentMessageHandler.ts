import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {SubAgentMessage} from '../../../utils/execution/subAgentExecutor.js';
import {formatToolCallMessage} from '../../../utils/ui/messageFormatter.js';
import {isToolNeedTwoStepDisplay} from '../../../utils/config/toolDisplayConfig.js';

type CtxUsage = {percentage: number; inputTokens: number; maxTokens: number};

type StreamState = {
	tokenCount: number;
	lastTokenFlushTime: number;
	thinkingLineBuffer: string;
	contentLineBuffer: string;
	fullThinkingContent: string;
	fullContent: string;
	hasReceivedContentChunk: boolean;
	isFirstStreamLine: boolean;
	hasStartedContent: boolean;
	hasEmittedStreamLine: boolean;
	inCodeBlock: boolean;
	codeBlockBuffer: string;
	tableBuffer: string;
	listBuffer: string;
};

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

function extractRejectionReason(content: string): string | undefined {
	const match = content.match(
		/^Error: Tool execution rejected by user:([\s\S]+)$/,
	);
	return match?.[1]?.trim() || undefined;
}

/**
 * Manages sub-agent message handling with internal streaming state.
 * Encapsulates the token counting accumulators and context usage tracking
 * that were previously closure variables in useConversation.
 */
export class SubAgentUIHandler {
	readonly latestCtxUsage: Record<string, CtxUsage> = {};
	private readonly streamStates: Record<string, StreamState> = {};
	private readonly activeReasoningAgents = new Set<string>();
	private readonly FLUSH_INTERVAL = 100;

	constructor(
		private encoder: any,
		private setStreamTokenCount: (count: number) => void,
		private saveMessage: (msg: any) => Promise<void>,
		private setIsReasoning?: (isReasoning: boolean) => void,
		private streamingEnabled: boolean = true,
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
			case 'reasoning_started':
				return this.handleReasoningStarted(prev, subAgentMessage);
			case 'reasoning_delta':
				return this.handleReasoningDelta(prev, subAgentMessage);
			case 'tool_call_delta':
				return this.handleToolCallDelta(prev, subAgentMessage);
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

	private createInitialStreamState(): StreamState {
		return {
			tokenCount: 0,
			lastTokenFlushTime: 0,
			thinkingLineBuffer: '',
			contentLineBuffer: '',
			fullThinkingContent: '',
			fullContent: '',
			hasReceivedContentChunk: false,
			isFirstStreamLine: true,
			hasStartedContent: false,
			hasEmittedStreamLine: false,
			inCodeBlock: false,
			codeBlockBuffer: '',
			tableBuffer: '',
			listBuffer: '',
		};
	}

	private getStreamState(agentId: string): StreamState {
		if (!this.streamStates[agentId]) {
			this.streamStates[agentId] = this.createInitialStreamState();
		}
		return this.streamStates[agentId]!;
	}

	private clearStreamState(agentId: string): void {
		delete this.streamStates[agentId];
		this.updateGlobalTokenCount();
	}

	private updateGlobalTokenCount(): void {
		const total = Object.values(this.streamStates).reduce(
			(sum, state) => sum + state.tokenCount,
			0,
		);
		this.setStreamTokenCount(total);
	}

	private setAgentReasoning(agentId: string, isReasoning: boolean): void {
		if (isReasoning) {
			this.activeReasoningAgents.add(agentId);
		} else {
			this.activeReasoningAgents.delete(agentId);
		}
		this.setIsReasoning?.(this.activeReasoningAgents.size > 0);
	}

	private addTokens(agentId: string, text: string): void {
		const state = this.getStreamState(agentId);
		try {
			const deltaTokens = this.encoder.encode(text);
			state.tokenCount += deltaTokens.length;
		} catch {
			// Ignore encoding errors
		}
	}

	private shouldFlush(state: StreamState, now: number): boolean {
		return now - state.lastTokenFlushTime >= this.FLUSH_INTERVAL;
	}

	private flushTokenCount(agentId: string, now: number): void {
		const state = this.getStreamState(agentId);
		this.updateGlobalTokenCount();
		state.lastTokenFlushTime = now;
	}

	private emitStreamLine(
		lines: Message[],
		state: StreamState,
		subAgentMessage: SubAgentMessage,
		content: string,
		isThinking: boolean,
	): void {
		if (!this.streamingEnabled) {
			return;
		}

		const isFirst = state.isFirstStreamLine;
		const isFirstContent = !isThinking && !state.hasStartedContent;
		if (isFirst) state.isFirstStreamLine = false;
		if (isFirstContent) state.hasStartedContent = true;
		state.hasEmittedStreamLine = true;

		lines.push({
			role: 'assistant' as const,
			content,
			streamingLine: true,
			isThinkingLine: isThinking,
			isFirstStreamLine: isFirst,
			isFirstContentLine: isFirstContent,
			subAgent: {
				agentId: subAgentMessage.agentId,
				agentName: subAgentMessage.agentName,
				isComplete: false,
			},
			subAgentInternal: true,
		});
	}

	private cleanThinkingContent(content: string): string {
		return content.replace(/\s*<\/?think(?:ing)?>\s*/gi, '');
	}

	private flushThinkingBuffer(
		state: StreamState,
		lines: Message[],
		subAgentMessage: SubAgentMessage,
	): void {
		if (state.hasReceivedContentChunk || !state.thinkingLineBuffer) {
			state.thinkingLineBuffer = '';
			return;
		}

		const cleaned = this.cleanThinkingContent(state.thinkingLineBuffer);
		if (cleaned.trim()) {
			this.emitStreamLine(lines, state, subAgentMessage, cleaned, true);
		}
		state.thinkingLineBuffer = '';
	}

	private isTableRow(line: string): boolean {
		const trimmedLine = line.trim();
		return (
			trimmedLine.startsWith('|') &&
			trimmedLine.endsWith('|') &&
			trimmedLine.length > 2
		);
	}

	private isListItemLine(line: string): boolean {
		return /^\s*\d+[.)]\s/.test(line) || /^\s*[-*+]\s/.test(line);
	}

	private processContentLine(
		state: StreamState,
		lines: Message[],
		line: string,
		subAgentMessage: SubAgentMessage,
	): void {
		if (state.inCodeBlock) {
			state.codeBlockBuffer += line + '\n';
			if (line.trimStart().startsWith('```')) {
				state.inCodeBlock = false;
				this.emitStreamLine(
					lines,
					state,
					subAgentMessage,
					state.codeBlockBuffer.trimEnd(),
					false,
				);
				state.codeBlockBuffer = '';
			}
			return;
		}

		if (line.trimStart().startsWith('```')) {
			if (state.tableBuffer) {
				this.emitStreamLine(
					lines,
					state,
					subAgentMessage,
					state.tableBuffer.trimEnd(),
					false,
				);
				state.tableBuffer = '';
			}
			if (state.listBuffer) {
				this.emitStreamLine(
					lines,
					state,
					subAgentMessage,
					state.listBuffer.trimEnd(),
					false,
				);
				state.listBuffer = '';
			}
			state.inCodeBlock = true;
			state.codeBlockBuffer = line + '\n';
			return;
		}

		if (this.isTableRow(line)) {
			if (state.listBuffer) {
				this.emitStreamLine(
					lines,
					state,
					subAgentMessage,
					state.listBuffer.trimEnd(),
					false,
				);
				state.listBuffer = '';
			}
			state.tableBuffer += line + '\n';
			return;
		}

		if (state.tableBuffer) {
			this.emitStreamLine(
				lines,
				state,
				subAgentMessage,
				state.tableBuffer.trimEnd(),
				false,
			);
			state.tableBuffer = '';
		}

		if (this.isListItemLine(line)) {
			state.listBuffer += line + '\n';
			return;
		}

		if (state.listBuffer && (line.trim() === '' || /^\s{2,}/.test(line))) {
			state.listBuffer += line + '\n';
			return;
		}

		if (state.listBuffer) {
			this.emitStreamLine(
				lines,
				state,
				subAgentMessage,
				state.listBuffer.trimEnd(),
				false,
			);
			state.listBuffer = '';
		}

		this.emitStreamLine(lines, state, subAgentMessage, line, false);
	}

	private flushRemainingContentBuffers(
		state: StreamState,
		lines: Message[],
		subAgentMessage: SubAgentMessage,
	): void {
		if (state.contentLineBuffer.trim()) {
			this.processContentLine(
				state,
				lines,
				state.contentLineBuffer,
				subAgentMessage,
			);
			state.contentLineBuffer = '';
		}
		if (state.codeBlockBuffer) {
			this.emitStreamLine(
				lines,
				state,
				subAgentMessage,
				state.codeBlockBuffer.trimEnd(),
				false,
			);
			state.codeBlockBuffer = '';
		}
		if (state.tableBuffer) {
			this.emitStreamLine(
				lines,
				state,
				subAgentMessage,
				state.tableBuffer.trimEnd(),
				false,
			);
			state.tableBuffer = '';
		}
		if (state.listBuffer) {
			this.emitStreamLine(
				lines,
				state,
				subAgentMessage,
				state.listBuffer.trimEnd(),
				false,
			);
			state.listBuffer = '';
		}
	}

	private persistCompletedResponse(
		state: StreamState,
		subAgentMessage: SubAgentMessage,
	): void {
		const hasContent = state.fullContent.trim().length > 0;
		const hasThinking =
			this.cleanThinkingContent(state.fullThinkingContent).trim().length > 0;
		if (!hasContent && !hasThinking) {
			return;
		}

		const sessionMsg = {
			role: 'assistant' as const,
			content: hasContent ? state.fullContent : '',
			thinking: hasThinking
				? {
						type: 'thinking' as const,
						thinking: state.fullThinkingContent.trim(),
				  }
				: undefined,
			subAgentInternal: true,
			subAgentContent: true,
			subAgent: {
				agentId: subAgentMessage.agentId,
				agentName: subAgentMessage.agentName,
				isComplete: true,
			},
		};
		this.saveMessage(sessionMsg).catch(err =>
			console.error('Failed to save sub-agent content:', err),
		);
	}

	private resetRoundState(state: StreamState): void {
		state.tokenCount = 0;
		state.lastTokenFlushTime = 0;
		state.thinkingLineBuffer = '';
		state.contentLineBuffer = '';
		state.fullThinkingContent = '';
		state.fullContent = '';
		state.hasReceivedContentChunk = false;
		state.isFirstStreamLine = true;
		state.hasStartedContent = false;
		state.hasEmittedStreamLine = false;
		state.inCodeBlock = false;
		state.codeBlockBuffer = '';
		state.tableBuffer = '';
		state.listBuffer = '';
		this.updateGlobalTokenCount();
	}

	private handleReasoningStarted(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const state = this.getStreamState(subAgentMessage.agentId);
		if (!state.hasReceivedContentChunk) {
			this.setAgentReasoning(subAgentMessage.agentId, true);
		}
		return prev;
	}

	private handleReasoningDelta(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const state = this.getStreamState(subAgentMessage.agentId);
		if (!state.hasReceivedContentChunk) {
			this.setAgentReasoning(subAgentMessage.agentId, true);
		}
		const incomingDelta = subAgentMessage.message.delta;
		if (!incomingDelta) {
			return prev;
		}

		state.fullThinkingContent += incomingDelta;
		this.addTokens(subAgentMessage.agentId, incomingDelta);
		const now = Date.now();
		if (this.shouldFlush(state, now)) {
			this.flushTokenCount(subAgentMessage.agentId, now);
		}
		if (state.hasReceivedContentChunk || !this.streamingEnabled) {
			return prev;
		}

		const newLines: Message[] = [];
		state.thinkingLineBuffer += incomingDelta;
		const thinkLines = state.thinkingLineBuffer.split('\n');
		for (let i = 0; i < thinkLines.length - 1; i++) {
			const cleaned = this.cleanThinkingContent(thinkLines[i] ?? '');
			if (cleaned || state.hasEmittedStreamLine) {
				this.emitStreamLine(newLines, state, subAgentMessage, cleaned, true);
			}
		}
		state.thinkingLineBuffer = thinkLines[thinkLines.length - 1] ?? '';
		return newLines.length > 0 ? [...prev, ...newLines] : prev;
	}

	private handleToolCallDelta(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const state = this.getStreamState(subAgentMessage.agentId);
		this.setAgentReasoning(subAgentMessage.agentId, false);
		const incomingDelta = subAgentMessage.message.delta;
		if (!incomingDelta) {
			return prev;
		}

		this.addTokens(subAgentMessage.agentId, incomingDelta);
		const now = Date.now();
		if (this.shouldFlush(state, now)) {
			this.flushTokenCount(subAgentMessage.agentId, now);
		}
		return prev;
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
				content: `\x1b[36m⚇ ${
					subAgentMessage.agentName
				}\x1b[0m \x1b[32m✵ Context compressed (~${formatTokenCount(
					msg.beforeTokens,
				)} → ~${formatTokenCount(msg.afterTokensEstimate)})\x1b[0m`,
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
				messageStatus: msg.success ? ('success' as const) : ('error' as const),
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
			? msg.spawnedPrompt
					.replace(/[\r\n]+/g, ' ')
					.replace(/\s+/g, ' ')
					.trim()
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
				messageStatus: msg.success ? ('success' as const) : ('error' as const),
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
		this.setAgentReasoning(subAgentMessage.agentId, false);
		const state = this.getStreamState(subAgentMessage.agentId);
		const pendingStreamLines: Message[] = [];
		if (!state.hasReceivedContentChunk) {
			this.flushThinkingBuffer(state, pendingStreamLines, subAgentMessage);
		} else {
			state.thinkingLineBuffer = '';
		}
		this.flushRemainingContentBuffers(
			state,
			pendingStreamLines,
			subAgentMessage,
		);

		const toolCalls = subAgentMessage.message.tool_calls;
		if (!toolCalls || toolCalls.length === 0) {
			return pendingStreamLines.length > 0
				? [...prev, ...pendingStreamLines]
				: prev;
		}

		this.persistCompletedResponse(state, subAgentMessage);
		this.resetRoundState(state);

		const internalAgentTools = new Set([
			'send_message_to_agent',
			'query_agents_status',
			'spawn_sub_agent',
		]);
		const displayableToolCalls = toolCalls.filter(
			(tc: any) => !internalAgentTools.has(tc.function.name),
		);

		if (displayableToolCalls.length === 0) {
			return pendingStreamLines.length > 0
				? [...prev, ...pendingStreamLines]
				: prev;
		}

		const timeConsumingTools = displayableToolCalls.filter((tc: any) =>
			isToolNeedTwoStepDisplay(tc.function.name),
		);
		const quickTools = displayableToolCalls.filter(
			(tc: any) => !isToolNeedTwoStepDisplay(tc.function.name),
		);

		const newMessages: Message[] = [];
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
			if (toolCall.function.name === 'terminal-execute' && toolArgs.command) {
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
				return `\n  \x1b[2m${prefix} ${display.toolName}${
					params ? ` (${params})` : ''
				}\x1b[0m`;
			});

			newMessages.push({
				role: 'subagent' as const,
				content: `\x1b[36m⚇ ${subAgentMessage.agentName}\x1b[0m${toolLines.join(
					'',
				)}`,
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
			subAgent: {
				agentId: subAgentMessage.agentId,
				agentName: subAgentMessage.agentName,
				isComplete: false,
			},
			tool_calls: toolCalls,
		};
		this.saveMessage(sessionMsg).catch(err =>
			console.error('Failed to save sub-agent tool call:', err),
		);

		const combinedMessages = [...pendingStreamLines, ...newMessages];
		return combinedMessages.length > 0 ? [...prev, ...combinedMessages] : prev;
	}

	private handleToolResult(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const msg = subAgentMessage.message as any;
		const isError = msg.content.startsWith('Error:');
		const isTimeConsuming = isToolNeedTwoStepDisplay(msg.tool_name);
		const rejectionReason = isError
			? msg.rejection_reason || extractRejectionReason(msg.content)
			: undefined;

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
			return this.handleTimeConsumingToolResult(
				prev,
				subAgentMessage,
				msg,
				isError,
			);
		}

		// Quick tool: error → new message, success → update pending
		if (isError) {
			const statusText = rejectionReason
				? `\n  └─ Rejection reason: ${rejectionReason}`
				: '';
			return [
				...prev,
				{
					role: 'subagent' as const,
					content: `\x1b[38;2;255;100;100m⚇✗ ${msg.tool_name}\x1b[0m${statusText}`,
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
		const rejectionReason = isError
			? extractRejectionReason(msg.content)
			: undefined;

		let terminalResultData: any;
		if (msg.tool_name === 'terminal-execute' && !isError) {
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
								resultData.filePath || resultData.path || resultData.filename,
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

		const statusText = rejectionReason
			? `\n  └─ Rejection reason: ${rejectionReason}`
			: '';

		return [
			...prev,
			{
				role: 'subagent' as const,
				content: `\x1b[38;2;0;186;255m⚇${statusIcon} ${msg.tool_name}\x1b[0m${statusText}`,
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
		const state = this.getStreamState(subAgentMessage.agentId);
		this.setAgentReasoning(subAgentMessage.agentId, false);
		const incomingContent = subAgentMessage.message.content;
		if (!incomingContent) {
			return prev;
		}

		state.fullContent += incomingContent;
		this.addTokens(subAgentMessage.agentId, incomingContent);
		const now = Date.now();
		if (this.shouldFlush(state, now)) {
			this.flushTokenCount(subAgentMessage.agentId, now);
		}

		const isFirstContentChunk = !state.hasReceivedContentChunk;
		state.hasReceivedContentChunk = true;
		if (!this.streamingEnabled) {
			return prev;
		}

		const newLines: Message[] = [];
		if (isFirstContentChunk) {
			this.flushThinkingBuffer(state, newLines, subAgentMessage);
		}

		state.contentLineBuffer += incomingContent;
		const contentLines = state.contentLineBuffer.split('\n');
		for (let i = 0; i < contentLines.length - 1; i++) {
			this.processContentLine(
				state,
				newLines,
				contentLines[i] ?? '',
				subAgentMessage,
			);
		}
		state.contentLineBuffer = contentLines[contentLines.length - 1] ?? '';
		return newLines.length > 0 ? [...prev, ...newLines] : prev;
	}

	private handleDone(
		prev: Message[],
		subAgentMessage: SubAgentMessage,
	): Message[] {
		const state = this.getStreamState(subAgentMessage.agentId);
		this.setAgentReasoning(subAgentMessage.agentId, false);
		const finalLines: Message[] = [];
		if (!state.hasReceivedContentChunk) {
			this.flushThinkingBuffer(state, finalLines, subAgentMessage);
		} else {
			state.thinkingLineBuffer = '';
		}
		this.flushRemainingContentBuffers(state, finalLines, subAgentMessage);
		this.persistCompletedResponse(state, subAgentMessage);
		this.clearStreamState(subAgentMessage.agentId);
		return finalLines.length > 0 ? [...prev, ...finalLines] : prev;
	}
}
