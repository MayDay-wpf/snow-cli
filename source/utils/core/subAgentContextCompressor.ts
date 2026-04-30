/**
 * Sub-Agent Context Compressor
 *
 * AI summary compression for sub-agent context management.
 * Follows the same pattern as the main flow's contextCompressor.ts:
 * - Determine which recent messages to preserve (recent tool call rounds)
 * - Send older messages to AI for summarization (excluding tool results, only keeping event records)
 * - Replace old messages with summary + preserved recent messages
 *
 * This prevents sub-agents from failing due to context_length_exceeded errors.
 */

import {encoding_for_model} from 'tiktoken';
import {createStreamingChatCompletion} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import type {ChatMessage} from '../../api/types.js';
import type {RequestMethod} from '../config/apiConfig.js';
import {cleanOrphanedToolCalls} from './contextCompressor.js';

/** Threshold percentage to trigger compression */
const COMPRESS_THRESHOLD = 80;

/** Default number of recent tool call rounds to preserve */
const DEFAULT_KEEP_RECENT_ROUNDS = 3;

/**
 * Compression prompt for sub-agent context — follows the same pattern as the main flow's
 * COMPRESSION_PROMPT but is more concise (sub-agents have simpler conversations).
 */
const SUB_AGENT_COMPRESSION_PROMPT = `**TASK: Create a concise handover document from the sub-agent conversation history above.**

You are creating a technical handover document for a tool-using AI agent. Extract and preserve all critical information with rigorous detail.

**OUTPUT FORMAT:**

## Task Objective
- What the agent was asked to do
- Current completion status

## Key Findings
- Important information discovered via tool calls
- **EXACT** file paths, function names, code identifiers
- Search results, code patterns, architecture details

## Actions Taken
- Files read/modified (with exact paths)
- Commands executed and their outcomes
- Tools used and their results (key details only)

## Work In Progress
- Incomplete tasks with specific reasons
- Planned next steps (concrete, actionable)
- Known issues and blockers

## Critical Reference Data
- Important values, IDs, error messages (exact wording)
- User requirements and constraints
- Edge cases and special handling

**QUALITY REQUIREMENTS:**
1. Preserve EXACT technical terms — never paraphrase code/file names
2. Include FULL context — paths, versions, configurations
3. NO vague summaries — provide actionable, specific details
4. Use markdown code blocks for code snippets

**EXECUTE NOW — Output the handover document immediately.**`;

// ── Singleton tiktoken encoder (lazy-initialized, with cleanup support) ──
let _encoder: any = null;

function getEncoder() {
	if (!_encoder) {
		try {
			_encoder = encoding_for_model('gpt-5');
		} catch {
			_encoder = encoding_for_model('gpt-3.5-turbo');
		}
	}
	return _encoder;
}

/**
 * Free the module-level tiktoken encoder to reclaim WASM memory.
 * Called during /clear or session teardown.
 */
export function freeSubAgentEncoder(): void {
	if (_encoder) {
		try {
			_encoder.free();
		} catch {
			// already freed or unavailable
		}
		_encoder = null;
	}
}

