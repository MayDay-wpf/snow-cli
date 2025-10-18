import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { getOpenAiConfig, getCustomHeaders, getCustomSystemPrompt } from './apiConfig.js';
import { SYSTEM_PROMPT } from '../api/systemPrompt.js';
import type { ChatMessage } from '../api/chat.js';

export interface CompressionResult {
	summary: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/**
 * Compression request prompt - asks AI to summarize conversation with focus on task continuity
 */
const COMPRESSION_PROMPT = 'Please provide a concise summary of our conversation so far. Focus on: 1) The current task or goal we are working on, 2) Key decisions and approaches we have agreed upon, 3) Important context needed to continue, 4) Any pending or unfinished work. Keep it brief but ensure I can seamlessly continue assisting with the task.';

/**
 * Compress context using OpenAI Chat Completions API
 */
async function compressWithChatCompletions(
	baseUrl: string,
	apiKey: string,
	modelName: string,
	conversationMessages: ChatMessage[],
	systemPrompt: string | null,
): Promise<CompressionResult> {
	const client = new OpenAI({
		apiKey,
		baseURL: baseUrl,
	});

	const customHeaders = getCustomHeaders();

	// Build messages with system prompt support
	const messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}> = [];

	if (systemPrompt) {
		// If custom system prompt exists: custom as system, default as first user message
		messages.push({ role: 'system', content: systemPrompt });
		messages.push({ role: 'user', content: SYSTEM_PROMPT });
	} else {
		// No custom system prompt: default as system
		messages.push({ role: 'system', content: SYSTEM_PROMPT });
	}

	// Add all conversation history (exclude system messages)
	for (const msg of conversationMessages) {
		if (msg.role !== 'system' && msg.role !== 'tool') {
			messages.push({
				role: msg.role as 'user' | 'assistant',
				content: msg.content,
			});
		}
	}

	// Add compression request as final user message
	messages.push({
		role: 'user',
		content: COMPRESSION_PROMPT,
	});

	// Build request payload (no tools for compression)
	const requestPayload = {
		model: modelName,
		messages,
		stream: true,
		stream_options: { include_usage: true } as any,
	};

	// Use streaming to avoid timeout
	const stream = (await client.chat.completions.create(requestPayload, {
		headers: customHeaders,
	})) as any;

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	for await (const chunk of stream) {
		const delta = chunk.choices[0]?.delta;
		if (delta?.content) {
			summary += delta.content;
		}

		// Collect usage info (usually in the last chunk)
		if (chunk.usage) {
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

	return {
		summary,
		usage,
	};
}

/**
 * Compress context using OpenAI Responses API
 */
async function compressWithResponses(
	baseUrl: string,
	apiKey: string,
	modelName: string,
	conversationMessages: ChatMessage[],
	systemPrompt: string | null,
): Promise<CompressionResult> {
	const client = new OpenAI({
		apiKey,
		baseURL: baseUrl,
	});

	const customHeaders = getCustomHeaders();

	// Build instructions
	const instructions = systemPrompt || SYSTEM_PROMPT;

	// Build input array with conversation history
	const input: any[] = [];

	// If custom system prompt exists, add default as first user message
	if (systemPrompt) {
		input.push({
			type: 'message',
			role: 'user',
			content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
		});
	}

	// Add all conversation history (exclude system messages)
	for (const msg of conversationMessages) {
		if (msg.role !== 'system' && msg.role !== 'tool') {
			input.push({
				type: 'message',
				role: msg.role,
				content: [{
					type: msg.role === 'user' ? 'input_text' : 'output_text',
					text: msg.content,
				}],
			});
		}
	}

	// Add compression request as final user message
	input.push({
		type: 'message',
		role: 'user',
		content: [{
			type: 'input_text',
			text: COMPRESSION_PROMPT,
		}],
	});

	// Build request payload (no tools for compression)
	const requestPayload: any = {
		model: modelName,
		instructions,
		input,
		stream: true,
	};

	// Use streaming to avoid timeout
	const stream = await client.responses.create(requestPayload, {
		headers: customHeaders,
	});

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	for await (const chunk of stream as any) {
		const eventType = chunk.type;

		// Handle text content delta
		if (eventType === 'response.output_text.delta') {
			const delta = chunk.delta;
			if (delta) {
				summary += delta;
			}
		}

		// Handle usage info
		if (eventType === 'response.done') {
			const response = chunk.response;
			if (response?.usage) {
				usage = {
					prompt_tokens: response.usage.input_tokens || 0,
					completion_tokens: response.usage.output_tokens || 0,
					total_tokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
				};
			}
		}
	}

	if (!summary) {
		throw new Error('Failed to generate summary from compact model (Responses API)');
	}

	return {
		summary,
		usage,
	};
}

/**
 * Compress context using Gemini API
 */
async function compressWithGemini(
	baseUrl: string,
	apiKey: string,
	modelName: string,
	conversationMessages: ChatMessage[],
	systemPrompt: string | null,
): Promise<CompressionResult> {
	const clientConfig: any = {
		apiKey,
	};

	const customHeaders = getCustomHeaders();

	// Support custom baseUrl and headers for proxy servers
	if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
		clientConfig.httpOptions = {
			baseUrl,
			headers: {
				'x-goog-api-key': apiKey,
				...customHeaders,
			},
		};
	} else if (Object.keys(customHeaders).length > 0) {
		clientConfig.httpOptions = {
			headers: customHeaders,
		};
	}

	const client = new GoogleGenAI(clientConfig);

	// Build system instruction
	const systemInstruction = systemPrompt || SYSTEM_PROMPT;

	// Build contents array with conversation history
	const contents: any[] = [];

	// If custom system prompt exists, add default as first user message
	if (systemPrompt) {
		contents.push({
			role: 'user',
			parts: [{ text: SYSTEM_PROMPT }],
		});
	}

	// Add all conversation history (exclude system messages)
	for (const msg of conversationMessages) {
		if (msg.role !== 'system' && msg.role !== 'tool') {
			contents.push({
				role: msg.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: msg.content }],
			});
		}
	}

	// Add compression request as final user message
	contents.push({
		role: 'user',
		parts: [{
			text: COMPRESSION_PROMPT,
		}],
	});

	const requestConfig = {
		model: modelName,
		systemInstruction,
		contents,
	};

	// Use streaming to avoid timeout
	const stream = await client.models.generateContentStream(requestConfig);

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	for await (const chunk of stream) {
		if (chunk.text) {
			summary += chunk.text;
		}

		// Collect usage info
		if (chunk.usageMetadata) {
			usage = {
				prompt_tokens: chunk.usageMetadata.promptTokenCount || 0,
				completion_tokens: chunk.usageMetadata.candidatesTokenCount || 0,
				total_tokens: chunk.usageMetadata.totalTokenCount || 0,
			};
		}
	}

	if (!summary) {
		throw new Error('Failed to generate summary from Gemini model');
	}

	return {
		summary,
		usage,
	};
}

