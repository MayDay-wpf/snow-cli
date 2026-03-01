import type {ContextInfo, ContextInfoMessage, TokenUsageInfo} from './types.js';
import type {StateManager} from './stateManager.js';

// Global token usage storage - updated by ChatScreen
let globalTokenUsage: TokenUsageInfo | null = null;

/**
 * Update global token usage - called by ChatScreen when contextUsage changes
 */
export function updateGlobalTokenUsage(usage: TokenUsageInfo | null): void {
	globalTokenUsage = usage;
}

/**
 * Get current global token usage
 */
export function getGlobalTokenUsage(): TokenUsageInfo | null {
	return globalTokenUsage;
}

export class ContextManager {
	private readonly MAX_TOOL_CONTENT_LENGTH = 500;
	private stateManager: StateManager;

	// 不截断的工具列表 - 这些工具的消息内容不会被截断
	private readonly NON_TRUNCATED_TOOLS = [
		'todo-get',
		'todo-add',
		'todo-update',
		'todo-delete',
		'filesystem-create',
		'filesystem-edit_search',
		'filesystem-edit',
	];

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager;
	}

	// Truncate text if it exceeds max length
	private truncateText(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return (
			text.substring(0, maxLength) +
			`... [truncated ${text.length - maxLength} chars]`
		);
	}

	// 检查工具是否需要截断
	// 如果工具名在白名单中，返回 false（不截断）
	private shouldTruncateTool(
		toolCallId: string | undefined,
		toolCallIdToName: Map<string, string>,
	): boolean {
		if (!toolCallId) return true; // 如果没有 tool_call_id，默认截断
		const toolName = toolCallIdToName.get(toolCallId);
		if (!toolName) return true; // 如果找不到工具名，默认截断
		return !this.NON_TRUNCATED_TOOLS.includes(toolName);
	}

	// Get current conversation messages (real-time chat history)
	async getContextInfo(): Promise<string> {
		try {
			// Import sessionManager dynamically to avoid circular dependency
			const {sessionManager} = await import('../session/sessionManager.js');

			const currentSession = sessionManager.getCurrentSession();
			if (!currentSession) {
				return JSON.stringify({
					error: 'No active conversation session',
					timestamp: new Date().toISOString(),
				});
			}

			// Get conversation messages with tool content truncation
			// 首先建立 tool_call_id 到工具名的映射
			const toolCallIdToName = new Map<string, string>();
			for (const msg of currentSession.messages) {
				if (msg.tool_calls) {
					for (const tc of msg.tool_calls) {
						toolCallIdToName.set(tc.id, tc.function.name);
					}
				}
			}

			const messages: ContextInfoMessage[] = currentSession.messages.map(
				msg => {
					// Handle tool role messages - truncate content if too large
					let content: string;
					if (typeof msg.content === 'string') {
						content =
							msg.role === 'tool'
								? this.shouldTruncateTool(msg.tool_call_id, toolCallIdToName)
									? this.truncateText(msg.content, this.MAX_TOOL_CONTENT_LENGTH)
									: msg.content
								: msg.content;
					} else {
						const contentStr = JSON.stringify(msg.content);
						content =
							msg.role === 'tool'
								? this.shouldTruncateTool(msg.tool_call_id, toolCallIdToName)
									? this.truncateText(contentStr, this.MAX_TOOL_CONTENT_LENGTH)
									: contentStr
								: contentStr;
					}

					// Handle tool_calls truncation for assistant messages
					let toolCalls = msg.tool_calls;
					if (toolCalls && toolCalls.length > 0) {
						toolCalls = toolCalls.map(tc => ({
							...tc,
							function: {
								...tc.function,
								arguments: this.truncateText(
									tc.function.arguments,
									this.MAX_TOOL_CONTENT_LENGTH,
								),
							},
						}));
					}

					return {
						role: msg.role,
						content,
						timestamp: msg.timestamp,
						// Include tool calls if present (truncated)
						...(toolCalls && {tool_calls: toolCalls}),
						...(msg.tool_call_id && {tool_call_id: msg.tool_call_id}),
					};
				},
			);

			// Get token usage from global storage
			const tokenUsage = getGlobalTokenUsage();
			// Calculate percentage if not already calculated
			if (tokenUsage && tokenUsage.max_tokens && tokenUsage.max_tokens > 0) {
				const isAnthropic =
					(tokenUsage.cache_creation_input_tokens || 0) > 0 ||
					(tokenUsage.cache_read_input_tokens || 0) > 0;
				const totalInputTokens = isAnthropic
					? tokenUsage.prompt_tokens +
					  (tokenUsage.cache_creation_input_tokens || 0) +
					  (tokenUsage.cache_read_input_tokens || 0)
					: tokenUsage.prompt_tokens;
				tokenUsage.percentage = Math.min(
					100,
					(totalInputTokens / tokenUsage.max_tokens) * 100,
				);
			}

			const contextInfo: ContextInfo = {
				sessionId: currentSession.id,
				sessionTitle: currentSession.title,
				messageCount: currentSession.messageCount,
				messages: messages,
				inFlightState: this.stateManager.getInFlightState(),
				...(tokenUsage && {tokenUsage}),
				timestamp: new Date().toISOString(),
			};

			return JSON.stringify(contextInfo);
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
				timestamp: new Date().toISOString(),
			});
		}
	}

	// Setup message listener to auto-push updates
	setupMessageListener(
		pushContextInfo: () => Promise<void>,
	): Promise<() => void> {
		// Import sessionManager and setup listener for all message changes
		return import('../session/sessionManager.js')
			.then(({sessionManager}) => {
				// Listen for all message list changes (add, truncate, switch session, clear, etc.)
				return sessionManager.onMessagesChanged(() => {
					// Push context info when messages change
					void pushContextInfo();
				});
			})
			.catch(() => {
				// Return no-op on error
				return () => {};
			});
	}
}
