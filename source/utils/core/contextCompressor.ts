import {getOpenAiConfig, getCustomSystemPrompt} from '../config/apiConfig.js';
import {getSystemPromptForMode} from '../../prompt/systemPrompt.js';
import type {ChatMessage} from '../../api/types.js';
import {createStreamingChatCompletion} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';

export interface CompressionResult {
	summary: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	preservedMessages?: ChatMessage[];
	preservedMessageStartIndex?: number; // Start index of preserved messages in original array
	hookFailed?: boolean; // Indicates if beforeCompress hook failed
	hookErrorDetails?: {
		type: 'warning' | 'error';
		exitCode: number;
		command: string;
		output?: string;
		error?: string;
	}; // Hook error details for UI rendering
}

/**
 * Compression request prompt - asks AI to create a detailed, structured summary
 * that preserves critical information for task continuity
 */
const COMPRESSION_PROMPT = `**YOUR ONLY TASK: Compress the conversation history into a structured summary. DO NOT ask questions, DO NOT seek clarification, DO NOT interact with users.**

You are a context compression system. Your job is to extract and preserve all critical information from the conversation history, regardless of its length or complexity. Even for short or simple conversations, you MUST produce a comprehensive summary.

Create a detailed summary following this structure:

## Current Task & Goals
- What is the main task or project being worked on?
- What are the specific objectives and desired outcomes?
- What is the current progress status?

## Technical Context
- Key technologies, frameworks, libraries, and tools being used
- Important file paths, function names, and code locations mentioned
- Architecture decisions and design patterns chosen
- Configuration settings and environment details

## Key Decisions & Approaches
- Important decisions made and their rationale
- Chosen approaches and methodologies
- Solutions to problems encountered
- Best practices or patterns agreed upon

## Completed Work
- What has been successfully implemented or resolved?
- Important code changes, fixes, or features added
- Test results or validation performed

## Pending & In-Progress Work
- What tasks are currently unfinished?
- Known issues or blockers that need addressing
- Next steps planned or discussed
- Open questions or areas needing clarification

## Critical Information
- Important data, values, IDs, or credentials referenced (sanitized)
- Error messages, warnings, or diagnostic information
- User preferences, requirements, or constraints
- Any other context essential for seamless continuation

**CRITICAL RULES:**
1. NEVER ask users for clarification - work with what you have
2. NEVER say the context is too short - always summarize what exists
3. NEVER refuse to compress - this is your only function
4. Be specific with names, paths, and technical details
5. Preserve exact terminology and technical vocabulary
6. Include enough detail to continue work without confusion
7. Use code snippets or examples where helpful
8. Prioritize actionable information over general descriptions

**EXECUTE THE COMPRESSION NOW - NO QUESTIONS, NO DELAYS.**`;

/**
 * 找到需要保留的消息（最近的工具调用链）
 *
 * 保留策略：
 * - 如果最后有未完成的工具调用（assistant with tool_calls 或 tool），保留这个链
 * - 如果最后是普通 assistant 或 user，不需要保留（压缩全部）
 *
 * 注意：不保留 user 消息，因为：
 * 1. 压缩摘要已包含历史上下文
 * 2. 下一轮对话会有新的 user 消息
 *
 * @returns 保留消息的起始索引，如果全部压缩则返回 messages.length
 */
function findPreserveStartIndex(messages: ChatMessage[]): number {
	if (messages.length === 0) {
		return 0;
	}

	const lastMsg = messages[messages.length - 1];

	// Case 1: 最后是 tool 消息 → 保留 assistant(tool_calls) → tool
	if (lastMsg?.role === 'tool') {
		// 向前找对应的 assistant with tool_calls
		for (let i = messages.length - 2; i >= 0; i--) {
			const msg = messages[i];
			if (
				msg?.role === 'assistant' &&
				msg.tool_calls &&
				msg.tool_calls.length > 0
			) {
				// 找到了，从这个 assistant 开始保留
				return i;
			}
		}
		// 如果找不到对应的 assistant，保留最后的 tool（虽然不太可能）
		return messages.length - 1;
	}

	// Case 2: 最后是 assistant with tool_calls → 保留 assistant(tool_calls)
	if (
		lastMsg?.role === 'assistant' &&
		lastMsg.tool_calls &&
		lastMsg.tool_calls.length > 0
	) {
		// 保留这个待处理的 tool_calls
		return messages.length - 1;
	}

	// Case 3: 最后是普通 assistant 或 user → 全部压缩
	// 因为没有未完成的工具调用链
	return messages.length;
}

