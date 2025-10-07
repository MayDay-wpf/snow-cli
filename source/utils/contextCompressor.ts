import OpenAI from 'openai';
import { getOpenAiConfig } from './apiConfig.js';
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
 * Compress conversation history using the compact model
 * @param messages - Array of messages to compress
 * @returns Compressed summary and token usage information
 */
export async function compressContext(messages: ChatMessage[]): Promise<CompressionResult> {
	const config = getOpenAiConfig();

	// Check if compact model is configured
	if (!config.compactModel || !config.compactModel.baseUrl || !config.compactModel.apiKey || !config.compactModel.modelName) {
		throw new Error('Compact model not configured. Please configure it in Model Settings.');
	}

	// Create OpenAI client with compact model config
	const client = new OpenAI({
		apiKey: config.compactModel.apiKey,
		baseURL: config.compactModel.baseUrl,
	});

	// Filter out system messages and create a conversation text
	const conversationText = messages
		.filter(msg => msg.role !== 'system')
		.map(msg => {
			const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'Tool';
			return `${role}: ${msg.content}`;
		})
		.join('\n\n');

	// Create compression prompt
	const compressionPrompt = `Please summarize the following conversation history in a concise way, preserving all important context, decisions, and key information. The summary should be detailed enough to continue the conversation seamlessly.

Conversation:
${conversationText}

Summary:`;

	try {
		const response = await client.chat.completions.create({
			model: config.compactModel.modelName,
			messages: [
				{
					role: 'user',
					content: compressionPrompt,
				},
			]
		});

		const summary = response.choices[0]?.message?.content;

		if (!summary) {
			throw new Error('Failed to generate summary from compact model');
		}

		// Extract usage information
		const usage = response.usage || {
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0
		};

		return {
			summary,
			usage: {
				prompt_tokens: usage.prompt_tokens,
				completion_tokens: usage.completion_tokens,
				total_tokens: usage.total_tokens
			}
		};
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Context compression failed: ${error.message}`);
		}
		throw new Error('Unknown error occurred during context compression');
	}
}
