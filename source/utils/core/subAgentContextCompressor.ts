/**
 * Sub-Agent Context Compressor
 *
 * Two-phase hybrid compression for sub-agent context management:
 * Phase 1: Smart truncation — replace old tool results with compact placeholders (zero extra cost)
 * Phase 2: AI summary compression — if truncation is insufficient, use AI to summarize history
 *
 * This prevents sub-agents from failing due to context_length_exceeded errors.
 */

import {createStreamingChatCompletion} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import type {ChatMessage} from '../../api/types.js';
import type {RequestMethod} from '../config/apiConfig.js';

/** Threshold percentage to trigger compression */
const COMPRESS_THRESHOLD = 70;

/** Number of recent tool call rounds to preserve during truncation */
const KEEP_RECENT_ROUNDS = 3;

/** Minimum tool result length to consider for truncation */
const MIN_TRUNCATION_LENGTH = 500;

/**
 * Compression prompt for sub-agent context — more concise than main session,
 * focused on preserving task progress and tool call context.
 */
const SUB_AGENT_COMPRESSION_PROMPT = `**TASK: Summarize the sub-agent conversation above into a concise handover document.**

You are summarizing a tool-using AI agent's work session. Preserve:

1. **Task objective** — what the agent was asked to do
2. **Key findings** — important information discovered via tool calls (file paths, code snippets, search results)
3. **Actions taken** — files read/modified, commands run, tools used and their outcomes
4. **Current progress** — what's done, what's remaining
5. **Critical context** — exact file paths, function names, error messages, variable values

**Rules:**
- Preserve EXACT technical terms, file paths, and code identifiers
- Be concise but complete — no vague summaries
- Focus on information the agent needs to continue its task
- Use structured format with clear sections

**Output the summary now.**`;

export interface SubAgentCompressionResult {
	compressed: boolean;
	messages: ChatMessage[];
	phase: 'none' | 'truncation' | 'ai_summary';
	beforeTokens?: number;
	afterTokensEstimate?: number;
}

/**
 * Check whether sub-agent context needs compression.
 * @returns percentage of context used (0-100)
 */
export function getContextPercentage(
	latestInputTokens: number,
	maxContextTokens: number,
): number {
	if (!maxContextTokens || maxContextTokens <= 0) return 0;
	return Math.min(100, (latestInputTokens / maxContextTokens) * 100);
}

/**
 * Check if compression should be triggered.
 */
export function shouldCompressSubAgentContext(
	latestInputTokens: number,
	maxContextTokens: number,
): boolean {
	return getContextPercentage(latestInputTokens, maxContextTokens) >= COMPRESS_THRESHOLD;
}

/**
 * Find the start index of the "recent rounds" to preserve.
 * We count backwards from the end, counting N complete tool-call rounds
 * (assistant with tool_calls + corresponding tool results = 1 round).
 */
function findRecentRoundsStartIndex(
	messages: ChatMessage[],
	keepRounds: number,
): number {
	let roundCount = 0;
	let i = messages.length - 1;

	while (i >= 0 && roundCount < keepRounds) {
		const msg = messages[i];

		// When we find tool result messages, trace back to the assistant with tool_calls
		if (msg?.role === 'tool') {
			// Skip all consecutive tool messages (they belong to the same round)
			while (i >= 0 && messages[i]?.role === 'tool') {
				i--;
			}
			// Now i points to the assistant message with tool_calls
			if (i >= 0 && messages[i]?.role === 'assistant' && messages[i]?.tool_calls?.length) {
				roundCount++;
				i--;
			}
		} else {
			// user or assistant without tool_calls
			i--;
		}
	}

	// Return the index after i (start of the preserved region)
	return Math.max(0, i + 1);
}

/**
 * Phase 1: Smart truncation — replace old large tool results with placeholders.
 * This is instant and costs zero additional tokens.
 *
 * @returns new messages array (shallow copy with truncated tool messages)
 */
