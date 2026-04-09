import {getOpenAiConfig} from '../config/apiConfig.js';
import {createStreamingChatCompletion, type ChatMessage} from '../../api/chat.js';
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
 * Trim trailing incomplete tool_call sequences from a messages snapshot.
 * If the last assistant message has tool_calls but not all of them have
 * matching tool-role responses afterwards, truncate from that message onward.
 * This prevents 400 errors when /btw is used mid-tool-execution.
 */
function trimIncompleteToolCalls(msgs: ChatMessage[]): ChatMessage[] {
	if (msgs.length === 0) return msgs;

	let lastAssistantIdx = -1;
	let toolCallIds: string[] = [];

	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i]!;
		if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
			lastAssistantIdx = i;
			toolCallIds = m.tool_calls.map(tc => tc.id);
			break;
		}
	}

	if (lastAssistantIdx === -1) return msgs;

	const resultIds = new Set<string>();
	for (let i = lastAssistantIdx + 1; i < msgs.length; i++) {
		const m = msgs[i]!;
		if (m.role === 'tool' && m.tool_call_id) {
			resultIds.add(m.tool_call_id);
		}
	}

	const incomplete = toolCallIds.some(id => !resultIds.has(id));
	return incomplete ? msgs.slice(0, lastAssistantIdx) : msgs;
}

/**
 * Build context from the current session for the btw side-question.
 * Uses the full session messages without truncation to preserve prompt caching.
 * Trims any incomplete tool_call sequences that arise when /btw is invoked
 * while the main agent is still executing tools.
 */
function buildContextMessages(): ChatMessage[] {
	const session = sessionManager.getCurrentSession();
	if (!session || session.messages.length === 0) return [];

	const mapped = session.messages.map(m => ({
		role: m.role as 'user' | 'assistant' | 'system' | 'tool',
		content: typeof m.content === 'string' ? m.content : '',
		...(m.tool_call_id ? {tool_call_id: m.tool_call_id} : {}),
		...(m.tool_calls ? {tool_calls: m.tool_calls} : {}),
	}));

	return trimIncompleteToolCalls(mapped);
}

/**
 * Stream a btw side-question response.
 * Inherits the current conversation context but does NOT persist anything.
 */
export async function* streamBtwResponse(
	question: string,
	abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
	const config = getOpenAiConfig();
	const model = config.basicModel || config.advancedModel;
	if (!model) {
		throw new Error('No model configured');
	}

	const contextMessages = buildContextMessages();

	const messages: ChatMessage[] = [
		...contextMessages,
		{role: 'user', content: `[BTW Side-Question]\n${question}\n${BTW_SYSTEM_SUFFIX}`},
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