export interface SubAgentCompressionResult {
	compressed: boolean;
	messages: ChatMessage[];
	beforeTokens?: number;
	afterTokensEstimate?: number;
	compressionApiUsage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/**
 * Count total tokens in a messages array using tiktoken.
 * Used as fallback when the API doesn't return usage data.
 */
export function countMessagesTokens(messages: ChatMessage[]): number {
	try {
		const encoder = getEncoder();
		let total = 0;
		for (const msg of messages) {
			// Count content tokens
			if (msg.content) {
				total += encoder.encode(msg.content).length;
			}
			// Count tool_calls arguments tokens
			if (msg.tool_calls) {
				for (const tc of msg.tool_calls) {
					if (tc.function?.arguments) {
						total += encoder.encode(tc.function.arguments).length;
					}
					if (tc.function?.name) {
						total += encoder.encode(tc.function.name).length;
					}
				}
			}
			// Overhead per message (role, formatting, etc.) ~4 tokens
			total += 4;
		}
		return total;
	} catch (error) {
		console.error('[SubAgentCompressor] tiktoken counting failed:', error);
		// Rough fallback: ~4 chars per token
		const totalChars = messages.reduce(
			(sum, m) => sum + (m.content?.length || 0),
			0,
		);
		return Math.round(totalChars / 4);
	}
}

/**
 * Check whether sub-agent context needs compression.
 * @returns percentage of context used (0-100)
 */
export function getContextPercentage(
	totalTokens: number,
	maxContextTokens: number,
): number {
	if (!maxContextTokens || maxContextTokens <= 0) return 0;
	return Math.min(100, (totalTokens / maxContextTokens) * 100);
}

/**
 * Check if compression should be triggered.
 */
export function shouldCompressSubAgentContext(
	totalTokens: number,
	maxContextTokens: number,
): boolean {
	return (
		getContextPercentage(totalTokens, maxContextTokens) >= COMPRESS_THRESHOLD
	);
}

/**
 * Determine how many recent rounds to preserve based on context pressure.
 * Higher pressure = fewer rounds preserved = more aggressive compression.
 */
function getAdaptiveKeepRounds(percentage: number): number {
	if (percentage >= 95) return 1; // Extreme pressure: keep only last round
	if (percentage >= 85) return 2; // High pressure: keep 2 rounds
	return DEFAULT_KEEP_RECENT_ROUNDS; // Normal (80-84%): keep 3 rounds
}

/**
 * Find the start index of the "recent rounds" to preserve.
 * Counts backwards from the end, counting N complete tool-call rounds
 * (assistant with tool_calls + corresponding tool results = 1 round).
 */
function findRecentRoundsStartIndex(
	messages: ChatMessage[],
	keepRounds: number,
): number {
	let roundCount = 0;
	let i = messages.length - 1;

	// Only count main-agent rounds. subAgentInternal messages are nested inside a
	// main-agent tool call (subagent-agent_*) and must NOT be counted as separate
	// rounds — otherwise the cut may land in the middle of a sub-agent block and
	// orphan the parent main-agent tool_calls/tool results.
	while (i >= 0 && roundCount < keepRounds) {
		const msg = messages[i];
		if (!msg) {
			i--;
			continue;
		}

		// Skip sub-agent internal messages entirely (they belong to a wrapping main round)
		if ((msg as any).subAgentInternal) {
			i--;
			continue;
		}

		if (msg.role === 'tool') {
			// Skip all consecutive tool messages (they belong to the same round).
			// Tolerate interleaved subAgentInternal messages.
			while (
				i >= 0 &&
				(messages[i]?.role === 'tool' || (messages[i] as any)?.subAgentInternal)
			) {
				i--;
			}
			// Now i should point to the main-agent assistant message with tool_calls
			if (
				i >= 0 &&
				messages[i]?.role === 'assistant' &&
				messages[i]?.tool_calls?.length &&
				!(messages[i] as any).subAgentInternal
			) {
				roundCount++;
				i--;
			}
		} else {
			i--;
		}
	}

	let cut = Math.max(0, i + 1);

	// Defensive: never cut into the middle of an orphaned tool / subAgentInternal block.
	// Advance forward past leading tool / subAgentInternal messages that have no
	// corresponding main-agent assistant.tool_calls in the preserved region.
	while (cut < messages.length) {
		const m = messages[cut];
		if (!m) break;
		const isOrphanTool =
			m.role === 'tool' &&
			!hasPrecedingAssistantWithToolCall(messages, cut, m.tool_call_id);
		const isLeadingSubAgent = (m as any).subAgentInternal === true;
		if (isOrphanTool || isLeadingSubAgent) {
			cut++;
			continue;
		}
		break;
	}

	return cut;
}

/**
 * Check whether `messages[idx]` (a tool message) has a preceding main-agent
 * assistant message with a matching tool_call id within the slice
 * `messages[start..idx]` (where start is determined by walking backwards
 * through tool/subAgentInternal messages).
 *
 * Used by findRecentRoundsStartIndex to detect orphaned tool results that
 * would otherwise be sent to the API and trigger a 400 error.
 */
function hasPrecedingAssistantWithToolCall(
	messages: ChatMessage[],
	idx: number,
	toolCallId?: string,
): boolean {
	if (!toolCallId) return false;
	for (let j = idx - 1; j >= 0; j--) {
		const m = messages[j];
		if (!m) continue;
		if (
			m.role === 'assistant' &&
			m.tool_calls?.some(tc => tc.id === toolCallId)
		) {
			return true;
		}
		// Stop searching if we hit a user message (round boundary)
		if (m.role === 'user') return false;
	}
	return false;
}

/**
 * Format a single message for the compression transcript.
 * Follows the same pattern as the main flow's formatMessageForTranscript:
 * - Excludes tool result content entirely (only keeps tool call event records)
 * - This is key to effective compression — tool results are the bulk of the context
 */
function formatMessageForTranscript(msg: ChatMessage): string | null {
	// Skip tool messages entirely — they are the bulk of context and will be discarded
	if (msg.role === 'tool') {
		return null;
	}

	// Skip system messages
	if (msg.role === 'system') {
		return null;
	}

	const parts: string[] = [];
	const roleLabel = msg.role === 'user' ? '[User]' : '[Assistant]';

	// For assistant messages with tool_calls, record the tool call events (not results)
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

	// For regular messages, include content
	if (msg.content) {
		parts.push(`${roleLabel}\n${msg.content}`);
	}

	return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Prepare sub-agent messages for AI compression.
 * Follows the same two-message approach as the main flow:
 * - Message 1 (User): All interaction records as a single transcript string
 *   (excludes tool results, only keeps tool call event records)
 * - Message 2 (User): Compression guidance prompt
 */
function prepareMessagesForAICompression(
	conversationMessages: ChatMessage[],
): ChatMessage[] {
	const messages: ChatMessage[] = [];

	// System message for the compressor
	messages.push({
		role: 'system',
		content:
			"You are a technical summarization assistant. Your job is to compress a tool-using AI agent's conversation history into a concise but complete handover document.",
	});

	// Build transcript (excluding tool results)
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

interface AISummaryResult {
	messages: ChatMessage[];
	apiUsage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/**
 * Perform AI summary compression — call the AI to generate a handover document.
 * Preserves recent tool call rounds and replaces older history with a summary.
 *
 * @param messages - all sub-agent messages
 * @param keepRounds - number of recent rounds to preserve
 * @param config - API configuration
 * @returns new messages array with summary + preserved recent messages, plus API usage if available
 */
async function aiSummaryCompress(
	messages: ChatMessage[],
	keepRounds: number,
	config: {
		model: string;
		requestMethod: RequestMethod;
		maxTokens?: number;
		configProfile?: string;
	},
): Promise<AISummaryResult> {
	const preserveStartIndex = findRecentRoundsStartIndex(messages, keepRounds);

	// If there's nothing to compress (all messages are "recent"), return as-is
	if (preserveStartIndex === 0) {
		return {messages};
	}

	const messagesToCompress = messages.slice(0, preserveStartIndex);
	const preservedMessages = messages.slice(preserveStartIndex);

	// CRITICAL: Clean orphaned tool_calls / tool results from preserved messages.
	// Without this, an assistant.tool_calls cut off from its tool results (or a
	// tool result with no parent assistant) would be persisted into the new
	// compressed session, causing the next API call to fail with errors like:
	//   "No tool call found for function call output with call_id ..."
	// (OpenAI Responses API) or 400 from Anthropic tool_use/tool_result mismatch.
	cleanOrphanedToolCalls(preservedMessages);

	// Generate summary using the appropriate API
	const compressionMessages =
		prepareMessagesForAICompression(messagesToCompress);
	let summary = '';
	let apiUsage: AISummaryResult['apiUsage'];

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
					if (chunk.type === 'usage' && chunk.usage) {
						apiUsage = {
							prompt_tokens: chunk.usage.prompt_tokens || 0,
							completion_tokens: chunk.usage.completion_tokens || 0,
							total_tokens: chunk.usage.total_tokens || 0,
						};
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
					if (chunk.type === 'usage' && chunk.usage) {
						apiUsage = {
							prompt_tokens: chunk.usage.prompt_tokens || 0,
							completion_tokens: chunk.usage.completion_tokens || 0,
							total_tokens: chunk.usage.total_tokens || 0,
						};
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
					if (chunk.type === 'usage' && chunk.usage) {
						apiUsage = {
							prompt_tokens: chunk.usage.prompt_tokens || 0,
							completion_tokens: chunk.usage.completion_tokens || 0,
							total_tokens: chunk.usage.total_tokens || 0,
						};
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
					if (chunk.type === 'usage' && chunk.usage) {
						apiUsage = {
							prompt_tokens: chunk.usage.prompt_tokens || 0,
							completion_tokens: chunk.usage.completion_tokens || 0,
							total_tokens: chunk.usage.total_tokens || 0,
						};
					}
				}
				break;
			}
		}
	} catch (error) {
		console.error('[SubAgentCompressor] AI compression failed:', error);
		return {messages};
	}

	if (!summary) {
		console.warn('[SubAgentCompressor] AI compression returned empty summary');
		return {messages};
	}

	// Build new messages: summary as first user message + preserved recent messages
	const newMessages: ChatMessage[] = [
		{
			role: 'user',
			content: `## Previous Context (Auto-Compressed Summary)\n\n${summary}\n\n---\n\n*The above is a compressed summary of earlier conversation. Continue the task based on this context and the recent tool interactions below.*`,
		},
		...preservedMessages,
	];

	return {messages: newMessages, apiUsage};
}

/**
 * Find the tool name for a tool message by searching preceding assistant messages.
 */
function findToolName(
	messages: ChatMessage[],
	idx: number,
	toolCallId?: string,
): string {
	for (let j = idx - 1; j >= 0; j--) {
		const prev = messages[j];
		if (prev?.role === 'assistant' && prev.tool_calls) {
			const match = prev.tool_calls.find(tc => tc.id === toolCallId);
			if (match) return match.function.name;
		}
		if (prev?.role !== 'tool') break;
	}
	return 'unknown';
}

/** Max chars to keep per tool result in preserved region */
const MAX_PRESERVED_TOOL_RESULT_CHARS = 2000;

/**
 * Truncate oversized tool results in a messages array.
 * Keeps the beginning and end of each tool result for context.
 *
 * @param messages - messages array to process
 * @param maxChars - max chars per tool result (default: MAX_PRESERVED_TOOL_RESULT_CHARS)
 * @returns new messages array with truncated tool results
 */
function truncateOversizedToolResults(
	messages: ChatMessage[],
	maxChars: number = MAX_PRESERVED_TOOL_RESULT_CHARS,
): ChatMessage[] {
	return messages.map((msg, idx) => {
		if (msg.role !== 'tool' || !msg.content || msg.content.length <= maxChars) {
			return msg;
		}

		const toolName = findToolName(messages, idx, msg.tool_call_id);
		const keepStart = Math.floor(maxChars * 0.6);
		const keepEnd = Math.floor(maxChars * 0.3);
		const truncated = msg.content.length - keepStart - keepEnd;

		return {
			...msg,
			content:
				msg.content.substring(0, keepStart) +
				`\n\n[... ${truncated} chars truncated from ${toolName} result ...]\n\n` +
				msg.content.substring(msg.content.length - keepEnd),
		};
	});
}

/**
 * Fallback: smart truncation — replace old large tool results with compact placeholders.
 * Used when AI summary compression fails. This is instant and costs zero additional tokens.
 *
 * @param messages - current messages array
 * @param keepRounds - number of recent rounds to preserve
 * @returns new messages array with truncated tool results
 */
function truncateToolResults(
	messages: ChatMessage[],
	keepRounds: number,
): ChatMessage[] {
	if (messages.length === 0) return [];

	const preserveStartIndex = findRecentRoundsStartIndex(messages, keepRounds);
	const result: ChatMessage[] = [];

	/** Minimum tool result length to consider for truncation */
	const MIN_TRUNCATION_LENGTH = 500;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;

		// OLD messages: aggressive truncation (placeholders only)
		if (i < preserveStartIndex) {
			if (
				msg.role === 'tool' &&
				msg.content &&
				msg.content.length > MIN_TRUNCATION_LENGTH
			) {
				const toolName = findToolName(messages, i, msg.tool_call_id);
				result.push({
					...msg,
					content: `[Tool result truncated: ${toolName}, original ${msg.content.length} chars]`,
				});
			} else {
				result.push(msg);
			}
			continue;
		}

		result.push(msg);
	}

	// Apply standard truncation to preserved region
	return truncateOversizedToolResults(result);
}

/**
 * Main compression function for sub-agent context.
 * Primary: AI summarization (same approach as the main flow's contextCompressor.ts)
 * Fallback: Smart truncation (if AI fails — replace old tool results with placeholders)
 *
 * @param messages - current sub-agent messages array
 * @param totalTokens - total token count (from API usage or tiktoken fallback)
 * @param maxContextTokens - model's max context window size
 * @param config - API configuration for compression
 * @returns compression result with new messages array
 */
export async function compressSubAgentContext(
	messages: ChatMessage[],
	totalTokens: number,
	maxContextTokens: number,
	config: {
		model: string;
		requestMethod: RequestMethod;
		maxTokens?: number;
		configProfile?: string;
	},
): Promise<SubAgentCompressionResult> {
	const percentage = getContextPercentage(totalTokens, maxContextTokens);

	if (percentage < COMPRESS_THRESHOLD) {
		return {
			compressed: false,
			messages,
		};
	}

	// Determine adaptive keep rounds based on context pressure
	const keepRounds = getAdaptiveKeepRounds(percentage);

	// Use consistent measurement for beforeTokens:
	// countMessagesTokens measures only message content, matching afterTokensEstimate.
	// API's total_tokens includes system prompt + tool definitions + completion overhead,
	// which inflates beforeTokens and distorts the compression ratio display.
	const beforeTokens = countMessagesTokens(messages);

	// Primary: AI summary compression (same pattern as main flow)
	const {messages: compressedMessages, apiUsage} = await aiSummaryCompress(
		messages,
		keepRounds,
		config,
	);

	// If AI compression succeeded (returned different messages), use it
	if (compressedMessages !== messages) {
		// Truncate oversized tool results in preserved messages.
		// AI compression replaces OLD messages with a summary, but preserved messages
		// (recent N rounds) keep their full tool results which are often the bulk of context.
		const optimizedMessages = truncateOversizedToolResults(compressedMessages);
		const afterTokens = countMessagesTokens(optimizedMessages);
		return {
			compressed: true,
			messages: optimizedMessages,
			beforeTokens,
			afterTokensEstimate: afterTokens,
			compressionApiUsage: apiUsage,
		};
	}

	// Fallback: AI compression returned original messages (failed or nothing to compress).
	// Try smart truncation as a last resort to free some context space.
	console.warn(
		`[SubAgentCompressor] AI compression ineffective, falling back to truncation`,
	);
	const truncatedMessages = truncateToolResults(messages, keepRounds);
	const afterTokens = countMessagesTokens(truncatedMessages);

	// Only report as compressed if truncation actually reduced tokens
	if (afterTokens < beforeTokens) {
		return {
			compressed: true,
			messages: truncatedMessages,
			beforeTokens,
			afterTokensEstimate: afterTokens,
		};
	}

	return {
		compressed: false,
		messages,
	};
}

/**
 * Hybrid compression for the main flow.
 * Uses the same AI summary + tool result truncation approach as sub-agents,
 * but without the threshold check (caller decides when to compress).
 *
 * @param messages - conversation messages to compress
 * @param config - API configuration
 * @param keepRounds - number of recent rounds to preserve (default: 3)
 * @returns compression result
 */
export async function performHybridCompression(
	messages: ChatMessage[],
	config: {
		model: string;
		requestMethod: RequestMethod;
		maxTokens?: number;
		configProfile?: string;
	},
	keepRounds: number = DEFAULT_KEEP_RECENT_ROUNDS,
): Promise<SubAgentCompressionResult> {
	if (messages.length === 0) {
		return {compressed: false, messages};
	}

	const beforeTokens = countMessagesTokens(messages);

	const {messages: compressedMessages, apiUsage} = await aiSummaryCompress(
		messages,
		keepRounds,
		config,
	);

	if (compressedMessages !== messages) {
		const optimizedMessages = truncateOversizedToolResults(compressedMessages);
		const afterTokens = countMessagesTokens(optimizedMessages);
		return {
			compressed: true,
			messages: optimizedMessages,
			beforeTokens,
			afterTokensEstimate: afterTokens,
			compressionApiUsage: apiUsage,
		};
	}

	// Fallback: truncation only
	const truncatedMessages = truncateToolResults(messages, keepRounds);
	const afterTokens = countMessagesTokens(truncatedMessages);

	if (afterTokens < beforeTokens) {
		return {
			compressed: true,
			messages: truncatedMessages,
			beforeTokens,
			afterTokensEstimate: afterTokens,
		};
	}

	return {compressed: false, messages};
}
