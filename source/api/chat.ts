import OpenAI from 'openai';
import { getOpenAiConfig } from '../utils/apiConfig.js';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatCompletionOptions {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
}

export interface ChatCompletionChunk {
	id: string;
	object: 'chat.completion.chunk';
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
		};
		finish_reason?: string | null;
	}>;
}

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
	if (!openaiClient) {
		const config = getOpenAiConfig();
		
		if (!config.apiKey || !config.baseUrl) {
			throw new Error('OpenAI API configuration is incomplete. Please configure API settings first.');
		}

		openaiClient = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});
	}
	
	return openaiClient;
}

export function resetOpenAIClient(): void {
	openaiClient = null;
}

export async function createChatCompletion(options: ChatCompletionOptions): Promise<string> {
	const client = getOpenAIClient();
	
	try {
		const response = await client.chat.completions.create({
			model: options.model,
			messages: options.messages,
			stream: false,
			temperature: options.temperature || 0.7,
			max_tokens: options.max_tokens,
		});

		return response.choices[0]?.message?.content || '';
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Chat completion failed: ${error.message}`);
		}
		throw new Error('Chat completion failed: Unknown error');
	}
}

export async function* createStreamingChatCompletion(
	options: ChatCompletionOptions,
	abortSignal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
	const client = getOpenAIClient();
	
	try {
		const stream = await client.chat.completions.create({
			model: options.model,
			messages: options.messages,
			stream: true,
			temperature: options.temperature || 0.7,
			max_tokens: options.max_tokens,
		}, {
			signal: abortSignal,
		});

		for await (const chunk of stream) {
			if (abortSignal?.aborted) {
				break;
			}
			
			const content = chunk.choices[0]?.delta?.content;
			if (content) {
				yield content;
			}
		}
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return; // Silently handle abort
		}
		if (error instanceof Error) {
			throw new Error(`Streaming chat completion failed: ${error.message}`);
		}
		throw new Error('Streaming chat completion failed: Unknown error');
	}
}

export function validateChatOptions(options: ChatCompletionOptions): string[] {
	const errors: string[] = [];

	if (!options.model || options.model.trim().length === 0) {
		errors.push('Model is required');
	}

	if (!options.messages || options.messages.length === 0) {
		errors.push('At least one message is required');
	}

	for (const message of options.messages || []) {
		if (!message.role || !['system', 'user', 'assistant'].includes(message.role)) {
			errors.push('Invalid message role');
		}
		if (!message.content || message.content.trim().length === 0) {
			errors.push('Message content cannot be empty');
		}
	}

	return errors;
}