/**
 * Clean orphaned tool_calls from conversation messages
 *
 * Removes problematic messages that violate Anthropic API requirements:
 * 1. Assistant messages with tool_calls that have no corresponding tool results
 * 2. Assistant messages with tool_calls where tool_results don't IMMEDIATELY follow
 * 3. Tool result messages that have no corresponding tool_calls
 * 4. Tool result messages that don't immediately follow their corresponding tool_calls
 *
 * Anthropic API requires: Each tool_use block must have corresponding tool_result
 * blocks in the NEXT message (immediately after).
 *
 * This prevents API errors when compression happens while tools are executing
 * or when message order is disrupted.
 *
 * @param messages - Array of conversation messages (will be modified in-place)
 */
function cleanOrphanedToolCalls(messages: ChatMessage[]): void {
	// Find indices to remove (iterate backwards for safe removal)
	const indicesToRemove: number[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue; // Skip undefined messages

		// Check assistant messages with tool_calls
		if (
			msg.role === 'assistant' &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			const nextMsg = messages[i + 1];

			// Verify next message is a tool message
			if (!nextMsg || nextMsg.role !== 'tool') {
				// Next message is not a tool message - remove assistant message
				console.warn(
					'[contextCompressor:cleanOrphanedToolCalls] Removing assistant message - next message is not tool result',
					{
						messageIndex: i,
						toolCallIds: msg.tool_calls.map(tc => tc.id),
						nextMessageRole: nextMsg?.role || 'none',
					},
				);
				indicesToRemove.push(i);
				continue;
			}

			// Collect all tool_call_ids from this assistant message
			const expectedToolCallIds = new Set(msg.tool_calls.map(tc => tc.id));

			// Check all immediately following tool messages
			const foundToolCallIds = new Set<string>();
			for (let j = i + 1; j < messages.length; j++) {
				const followingMsg = messages[j];
				if (!followingMsg) continue;

				if (followingMsg.role === 'tool') {
					if (followingMsg.tool_call_id) {
						foundToolCallIds.add(followingMsg.tool_call_id);
					}
				} else {
					// Hit non-tool message, stop checking
					break;
				}
			}

			// Verify all tool_calls have corresponding results immediately after
			const missingIds = Array.from(expectedToolCallIds).filter(
				id => !foundToolCallIds.has(id),
			);

			if (missingIds.length > 0) {
				// Missing some tool results immediately after - remove assistant message
				console.warn(
					'[contextCompressor:cleanOrphanedToolCalls] Removing assistant message - missing immediate tool results',
					{
						messageIndex: i,
						toolCallIds: msg.tool_calls.map(tc => tc.id),
						missingIds,
					},
				);
				indicesToRemove.push(i);
			}
		}

		// Check tool messages
		if (msg.role === 'tool' && msg.tool_call_id) {
			// Find the nearest preceding assistant message with tool_calls
			let foundCorrespondingAssistant = false;

			// Search backwards for assistant with this tool_call_id
			for (let j = i - 1; j >= 0; j--) {
				const prevMsg = messages[j];
				if (!prevMsg) continue;

				if (prevMsg.role === 'assistant' && prevMsg.tool_calls) {
					// Check if this assistant has our tool_call_id
					const hasToolCall = prevMsg.tool_calls.some(
						tc => tc.id === msg.tool_call_id,
					);

					if (hasToolCall) {
						foundCorrespondingAssistant = true;

						// Verify this tool message immediately follows the assistant
						// (or follows other tool messages from the same assistant)
						let isImmediatelyAfter = true;
						for (let k = j + 1; k < i; k++) {
							const betweenMsg = messages[k];
							if (betweenMsg && betweenMsg.role !== 'tool') {
								// Found non-tool message between assistant and this tool
								isImmediatelyAfter = false;
								break;
							}
						}

						if (!isImmediatelyAfter) {
							// Tool result doesn't immediately follow - remove it
							console.warn(
								'[contextCompressor:cleanOrphanedToolCalls] Removing tool result - not immediately after assistant',
								{
									messageIndex: i,
									toolCallId: msg.tool_call_id,
									assistantIndex: j,
								},
							);
							indicesToRemove.push(i);
						}
						break;
					}
				} else if (prevMsg.role !== 'tool') {
					// Hit non-assistant, non-tool message - stop searching
					break;
				}
			}

			if (!foundCorrespondingAssistant) {
				// No corresponding assistant found - remove orphaned tool result
				console.warn(
					'[contextCompressor:cleanOrphanedToolCalls] Removing orphaned tool result - no corresponding assistant',
					{
						messageIndex: i,
						toolCallId: msg.tool_call_id,
					},
				);
				indicesToRemove.push(i);
			}
		}
	}

	// Remove messages in reverse order (from end to start) to preserve indices
	indicesToRemove.sort((a, b) => b - a);
	for (const idx of indicesToRemove) {
		messages.splice(idx, 1);
	}

	if (indicesToRemove.length > 0) {
		console.log(
			`[contextCompressor:cleanOrphanedToolCalls] Removed ${indicesToRemove.length} orphaned messages from compression input`,
		);
	}
}

