import { getOpenAiConfig } from '../utils/apiConfig.js';
import { logger } from '../utils/logger.js';
import { createStreamingChatCompletion, type ChatMessage } from '../api/chat.js';
import { createStreamingResponse } from '../api/responses.js';
import { createStreamingGeminiCompletion } from '../api/gemini.js';
import { createStreamingAnthropicCompletion } from '../api/anthropic.js';
import type { RequestMethod } from '../utils/apiConfig.js';

/**
 * Compact Agent Service
 *
 * Provides lightweight AI agent capabilities using the basic model.
 * This service operates independently from the main conversation flow
 * but follows the EXACT same configuration and routing as the main flow:
 * - API endpoint (baseUrl)
 * - Authentication (apiKey)
 * - Custom headers
 * - Request method (chat, responses, gemini, anthropic)
 * - Uses basicModel instead of advancedModel
 *
 * All requests go through streaming APIs and are intercepted to assemble
 * the complete response, ensuring complete consistency with main flow.
 *
 * Use cases:
 * - Content preprocessing for web pages
 * - Information extraction from large documents
 * - Quick analysis tasks that don't require the main model
 */
export class CompactAgent {
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private initialized: boolean = false;

	/**
	 * Initialize the compact agent with current configuration
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
			logger.warn('Failed to initialize compact agent:', error);
			return false;
		}
	}

	/**
	 * Check if compact agent is available
	 */
	async isAvailable(): Promise<boolean> {
		if (!this.initialized) {
			return await this.initialize();
		}
		return true;
	}

	/**
	 * Call the compact model with the same routing as main flow
	 * Uses streaming APIs and intercepts to assemble complete response
	 * This ensures 100% consistency with main flow routing
	 * @param messages - Chat messages
	 * @param abortSignal - Optional abort signal to cancel the request
	 * @param onTokenUpdate - Optional callback to update token count during streaming
	 */
	private async callCompactModel(messages: ChatMessage[], abortSignal?: AbortSignal, onTokenUpdate?: (tokenCount: number) => void): Promise<string> {
		const config = getOpenAiConfig();

		if (!config.basicModel) {
			throw new Error('Basic model not configured');
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
							messages,
							max_tokens: 4096,
						},
						abortSignal,
					);
					break;

				case 'gemini':
					streamGenerator = createStreamingGeminiCompletion(
						{
							model: this.modelName,
							messages
						},
						abortSignal,
					);
					break;

				case 'responses':
					streamGenerator = createStreamingResponse(
						{
							model: this.modelName,
							messages,
							stream: true
						},
						abortSignal,
					);
					break;

				case 'chat':
				default:
					streamGenerator = createStreamingChatCompletion(
						{
							model: this.modelName,
							messages,
							stream: true
						},
						abortSignal,
					);
					break;
			}

			// Intercept streaming response and assemble complete content
			let completeContent = '';
			let chunkCount = 0;

			// Initialize token encoder for token counting
			let encoder;
			try {
				const {encoding_for_model} = await import('tiktoken');
				encoder = encoding_for_model('gpt-4');
			} catch (e) {
				const {encoding_for_model} = await import('tiktoken');
				encoder = encoding_for_model('gpt-3.5-turbo');
			}

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

							// Update token count if callback provided
							if (onTokenUpdate && encoder) {
								try {
									const tokens = encoder.encode(completeContent);
									onTokenUpdate(tokens.length);
								} catch (e) {
									// Ignore encoding errors
								}
							}
						}
					} else {
						// Responses, Gemini, and Anthropic APIs all use: {type: 'content', content: string}
						if (chunk.type === 'content' && chunk.content) {
							completeContent += chunk.content;

							// Update token count if callback provided
							if (onTokenUpdate && encoder) {
								try {
									const tokens = encoder.encode(completeContent);
									onTokenUpdate(tokens.length);
								} catch (e) {
									// Ignore encoding errors
								}
							}
						}
					}
				}
			} catch (streamError) {
				// Log streaming error with details
				if (streamError instanceof Error) {
					logger.error('Compact agent: Streaming error:', {
						error: streamError.message,
						stack: streamError.stack,
						name: streamError.name,
						chunkCount,
						contentLength: completeContent.length
					});
				} else {
					logger.error('Compact agent: Unknown streaming error:', {
						error: streamError,
						chunkCount,
						contentLength: completeContent.length
					});
				}
				throw streamError;
			} finally {
				// Free encoder
				if (encoder) {
					encoder.free();
				}
			}

			return completeContent;
		} catch (error) {
			// Log detailed error from API call setup or streaming
			if (error instanceof Error) {
				logger.error('Compact agent: API call failed:', {
					error: error.message,
					stack: error.stack,
					name: error.name,
					requestMethod: this.requestMethod,
					modelName: this.modelName
				});
			} else {
				logger.error('Compact agent: Unknown API error:', {
					error,
					requestMethod: this.requestMethod,
					modelName: this.modelName
				});
			}
			throw error;
		} finally {
			// Restore original config
			config.advancedModel = originalAdvancedModel;
		}
	}

	/**
	 * Extract key information from web page content based on user query
	 *
	 * @param content - Full web page content
	 * @param userQuery - User's original question/query
	 * @param url - URL of the web page (for context)
	 * @param abortSignal - Optional abort signal to cancel extraction
	 * @param onTokenUpdate - Optional callback to update token count during streaming
	 * @returns Extracted key information relevant to the query
	 */
	async extractWebPageContent(content: string, userQuery: string, url: string, abortSignal?: AbortSignal, onTokenUpdate?: (tokenCount: number) => void): Promise<string> {
		const available = await this.isAvailable();
		if (!available) {
			// If compact agent is not available, return original content
			return content;
		}

		try {
			const extractionPrompt = `You are a content extraction assistant. Your task is to extract and summarize the most relevant information from a web page based on the user's query.

User's Query: ${userQuery}

Web Page URL: ${url}

Web Page Content:
${content}

Instructions:
1. Extract ONLY the information that is directly relevant to the user's query
2. Preserve important details, facts, code examples, and key points
3. Remove navigation, ads, irrelevant sections, and boilerplate text
4. Organize the information in a clear, structured format
5. If there are multiple relevant sections, separate them clearly
6. Keep technical terms and specific details intact

Provide the extracted content below:`;

			const messages: ChatMessage[] = [
				{
					role: 'user',
					content: extractionPrompt,
				},
			];

			const extractedContent = await this.callCompactModel(messages, abortSignal, onTokenUpdate);

			if (!extractedContent || extractedContent.trim().length === 0) {
				logger.warn('Compact agent returned empty response, using original content');
				return content;
			}

			return extractedContent;
		} catch (error) {
			// Log detailed error information
			if (error instanceof Error) {
				logger.warn('Compact agent extraction failed, using original content:', {
					error: error.message,
					stack: error.stack,
					name: error.name
				});
			} else {
				logger.warn('Compact agent extraction failed with unknown error:', error);
			}
			return content;
		}
	}

}

// Export singleton instance
export const compactAgent = new CompactAgent();
