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
	preservedMessages?: ChatMessage[];
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
			if (msg?.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
				// 找到了，从这个 assistant 开始保留
				return i;
			}
		}
		// 如果找不到对应的 assistant，保留最后的 tool（虽然不太可能）
		return messages.length - 1;
	}

	// Case 2: 最后是 assistant with tool_calls → 保留 assistant(tool_calls)
	if (lastMsg?.role === 'assistant' && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
		// 保留这个待处理的 tool_calls
		return messages.length - 1;
	}

	// Case 3: 最后是普通 assistant 或 user → 全部压缩
	// 因为没有未完成的工具调用链
	return messages.length;
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
		messages.push({role: 'user', content: getSystemPrompt()});
	} else {
		// No custom system prompt: default as system
		messages.push({role: 'system', content: getSystemPrompt()});
	}

	// Add all conversation history for compression
	// Filter out system messages (already added above) and tool messages (only needed for API, not for summary)
	for (const msg of conversationMessages) {
		if (msg.role !== 'system' && msg.role !== 'tool') {
			// Only include user and assistant messages for compression
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
 * @returns Compressed summary and token usage information, or null if compression should be skipped
 */
export async function compressContext(
	messages: ChatMessage[],
): Promise<CompressionResult | null> {
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
		console.warn('Cannot compress: all messages need to be preserved (no history)');
		return null;
	}

	// 分离待压缩和待保留的消息
	const messagesToCompress = messages.slice(0, preserveStartIndex);
	const preservedMessages = messages.slice(preserveStartIndex);

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
		}

		return result;
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Context compression failed: ${error.message}`);
		}
		throw new Error('Unknown error occurred during context compression');
	}
}