/**
 * Prepare messages for compression by adding system prompt and compression request
 * Note: Only filters out system messages and tool messages, preserving user and assistant messages
 */
function prepareMessagesForCompression(
	conversationMessages: ChatMessage[],
	customSystemPrompt: string | null,
): ChatMessage[] {
	const messages: ChatMessage[] = [];

	// Add system prompt (handled by API modules)
	if (customSystemPrompt) {
		// If custom system prompt exists: custom as system, default as first user message
		messages.push({role: 'system', content: customSystemPrompt});
		// messages.push({role: 'user', content: getSystemPrompt()});
	} else {
		// No custom system prompt: default as system
		// Default to false for compression (no Plan mode in compression context)
		messages.push({
			role: 'system',
			content: getSystemPromptForMode(false, false),
		});
	}

	// Add all conversation history for compression
	// Filter out only system messages (already added above)
	// Keep tool messages to maintain valid API request structure (Anthropic requires tool_result after tool_use)
	for (const msg of conversationMessages) {
		if (msg.role !== 'system') {
			// Include user, assistant, and tool messages for compression
			// Preserve all critical fields for accurate summary generation
			const compressMsg: any = {
				role: msg.role,
				content: msg.content,
			};
			// Preserve tool_calls for assistant messages (required by Anthropic API)
			if (msg.tool_calls) {
				compressMsg.tool_calls = msg.tool_calls;
			}
			// Preserve tool_call_id for tool messages (links to tool_calls)
			if (msg.tool_call_id) {
				compressMsg.tool_call_id = msg.tool_call_id;
			}
			// Preserve thinking/reasoning fields (OpenAI Responses API, Anthropic, DeepSeek R1)
			if (msg.reasoning) {
				compressMsg.reasoning = msg.reasoning;
			}
			if (msg.thinking) {
				compressMsg.thinking = msg.thinking;
			}
			if (msg.reasoning_content) {
				compressMsg.reasoning_content = msg.reasoning_content;
			}
			messages.push(compressMsg);
		}
	}

	// CRITICAL: Clean orphaned tool_calls before sending to API
	// This prevents errors when compression happens while tools are executing
	// (e.g., last message has tool_use but no tool_result yet)
	cleanOrphanedToolCalls(messages);

	// Add compression request as final user message
	messages.push({
		role: 'user',
		content: COMPRESSION_PROMPT,
	});

	return messages;
}

/**
 * Compress context using OpenAI Chat Completions API (reuses chat.ts)
 */
async function compressWithChatCompletions(
	modelName: string,
	conversationMessages: ChatMessage[],
	customSystemPrompt: string | null,
): Promise<CompressionResult> {
	const messages = prepareMessagesForCompression(
		conversationMessages,
		customSystemPrompt,
	);

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	// Use the existing streaming API from chat.ts (includes proxy support)
	for await (const chunk of createStreamingChatCompletion({
		model: modelName,
		messages,
		stream: true,
	})) {
		// Collect content
		if (chunk.type === 'content' && chunk.content) {
			summary += chunk.content;
		}

		// Collect usage info
		if (chunk.type === 'usage' && chunk.usage) {
			usage = {
				prompt_tokens: chunk.usage.prompt_tokens || 0,
				completion_tokens: chunk.usage.completion_tokens || 0,
				total_tokens: chunk.usage.total_tokens || 0,
			};
		}
	}

	if (!summary) {
		throw new Error('Failed to generate summary from compact model');
	}

	return {summary, usage};
}