export function truncateToolResults(
	messages: ChatMessage[],
	keepRecentRounds: number = KEEP_RECENT_ROUNDS,
): ChatMessage[] {
	if (messages.length === 0) return [];

	const preserveStartIndex = findRecentRoundsStartIndex(messages, keepRecentRounds);
	const result: ChatMessage[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;

		// Messages in the preserved region are kept as-is
		if (i >= preserveStartIndex) {
			result.push(msg);
			continue;
		}

		// For old tool messages, truncate large results
		if (msg.role === 'tool' && msg.content && msg.content.length > MIN_TRUNCATION_LENGTH) {
			// Try to extract tool name from the corresponding assistant message
			let toolName = 'unknown';
			for (let j = i - 1; j >= 0; j--) {
				const prev = messages[j];
				if (prev?.role === 'assistant' && prev.tool_calls) {
					const matchingCall = prev.tool_calls.find(tc => tc.id === msg.tool_call_id);
					if (matchingCall) {
						toolName = matchingCall.function.name;
						break;
					}
				}
				if (prev?.role !== 'tool') break;
			}

			result.push({
				...msg,
				content: `[Tool result truncated: ${toolName}, original ${msg.content.length} chars]`,
			});
		} else {
			result.push(msg);
		}
	}

	return result;
}

/**
 * Format a single message for the sub-agent compression transcript.
 * Similar to contextCompressor's formatMessageForTranscript but tailored for sub-agents.
 */
function formatMessageForTranscript(msg: ChatMessage): string | null {
	if (msg.role === 'system') return null;

	// For tool results, include a brief summary
	if (msg.role === 'tool') {
		const content = msg.content || '';
		const summary =
			content.length > 300
				? content.substring(0, 300) + `... [truncated, ${content.length} chars total]`
				: content;
		return `[Tool Result (${msg.tool_call_id || 'unknown'})]\n${summary}`;
	}

	const parts: string[] = [];
	const roleLabel = msg.role === 'user' ? '[User]' : '[Assistant]';

	if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
		if (msg.content) {
			parts.push(`${roleLabel}\n${msg.content}`);
		} else {
			parts.push(roleLabel);
		}
		for (const tc of msg.tool_calls) {
			const funcName = tc.function?.name || 'unknown';
			const args = tc.function?.arguments || '{}';
			// Truncate very long tool args
			const truncatedArgs =
				args.length > 500 ? args.substring(0, 500) + '...' : args;
			parts.push(`  -> Tool Call: ${funcName}(${truncatedArgs})`);
		}
		return parts.join('\n');
	}

	if (msg.content) {
		parts.push(`${roleLabel}\n${msg.content}`);
	}

	return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Prepare sub-agent messages for AI compression.
 * Converts the conversation into a two-message format for the compression AI.
 */
function prepareMessagesForAICompression(
	conversationMessages: ChatMessage[],
): ChatMessage[] {
	const messages: ChatMessage[] = [];

	// System message for the compressor
	messages.push({
		role: 'system',
		content:
			'You are a technical summarization assistant. Your job is to compress a tool-using AI agent\'s conversation history into a concise but complete summary.',
	});

	// Build transcript
	const transcriptParts: string[] = [];
	for (const msg of conversationMessages) {
		const formatted = formatMessageForTranscript(msg);
		if (formatted) {
			transcriptParts.push(formatted);
		}
	}

	const transcript = transcriptParts.join('\n\n---\n\n');
	messages.push({
		role: 'user',
		content: `## Sub-Agent Conversation History to Compress\n\n${transcript}`,
	});

	messages.push({
		role: 'user',
		content: SUB_AGENT_COMPRESSION_PROMPT,
	});

	return messages;
}

/**
 * Phase 2: AI summary compression — call the AI to generate a summary of old messages.
 * Preserves recent tool call rounds and replaces older history with a summary.
 *
 * @returns new messages array with summary + preserved recent messages
 */
