import { getOpenAiConfig, getCustomHeaders, getCustomSystemPrompt } from './apiConfig.js';
import { SYSTEM_PROMPT } from '../api/systemPrompt.js';
import type { ChatMessage } from '../api/types.js';

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
 * Parse Server-Sent Events (SSE) stream
 */
async function* parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<any, void, unknown> {
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith(':')) continue;

			if (trimmed === 'data: [DONE]') {
				return;
			}

			if (trimmed.startsWith('data: ')) {
				const data = trimmed.slice(6);
				try {
					yield JSON.parse(data);
				} catch (e) {
					console.error('Failed to parse SSE data:', data);
				}
			}
		}
	}
}

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
		stream_options: { include_usage: true },
	};

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
			...customHeaders
		},
		body: JSON.stringify(requestPayload)
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	if (!response.body) {
		throw new Error('No response body from OpenAI API');
	}

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	for await (const chunk of parseSSEStream(response.body.getReader())) {
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

	const response = await fetch(`${baseUrl}/responses`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
			...customHeaders
		},
		body: JSON.stringify(requestPayload)
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI Responses API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	if (!response.body) {
		throw new Error('No response body from OpenAI Responses API');
	}

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	for await (const chunk of parseSSEStream(response.body.getReader())) {
		const eventType = chunk.type;

		// Handle text content delta
		if (eventType === 'response.output_text.delta') {
			const delta = chunk.delta;
			if (delta) {
				summary += delta;
			}
		}

		// Handle usage info
		if (eventType === 'response.completed') {
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
	const customHeaders = getCustomHeaders();

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

	const requestBody = {
		contents,
		systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
	};

	// Extract model name
	const effectiveBaseUrl = baseUrl && baseUrl !== 'https://api.openai.com/v1'
		? baseUrl
		: 'https://generativelanguage.googleapis.com/v1beta';

	const model = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
	const url = `${effectiveBaseUrl}/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`,
			...customHeaders
		},
		body: JSON.stringify(requestBody)
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	if (!response.body) {
		throw new Error('No response body from Gemini API');
	}

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	// Parse SSE stream
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith(':')) continue;

			if (trimmed.startsWith('data: ')) {
				const data = trimmed.slice(6);
				try {
					const chunk = JSON.parse(data);

					// Process candidates
					if (chunk.candidates && chunk.candidates.length > 0) {
						const candidate = chunk.candidates[0];
						if (candidate.content && candidate.content.parts) {
							for (const part of candidate.content.parts) {
								if (part.text) {
									summary += part.text;
								}
							}
						}
					}

					// Collect usage info
					if (chunk.usageMetadata) {
						usage = {
							prompt_tokens: chunk.usageMetadata.promptTokenCount || 0,
							completion_tokens: chunk.usageMetadata.candidatesTokenCount || 0,
							total_tokens: chunk.usageMetadata.totalTokenCount || 0,
						};
					}
				} catch (e) {
					console.error('Failed to parse Gemini SSE data:', data);
				}
			}
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
	const customHeaders = getCustomHeaders();

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
		stream: true
	};

	const effectiveBaseUrl = baseUrl && baseUrl !== 'https://api.openai.com/v1'
		? baseUrl
		: 'https://api.anthropic.com/v1';

	const response = await fetch(`${effectiveBaseUrl}/messages`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'authorization': `Bearer ${apiKey}`,
			...customHeaders
		},
		body: JSON.stringify(requestPayload)
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	if (!response.body) {
		throw new Error('No response body from Anthropic API');
	}

	let summary = '';
	let usage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	// Parse Anthropic SSE stream
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith(':')) continue;

			if (trimmed.startsWith('event: ')) {
				continue;
			}

			if (trimmed.startsWith('data: ')) {
				const data = trimmed.slice(6);
				try {
					const event = JSON.parse(data);

					if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
						summary += event.delta.text;
					}

					// Collect usage info from message_start event
					if (event.type === 'message_start' && event.message?.usage) {
						usage.prompt_tokens = event.message.usage.input_tokens || 0;
					}

					// Collect usage info from message_delta event
					if (event.type === 'message_delta' && event.usage) {
						usage.completion_tokens = event.usage.output_tokens || 0;
						usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
					}
				} catch (e) {
					console.error('Failed to parse Anthropic SSE data:', data);
				}
			}
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