/**
 * Compress context using OpenAI Responses API (reuses responses.ts)
 */
async function compressWithResponses(
	modelName: string,
	conversationMessages: ChatMessage[],
	customSystemPrompt: string | null,
): Promise<CompressionResult> {
	const messages = prepareMessagesForCompression(
		conversationMessages,
		customSystemPrompt,
	);

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	// Use the existing streaming API from responses.ts (includes proxy support)
	for await (const chunk of createStreamingResponse({
		model: modelName,
		messages,
		stream: true,
	})) {
		// Collect content
		if (chunk.type === 'content' && chunk.content) {
			summary += chunk.content;
		}

		// Collect usage info
		if (chunk.type === 'usage' && chunk.usage) {
			usage = {
				prompt_tokens: chunk.usage.prompt_tokens || 0,
				completion_tokens: chunk.usage.completion_tokens || 0,
				total_tokens: chunk.usage.total_tokens || 0,
			};
		}
	}

	if (!summary) {
		throw new Error(
			'Failed to generate summary from compact model (Responses API)',
		);
	}

	return {summary, usage};
}

/**
 * Compress context using Gemini API (reuses gemini.ts)
 */
async function compressWithGemini(
	modelName: string,
	conversationMessages: ChatMessage[],
	customSystemPrompt: string | null,
): Promise<CompressionResult> {
	const messages = prepareMessagesForCompression(
		conversationMessages,
		customSystemPrompt,
	);

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	// Use the existing streaming API from gemini.ts (includes proxy support)
	for await (const chunk of createStreamingGeminiCompletion({
		model: modelName,
		messages,
	})) {
		// Collect content
		if (chunk.type === 'content' && chunk.content) {
			summary += chunk.content;
		}

		// Collect usage info
		if (chunk.type === 'usage' && chunk.usage) {
			usage = {
				prompt_tokens: chunk.usage.prompt_tokens || 0,
				completion_tokens: chunk.usage.completion_tokens || 0,
				total_tokens: chunk.usage.total_tokens || 0,
			};
		}
	}

	if (!summary) {
		throw new Error('Failed to generate summary from Gemini model');
	}

	return {summary, usage};
}

/**
 * Compress context using Anthropic API (reuses anthropic.ts)
 */
async function compressWithAnthropic(
	modelName: string,
	conversationMessages: ChatMessage[],
	customSystemPrompt: string | null,
): Promise<CompressionResult> {
	const messages = prepareMessagesForCompression(
		conversationMessages,
		customSystemPrompt,
	);

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	// Use the existing streaming API from anthropic.ts (includes proxy support)
	for await (const chunk of createStreamingAnthropicCompletion({
		model: modelName,
		messages,
		max_tokens: 4096,
		disableThinking: true, // Context compression 不使用 Extended Thinking
	})) {
		// Collect content
		if (chunk.type === 'content' && chunk.content) {
			summary += chunk.content;
		}

		// Collect usage info
		if (chunk.type === 'usage' && chunk.usage) {
			usage = {
				prompt_tokens: chunk.usage.prompt_tokens || 0,
				completion_tokens: chunk.usage.completion_tokens || 0,
				total_tokens: chunk.usage.total_tokens || 0,
			};
		}
	}

	if (!summary) {
		throw new Error('Failed to generate summary from Anthropic model');
	}

	return {summary, usage};
}

/**
 * Compress conversation history using the compact model
 * @param messages - Array of messages to compress
 * @returns Compressed summary and token usage information, or null if compression should be skipped
 */