async function aiSummaryCompress(
	messages: ChatMessage[],
	config: {model: string; requestMethod: RequestMethod; maxTokens?: number; configProfile?: string},
): Promise<ChatMessage[]> {
	// Find where to split: preserve recent rounds
	const preserveStartIndex = findRecentRoundsStartIndex(messages, KEEP_RECENT_ROUNDS);

	// If there's nothing to compress (all messages are "recent"), return as-is
	if (preserveStartIndex === 0) {
		return messages;
	}

	const messagesToCompress = messages.slice(0, preserveStartIndex);
	const preservedMessages = messages.slice(preserveStartIndex);

	// Generate summary using the appropriate API
	const compressionMessages = prepareMessagesForAICompression(messagesToCompress);
	let summary = '';

	try {
		switch (config.requestMethod) {
			case 'gemini': {
				for await (const chunk of createStreamingGeminiCompletion({
					model: config.model,
					messages: compressionMessages,
					configProfile: config.configProfile,
				})) {
					if (chunk.type === 'content' && chunk.content) {
						summary += chunk.content;
					}
				}
				break;
			}
			case 'anthropic': {
				for await (const chunk of createStreamingAnthropicCompletion({
					model: config.model,
					messages: compressionMessages,
					max_tokens: config.maxTokens || 4096,
					disableThinking: true,
					configProfile: config.configProfile,
				})) {
					if (chunk.type === 'content' && chunk.content) {
						summary += chunk.content;
					}
				}
				break;
			}
			case 'responses': {
				for await (const chunk of createStreamingResponse({
					model: config.model,
					messages: compressionMessages,
					configProfile: config.configProfile,
				})) {
					if (chunk.type === 'content' && chunk.content) {
						summary += chunk.content;
					}
				}
				break;
			}
			case 'chat':
			default: {
				for await (const chunk of createStreamingChatCompletion({
					model: config.model,
					messages: compressionMessages,
					stream: true,
					configProfile: config.configProfile,
				})) {
					if (chunk.type === 'content' && chunk.content) {
						summary += chunk.content;
					}
				}
				break;
			}
		}
	} catch (error) {
		console.error('[SubAgentCompressor] AI compression failed:', error);
		// If AI compression fails, return truncated messages as fallback
		return messages;
	}

	if (!summary) {
		console.warn('[SubAgentCompressor] AI compression returned empty summary');
		return messages;
	}

	// Build new messages: summary as first user message + preserved recent messages
	const newMessages: ChatMessage[] = [
		{
			role: 'user',
			content: `## Previous Context (Auto-Compressed Summary)\n\n${summary}\n\n---\n\n*The above is a compressed summary of earlier conversation. Continue the task based on this context and the recent tool interactions below.*`,
		},
		...preservedMessages,
	];

	return newMessages;
}

/**
 * Main compression function for sub-agent context.
 * Implements the two-phase hybrid strategy:
 * Phase 1: Smart truncation (instant, zero cost)
 * Phase 2: AI summary (if truncation is insufficient)
 *
 * @param messages - current sub-agent messages array
 * @param latestInputTokens - most recent prompt_tokens from API usage
 * @param maxContextTokens - model's max context window size
 * @param config - API configuration for AI compression
 * @returns compression result with new messages array
 */
export async function compressSubAgentContext(
	messages: ChatMessage[],
	latestInputTokens: number,
	maxContextTokens: number,
	config: {model: string; requestMethod: RequestMethod; maxTokens?: number; configProfile?: string},
): Promise<SubAgentCompressionResult> {
	const percentage = getContextPercentage(latestInputTokens, maxContextTokens);

	if (percentage < COMPRESS_THRESHOLD) {
		return {
			compressed: false,
			messages,
			phase: 'none',
		};
	}

	// Phase 1: Smart truncation
	const truncatedMessages = truncateToolResults(messages);

	// Estimate token reduction from truncation.
	// A rough heuristic: calculate character ratio as a proxy for token reduction.
	const originalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
	const truncatedChars = truncatedMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
	const reductionRatio = originalChars > 0 ? truncatedChars / originalChars : 1;
	const estimatedTokensAfterTruncation = Math.round(latestInputTokens * reductionRatio);
	const estimatedPercentageAfterTruncation = getContextPercentage(
		estimatedTokensAfterTruncation,
		maxContextTokens,
	);

	// If truncation alone brings us below threshold, use it
	if (estimatedPercentageAfterTruncation < COMPRESS_THRESHOLD) {
		return {
			compressed: true,
			messages: truncatedMessages,
			phase: 'truncation',
			beforeTokens: latestInputTokens,
			afterTokensEstimate: estimatedTokensAfterTruncation,
		};
	}

	// Phase 2: AI summary compression (truncation wasn't enough)
	const compressedMessages = await aiSummaryCompress(truncatedMessages, config);

	// Estimate final token count
	const compressedChars = compressedMessages.reduce(
		(sum, m) => sum + (m.content?.length || 0),
		0,
	);
	const compressedRatio = originalChars > 0 ? compressedChars / originalChars : 1;
	const estimatedTokensAfterCompression = Math.round(latestInputTokens * compressedRatio);

	return {
		compressed: true,
		messages: compressedMessages,
		phase: 'ai_summary',
		beforeTokens: latestInputTokens,
		afterTokensEstimate: estimatedTokensAfterCompression,
	};
}
