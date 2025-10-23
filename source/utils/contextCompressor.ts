import {getOpenAiConfig, getCustomSystemPrompt} from './apiConfig.js';
import {getSystemPrompt} from '../api/systemPrompt.js';
import type {ChatMessage} from '../api/types.js';
import {createStreamingChatCompletion} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';

export interface CompressionResult {
	summary: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	preservedMessages?: ChatMessage[]; // 保留的后50%原始消息
}

/**
 * Compression request prompt - asks AI to create a detailed, structured summary
 * that preserves critical information for task continuity
 */
const COMPRESSION_PROMPT = `You are compressing a conversation history to save context space while preserving all critical information. Create a comprehensive summary following this structure:

## 📋 Current Task & Goals
- What is the main task or project being worked on?
- What are the specific objectives and desired outcomes?
- What is the current progress status?

## 🔧 Technical Context
- Key technologies, frameworks, libraries, and tools being used
- Important file paths, function names, and code locations mentioned
- Architecture decisions and design patterns chosen
- Configuration settings and environment details

## 💡 Key Decisions & Approaches
- Important decisions made and their rationale
- Chosen approaches and methodologies
- Solutions to problems encountered
- Best practices or patterns agreed upon

## ✅ Completed Work
- What has been successfully implemented or resolved?
- Important code changes, fixes, or features added
- Test results or validation performed

## 🚧 Pending & In-Progress Work
- What tasks are currently unfinished?
- Known issues or blockers that need addressing
- Next steps planned or discussed
- Open questions or areas needing clarification

## 🔑 Critical Information
- Important data, values, IDs, or credentials referenced (sanitized)
- Error messages, warnings, or diagnostic information
- User preferences, requirements, or constraints
- Any other context essential for seamless continuation

**Guidelines:**
- Be specific with names, paths, and technical details
- Preserve exact terminology and technical vocabulary
- Include enough detail to continue work without confusion
- Use code snippets or examples where helpful
- Prioritize actionable information over general descriptions`;

/**
 * 智能找到对话的50%分割点，确保不破坏对话结构
 *
 * 严格的消息结构要求：
 * 1. user → assistant (可能包含 tool_calls)
 * 2. 如果 assistant 有 tool_calls → 必须跟随对应的 tool 结果消息
 * 3. tool 结果消息 → 必须跟随 assistant 的响应
 *
 * 安全分割点：user 消息之前（确保前一轮对话完全结束）
 */
function findSplitPoint(messages: ChatMessage[]): number {
	if (messages.length <= 2) {
		return 0; // 消息太少，不分割
	}

	// 计算中点位置（按消息数量）
	const midPoint = Math.floor(messages.length / 2);

	// 从中点向后查找，找到下一个 user 消息
	// 在 user 消息前分割，确保前一轮对话完全结束
	for (let i = midPoint; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;

		if (msg.role === 'user') {
			// 验证：确保前一条消息不是待处理的 tool_calls
			if (i > 0) {
				const prevMsg = messages[i - 1];
				if (prevMsg && prevMsg.role === 'assistant' && prevMsg.tool_calls && prevMsg.tool_calls.length > 0) {
					// 前一条是带 tool_calls 的 assistant，需要继续查找
					continue;
				}
			}
			// 安全的分割点：在 user 消息前分割
			return i;
		}
	}

	// 如果向后找不到 user 消息，向前查找
	for (let i = midPoint - 1; i > 0; i--) {
		const msg = messages[i];
		if (!msg) continue;

		if (msg.role === 'user') {
			// 同样验证前一条消息
			if (i > 0) {
				const prevMsg = messages[i - 1];
				if (prevMsg && prevMsg.role === 'assistant' && prevMsg.tool_calls && prevMsg.tool_calls.length > 0) {
					// 前一条是带 tool_calls 的 assistant，继续向前查找
					continue;
				}
			}
			return i;
		}
	}

	// 实在找不到安全的分割点，检查中点是否安全
	// 如果中点不安全（在工具调用链中间），向前找到第一个 user 消息
	for (let i = 1; i < messages.length; i++) {
		const msg = messages[i];
		if (msg && msg.role === 'user') {
			const prevMsg = messages[i - 1];
			if (!prevMsg || prevMsg.role !== 'assistant' || !prevMsg.tool_calls || prevMsg.tool_calls.length === 0) {
				return i;
			}
		}
	}

	// 极端情况：整个对话都是连续的工具调用链，不分割
	return 0;
}

/**
 * Prepare messages for compression by adding system prompt and compression request
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
		messages.push({role: 'user', content: getSystemPrompt()});
	} else {
		// No custom system prompt: default as system
		messages.push({role: 'system', content: getSystemPrompt()});
	}

	// Add all conversation history (exclude system and tool messages)
	for (const msg of conversationMessages) {
		if (msg.role !== 'system' && msg.role !== 'tool') {
			messages.push({
				role: msg.role,
				content: msg.content,
			});
		}
	}

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
 * @param partialCompression - If true, only compress first 50% and preserve last 50%
 * @returns Compressed summary and token usage information
 */
export async function compressContext(
	messages: ChatMessage[],
	partialCompression: boolean = true,
): Promise<CompressionResult> {
	const config = getOpenAiConfig();

	// Check if compact model is configured
	if (!config.compactModel || !config.compactModel.modelName) {
		throw new Error(
			'Compact model not configured. Please configure it in API & Model Settings.',
		);
	}

	const modelName = config.compactModel.modelName;
	const requestMethod = config.requestMethod;

	// Get custom system prompt if configured
	const customSystemPrompt = getCustomSystemPrompt();

	let messagesToCompress = messages;
	let preservedMessages: ChatMessage[] | undefined;

	// 如果启用部分压缩，只压缩前50%
	if (partialCompression && messages.length > 2) {
		const splitPoint = findSplitPoint(messages);

		if (splitPoint > 0) {
			// 分割消息：前半部分压缩，后半部分保留
			messagesToCompress = messages.slice(0, splitPoint);
			preservedMessages = messages.slice(splitPoint);
		}
	}

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
		if (preservedMessages && preservedMessages.length > 0) {
			result.preservedMessages = preservedMessages;
		}

		return result;
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Context compression failed: ${error.message}`);
		}
		throw new Error('Unknown error occurred during context compression');
	}
}
