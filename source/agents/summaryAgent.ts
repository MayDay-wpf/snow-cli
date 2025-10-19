import {getOpenAiConfig, getCustomSystemPrompt} from '../utils/apiConfig.js';
import {logger} from '../utils/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {RequestMethod} from '../utils/apiConfig.js';

export class SummaryAgent {
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private initialized: boolean = false;

	/**
	 * Initialize the summary agent with current configuration
	 * @returns true if initialized successfully, false otherwise
	 */
	private async initialize(): Promise<boolean> {
		try {
			const config = getOpenAiConfig();

			// Check if basic model is configured
			if (!config.basicModel) {
				return false;
			}

			this.modelName = config.basicModel;
			this.requestMethod = config.requestMethod; // Follow main flow's request method
			this.initialized = true;

			return true;
		} catch (error) {
			logger.warn('Failed to initialize summary agent:', error);
			return false;
		}
	}

	/**
	 * Check if summary agent is available
	 */
	async isAvailable(): Promise<boolean> {
		if (!this.initialized) {
			return await this.initialize();
		}
		return true;
	}

	/**
	 * Call the basic model with the same routing as main flow
	 * Uses streaming APIs and intercepts to assemble complete response
	 * This ensures 100% consistency with main flow routing
	 * @param messages - Chat messages
	 * @param abortSignal - Optional abort signal to cancel the request
	 */
	private async callBasicModel(
		messages: ChatMessage[],
		abortSignal?: AbortSignal,
	): Promise<string> {
		const config = getOpenAiConfig();

		if (!config.basicModel) {
			throw new Error('Basic model not configured');
		}

		// Get custom system prompt if configured
		const customSystemPrompt = getCustomSystemPrompt();

		// If custom system prompt exists, prepend it to messages
		// This ensures summary agent respects user's custom system configuration
		let processedMessages = messages;
		if (customSystemPrompt) {
			processedMessages = [
				{
					role: 'system',
					content: customSystemPrompt,
				},
				...messages,
			];
		}

		// Temporarily override advancedModel with basicModel
		const originalAdvancedModel = config.advancedModel;

		try {
			// Override config to use basicModel
			config.advancedModel = config.basicModel;

			let streamGenerator: AsyncGenerator<any, void, unknown>;

			// Route to appropriate streaming API based on request method (follows main flow exactly)
			switch (this.requestMethod) {
				case 'anthropic':
					streamGenerator = createStreamingAnthropicCompletion(
						{
							model: this.modelName,
							messages: processedMessages,
							max_tokens: 1024, // Summaries are short
						},
						abortSignal,
					);
					break;

				case 'gemini':
					streamGenerator = createStreamingGeminiCompletion(
						{
							model: this.modelName,
							messages: processedMessages,
						},
						abortSignal,
					);
					break;

				case 'responses':
					streamGenerator = createStreamingResponse(
						{
							model: this.modelName,
							messages: processedMessages,
							stream: true,
						},
						abortSignal,
					);
					break;

				case 'chat':
				default:
					streamGenerator = createStreamingChatCompletion(
						{
							model: this.modelName,
							messages: processedMessages,
							stream: true,
						},
						abortSignal,
					);
					break;
			}

			// Intercept streaming response and assemble complete content
			let completeContent = '';
			let chunkCount = 0;

			try {
				for await (const chunk of streamGenerator) {
					chunkCount++;

					// Check abort signal
					if (abortSignal?.aborted) {
						throw new Error('Request aborted');
					}

					// Handle different chunk formats based on request method
					if (this.requestMethod === 'chat') {
						// Chat API uses standard OpenAI format: {choices: [{delta: {content}}]}
						if (chunk.choices && chunk.choices[0]?.delta?.content) {
							completeContent += chunk.choices[0].delta.content;
						}
					} else {
						// Responses, Gemini, and Anthropic APIs all use: {type: 'content', content: string}
						if (chunk.type === 'content' && chunk.content) {
							completeContent += chunk.content;
						}
					}
				}
			} catch (streamError) {
				// Log streaming error with details
				if (streamError instanceof Error) {
					logger.error('Summary agent: Streaming error:', {
						error: streamError.message,
						stack: streamError.stack,
						name: streamError.name,
						chunkCount,
						contentLength: completeContent.length,
					});
				} else {
					logger.error('Summary agent: Unknown streaming error:', {
						error: streamError,
						chunkCount,
						contentLength: completeContent.length,
					});
				}
				throw streamError;
			}

			return completeContent;
		} catch (error) {
			// Log detailed error from API call setup or streaming
			if (error instanceof Error) {
				logger.error('Summary agent: API call failed:', {
					error: error.message,
					stack: error.stack,
					name: error.name,
					requestMethod: this.requestMethod,
					modelName: this.modelName,
				});
			} else {
				logger.error('Summary agent: Unknown API error:', {
					error,
					requestMethod: this.requestMethod,
					modelName: this.modelName,
				});
			}
			throw error;
		} finally {
			// Restore original config
			config.advancedModel = originalAdvancedModel;
		}
	}

	/**
	 * Generate a concise summary from the first user message
	 *
	 * @param userMessage - The first user message in the conversation
	 * @param abortSignal - Optional abort signal to cancel generation
	 * @returns A concise summary (10-20 words) suitable for session title
	 */
	async generateSummary(
		userMessage: string,
		abortSignal?: AbortSignal,
	): Promise<string> {
		const available = await this.isAvailable();
		if (!available) {
			// If summary agent is not available, return a truncated version of the message
			return userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
		}

		try {
			const summaryPrompt = `Generate a concise summary (10-20 words) for the following user message. The summary should capture the main topic or intent.

User Message: ${userMessage}

Instructions:
1. Keep it under 20 words
2. Focus on the main topic or question
3. Use clear, simple language
4. Do not include quotes or special formatting
5. Make it suitable as a conversation title

Summary:`;

			const messages: ChatMessage[] = [
				{
					role: 'user',
					content: summaryPrompt,
				},
			];

			const summary = await this.callBasicModel(messages, abortSignal);

			if (!summary || summary.trim().length === 0) {
				logger.warn(
					'Summary agent returned empty response, using truncated message',
				);
				return (
					userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '')
				);
			}

			// Clean up the summary (remove quotes, trim whitespace)
			const cleanedSummary = summary
				.trim()
				.replace(/^["']|["']$/g, '') // Remove leading/trailing quotes
				.replace(/\n/g, ' ') // Replace newlines with spaces
				.slice(0, 100); // Limit to 100 characters max

			return cleanedSummary;
		} catch (error) {
			// Log detailed error information
			if (error instanceof Error) {
				logger.warn(
					'Summary agent generation failed, using truncated message:',
					{
						error: error.message,
						stack: error.stack,
						name: error.name,
					},
				);
			} else {
				logger.warn(
					'Summary agent generation failed with unknown error:',
					error,
				);
			}
			// Fallback to truncated message
			return userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
		}
	}
}

// Export singleton instance
export const summaryAgent = new SummaryAgent();