/**
 * Compress context using Anthropic API
 */
async function compressWithAnthropic(
	baseUrl: string,
	apiKey: string,
	modelName: string,
	conversationMessages: ChatMessage[],
	systemPrompt: string | null,
): Promise<CompressionResult> {
	const clientConfig: any = {
		apiKey,
	};

	if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
		clientConfig.baseURL = baseUrl;
	}

	const customHeaders = getCustomHeaders();
	clientConfig.defaultHeaders = {
		'Authorization': `Bearer ${apiKey}`,
		...customHeaders,
	};

	const client = new Anthropic(clientConfig);

	// Build messages array with conversation history
	const messages: Array<{role: 'user' | 'assistant'; content: string}> = [];

	// If custom system prompt exists, add default as first user message
	if (systemPrompt) {
		messages.push({ role: 'user', content: SYSTEM_PROMPT });
	}

	// Add all conversation history (exclude system messages)
	for (const msg of conversationMessages) {
		if (msg.role !== 'system' && msg.role !== 'tool') {
			messages.push({
				role: msg.role as 'user' | 'assistant',
				content: msg.content,
			});
		}
	}

	// Add compression request as final user message
	messages.push({
		role: 'user',
		content: COMPRESSION_PROMPT,
	});

	// Anthropic uses system parameter separately
	const systemParam = systemPrompt || SYSTEM_PROMPT;

	// Build request payload (no tools for compression)
	const requestPayload = {
		model: modelName,
		max_tokens: 4096,
		system: systemParam,
		messages,
	};

	// Use streaming to avoid timeout
	const stream = await client.messages.stream(requestPayload);

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	for await (const event of stream) {
		if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
			summary += event.delta.text;
		}

		// Collect usage info from message_stop event
		if (event.type === 'message_stop') {
			const finalMessage = await stream.finalMessage();
			usage = {
				prompt_tokens: finalMessage.usage.input_tokens,
				completion_tokens: finalMessage.usage.output_tokens,
				total_tokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
			};
		}
	}

	if (!summary) {
		throw new Error('Failed to generate summary from Anthropic model');
	}

	return {
		summary,
		usage,
	};
}

/**
 * Compress conversation history using the compact model
 * @param messages - Array of messages to compress
 * @returns Compressed summary and token usage information
 */
export async function compressContext(messages: ChatMessage[]): Promise<CompressionResult> {
	const config = getOpenAiConfig();

	// Check if compact model is configured
	if (!config.compactModel || !config.compactModel.modelName) {
		throw new Error('Compact model not configured. Please configure it in API & Model Settings.');
	}

	// Use shared API credentials
	const baseUrl = config.baseUrl;
	const apiKey = config.apiKey;
	const modelName = config.compactModel.modelName;
	const requestMethod = config.requestMethod;

	if (!baseUrl || !apiKey) {
		throw new Error('API configuration incomplete. Please configure Base URL and API Key.');
	}

	// Get custom system prompt if configured
	const customSystemPrompt = getCustomSystemPrompt();

	try {
		// Choose compression method based on request method
		switch (requestMethod) {
			case 'gemini':
				return await compressWithGemini(baseUrl, apiKey, modelName, messages, customSystemPrompt || null);

			case 'anthropic':
				return await compressWithAnthropic(baseUrl, apiKey, modelName, messages, customSystemPrompt || null);

			case 'responses':
				// OpenAI Responses API
				return await compressWithResponses(baseUrl, apiKey, modelName, messages, customSystemPrompt || null);

			case 'chat':
			default:
				// OpenAI Chat Completions API
				return await compressWithChatCompletions(baseUrl, apiKey, modelName, messages, customSystemPrompt || null);
		}
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Context compression failed: ${error.message}`);
		}
		throw new Error('Unknown error occurred during context compression');
	}
}
