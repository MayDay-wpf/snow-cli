import {getSnowConfig} from '../config/apiConfig.js';
import {
	createStreamingChatCompletion,
	type ChatMessage,
} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {sessionManager} from '../session/sessionManager.js';

const BTW_SYSTEM_SUFFIX = `
The user is asking a quick side-question while the main AI task is still running.
Answer concisely and helpfully. Do NOT reference or modify any ongoing task.
This is a temporary, context-aware Q&A — your answer will NOT be saved into the conversation history.
Keep your response brief and focused on the question asked.`;

/**
 * Build context from the current session for the btw side-question.
 * Uses session messages snapshot after PendingMessage-compatible send timing.
 */
function buildContextMessages(): ChatMessage[] {
	const session = sessionManager.getCurrentSession();
	if (!session || session.messages.length === 0) return [];

	const mapped: ChatMessage[] = session.messages.map(m => ({
		role: m.role as 'user' | 'assistant' | 'system' | 'tool',
		content: typeof m.content === 'string' ? m.content : '',
		...(m.tool_call_id ? {tool_call_id: m.tool_call_id} : {}),
		...(m.tool_calls ? {tool_calls: m.tool_calls} : {}),
	}));

	return sanitizeMessagesForApi(mapped);
}

/**
 * 修复会话快照中的 tool_call 一致性问题。
 *
 * btw 侧问在主任务仍在运行时发起，此时会话尾部可能停在一个尚未闭合的
 * tool_call 轮次上（assistant 已带 tool_calls，但对应的 tool 结果还没写入），
 * 也可能存在孤立的 tool 结果消息。这类消息直接发给 OpenAI 兼容接口会返回
 * `invalid_request_error: No tool output found for function call ...`。
 *
 * 处理规则：
 * - 完整的 tool_call 轮次（所有 tool_calls 都有对应结果）原样保留；
 * - 未闭合的轮次只保留 assistant 的文本内容，丢弃未应答的 tool_calls 与其部分结果；
 * - 找不到对应 assistant tool_calls 的孤立 tool 消息直接丢弃。
 */
export function sanitizeMessagesForApi(messages: ChatMessage[]): ChatMessage[] {
	const result: ChatMessage[] = [];
	let openAssistant: ChatMessage | null = null;
	let openToolResults: ChatMessage[] = [];
	let pendingCallIds = new Set<string>();

	const flushOpenRound = () => {
		if (!openAssistant) return;

		if (pendingCallIds.size === 0) {
			// 完整轮次：assistant 与其全部 tool 结果一起保留
			result.push(openAssistant, ...openToolResults);
		} else {
			// 未闭合轮次：仅保留 assistant 文本，丢弃未应答的 tool_calls
			const rest: ChatMessage = {...openAssistant};
			delete (rest as {tool_calls?: unknown}).tool_calls;
			if (typeof rest.content === 'string' && rest.content.trim().length > 0) {
				result.push(rest);
			}
		}

		openAssistant = null;
		openToolResults = [];
		pendingCallIds = new Set<string>();
	};

	for (const m of messages) {
		if (!m) continue;

		if (m.role === 'tool') {
			if (m.tool_call_id && pendingCallIds.has(m.tool_call_id)) {
				pendingCallIds.delete(m.tool_call_id);
				openToolResults.push(m);
			}
			// 孤立 tool 结果（没有匹配的 assistant tool_calls）直接丢弃
			continue;
		}

		if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
			flushOpenRound();
			openAssistant = m;
			pendingCallIds = new Set(m.tool_calls.map(tc => tc.id));
			continue;
		}

		flushOpenRound();
		result.push(m);
	}

	flushOpenRound();

	return result;
}

/**
 * Stream a btw side-question response.
 * Inherits the current conversation context but does NOT persist anything.
 */
export async function* streamBtwResponse(
	question: string,
	abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
	const config = getSnowConfig();
	const model = config.basicModel || config.advancedModel;
	if (!model) {
		throw new Error('No model configured');
	}

	const contextMessages = buildContextMessages();

	const messages: ChatMessage[] = [
		...contextMessages,
		{
			role: 'user',
			content: `[BTW Side-Question]\n${question}\n${BTW_SYSTEM_SUFFIX}`,
		},
	];

	let stream: AsyncGenerator<any, void, unknown>;

	switch (config.requestMethod) {
		case 'anthropic':
			stream = createStreamingAnthropicCompletion(
				{
					model,
					messages,
					max_tokens: 2048,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;

		case 'gemini':
			stream = createStreamingGeminiCompletion(
				{
					model,
					messages,
					max_tokens: 2048,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;

		case 'responses':
			stream = createStreamingResponse(
				{
					model,
					messages,
					stream: true,
					max_tokens: 2048,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;

		case 'chat':
		default:
			stream = createStreamingChatCompletion(
				{
					model,
					messages,
					stream: true,
					max_tokens: 2048,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;
	}

	for await (const chunk of stream) {
		if (abortSignal?.aborted) break;

		if (chunk && typeof chunk === 'object') {
			if (chunk.type === 'content' && typeof chunk.content === 'string') {
				yield chunk.content;
				continue;
			}
			const deltaContent = (chunk as any).choices?.[0]?.delta?.content;
			if (typeof deltaContent === 'string') {
				yield deltaContent;
			}
		}
	}
}