export async function compressContext(
	messages: ChatMessage[],
): Promise<CompressionResult | null> {
	// Execute beforeCompress hook
	try {
		const {unifiedHooksExecutor} = await import(
			'../execution/unifiedHooksExecutor.js'
		);
		const {sessionManager} = await import('../session/sessionManager.js');

		// Get current session for conversation history
		const currentSession = sessionManager.getCurrentSession();
		const conversationMessages = currentSession?.messages || messages;

		// Prepare conversation JSON for stdin
		const conversationJson = JSON.stringify(conversationMessages, null, 2);

		const hookResult = await unifiedHooksExecutor.executeHooks(
			'beforeCompress',
			{
				messages: conversationMessages,
				conversationJson, // Full conversation JSON for stdin
			},
		);

		// Handle hook exit codes: 0=continue, 1=warning+continue, 2+=block compression
		if (hookResult && !hookResult.success) {
			const commandError = hookResult.results.find(
				(r: any) => r.type === 'command' && !r.success,
			);

			if (commandError && commandError.type === 'command') {
				const {exitCode, command, output, error} = commandError;

				if (exitCode >= 2 || exitCode < 0) {
					// Exit code 2+: Block compression and return hookFailed result
					console.warn(
						`[WARN] beforeCompress hook blocked compression (exitCode: ${exitCode}):\n` +
							`output: ${output || '(empty)'}\n` +
							`error: ${error || '(empty)'}`,
					);
					// Return a special result with hookFailed flag
					return {
						summary: '',
						usage: {
							prompt_tokens: 0,
							completion_tokens: 0,
							total_tokens: 0,
						},
						hookFailed: true,
						hookErrorDetails: {
							type: 'error',
							exitCode,
							command,
							output,
							error,
						},
					};
				} else if (exitCode === 1) {
					// Exit code 1: Warning, log and continue
					console.warn(
						`[WARN] beforeCompress hook warning (exitCode: ${exitCode}):\n` +
							`output: ${output || '(empty)'}\n` +
							`error: ${error || '(empty)'}`,
					);
				}
				// Exit code 0: Success, continue silently
			}
		}
	} catch (error) {
		// Log unexpected errors but continue - don't block compression on unexpected errors
		console.warn('Failed to execute beforeCompress hook:', error);
	}

	const config = getOpenAiConfig();

	// Check if compact model is configured
	if (!config.compactModel || !config.compactModel.modelName) {
		throw new Error(
			'Compact model not configured. Please configure it in API & Model Settings.',
		);
	}

	if (messages.length === 0) {
		console.warn('No messages to compress');
		return null;
	}

	const modelName = config.compactModel.modelName;
	const requestMethod = config.requestMethod;

	// Get custom system prompt if configured
	const customSystemPrompt = getCustomSystemPrompt();

	// 找到需要保留的消息起始位置
	const preserveStartIndex = findPreserveStartIndex(messages);

	// 如果 preserveStartIndex 为 0，说明所有消息都需要保留（没有历史可压缩）
	// 例如：整个对话只有一条 user→assistant(tool_calls)，无法压缩
	if (preserveStartIndex === 0) {
		console.warn(
			'Cannot compress: all messages need to be preserved (no history)',
		);
		return null;
	}

	// 分离待压缩和待保留的消息
	const messagesToCompress = messages.slice(0, preserveStartIndex);
	const preservedMessages = messages.slice(preserveStartIndex);

	// CRITICAL: Clean orphaned tool_calls from preserved messages
	// This prevents orphaned tool_calls from being saved to the new session
	// When compression happens after tool_calls are saved but before tool_results are added
	cleanOrphanedToolCalls(preservedMessages);

	try {
		// Choose compression method based on request method
		// All methods now reuse existing API modules which include proxy support
		let result: CompressionResult;

		switch (requestMethod) {
			case 'gemini':
				result = await compressWithGemini(
					modelName,
					messagesToCompress,
					customSystemPrompt || null,
				);
				break;

			case 'anthropic':
				result = await compressWithAnthropic(
					modelName,
					messagesToCompress,
					customSystemPrompt || null,
				);
				break;

			case 'responses':
				// OpenAI Responses API
				result = await compressWithResponses(
					modelName,
					messagesToCompress,
					customSystemPrompt || null,
				);
				break;

			case 'chat':
			default:
				// OpenAI Chat Completions API
				result = await compressWithChatCompletions(
					modelName,
					messagesToCompress,
					customSystemPrompt || null,
				);
				break;
		}

		// 添加保留的消息到结果中
		if (preservedMessages.length > 0) {
			result.preservedMessages = preservedMessages;
			result.preservedMessageStartIndex = preserveStartIndex;
		}

		return result;
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Context compression failed: ${error.message}`);
		}
		throw new Error('Unknown error occurred during context compression');
	}
}
