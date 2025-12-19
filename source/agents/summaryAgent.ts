import {getOpenAiConfig} from '../utils/config/apiConfig.js';
import {logger} from '../utils/core/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {RequestMethod} from '../utils/config/apiConfig.js';

/**
 * Summary Agent Service
 *
 * Generates concise summaries for conversations after the first user-assistant exchange.
 * This service operates in the background without blocking the main conversation flow.
 *
 * Features:
 * - Uses basicModel for efficient, low-cost summarization
 * - Follows the same API routing as main flow (chat, responses, gemini, anthropic)
 * - Generates title (max 50 chars) and summary (max 150 chars)
 * - Only runs once after the first complete conversation exchange
 * - Silent execution with error handling to prevent main flow disruption
 */
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

			// Use basicModel first, fallback to advancedModel if not configured
			const basicModel = config.basicModel?.trim();
			const advancedModel = config.advancedModel?.trim();

			if (basicModel) {
				this.modelName = basicModel;
			} else if (advancedModel) {
				this.modelName = advancedModel;
			} else {
				logger.warn('Summary agent: No model configured');
				return false;
			}

			this.requestMethod = config.requestMethod;
			this.initialized = true;

			return true;
		} catch (error) {
			logger.warn('Summary agent: Failed to initialize:', error);
			return false;
		}
	}

	/**
	 * Clear cached configuration (called when profile switches)
	 */
	clearCache(): void {
		this.initialized = false;
		this.modelName = '';
		this.requestMethod = 'chat';
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
	 * Call the model with streaming API and assemble complete response
	 * Uses the same routing logic as main flow for consistency
	 *
	 * @param messages - Chat messages
	 * @param abortSignal - Optional abort signal to cancel the request
	 */
	private async callModel(
		messages: ChatMessage[],
		abortSignal?: AbortSignal,
	): Promise<string> {
		let streamGenerator: AsyncGenerator<any, void, unknown>;

		// Route to appropriate streaming API based on request method
		switch (this.requestMethod) {
			case 'anthropic':
				streamGenerator = createStreamingAnthropicCompletion(
					{
						model: this.modelName,
						messages,
						max_tokens: 500, // Limited tokens for summary generation
						includeBuiltinSystemPrompt: false, // 不需要内置系统提示词
						disableThinking: true, // Agents 不使用 Extended Thinking
					},
					abortSignal,
				);
				break;

			case 'gemini':
				streamGenerator = createStreamingGeminiCompletion(
					{
						model: this.modelName,
						messages,
						includeBuiltinSystemPrompt: false, // 不需要内置系统提示词
					},
					abortSignal,
				);
				break;

			case 'responses':
				streamGenerator = createStreamingResponse(
					{
						model: this.modelName,
						messages,
						stream: true,
						includeBuiltinSystemPrompt: false, // 不需要内置系统提示词
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
						stream: true,
						includeBuiltinSystemPrompt: false, // 不需要内置系统提示词
					},
					abortSignal,
				);
				break;
		}

		// Assemble complete content from streaming response
		let completeContent = '';

		try {
			for await (const chunk of streamGenerator) {
				// Check abort signal
				if (abortSignal?.aborted) {
					throw new Error('Request aborted');
				}

				// Handle different chunk formats based on request method
				if (this.requestMethod === 'chat') {
					// Chat API uses standard OpenAI format
					if (chunk.choices && chunk.choices[0]?.delta?.content) {
						completeContent += chunk.choices[0].delta.content;
					}
				} else {
					// Responses, Gemini, and Anthropic APIs use unified format
					if (chunk.type === 'content' && chunk.content) {
						completeContent += chunk.content;
					}
				}
			}
		} catch (streamError) {
			logger.error('Summary agent: Streaming error:', streamError);
			throw streamError;
		}

		return completeContent;
	}

	/**
	 * Generate title and summary for a conversation
	 *
	 * @param userMessage - User's first message content
	 * @param assistantMessage - Assistant's first response content
	 * @param abortSignal - Optional abort signal to cancel generation
	 * @returns Object containing title and summary, or null if generation fails
	 */
	async generateSummary(
		userMessage: string,
		assistantMessage: string,
		abortSignal?: AbortSignal,
	): Promise<{title: string; summary: string} | null> {
		const available = await this.isAvailable();
		if (!available) {
			logger.warn('Summary agent: Not available, using fallback summary');
			return this.generateFallbackSummary(userMessage, assistantMessage);
		}

		try {
			const summaryPrompt = `You are a conversation summarization assistant. Based on the first exchange between the user and AI assistant below, generate a concise title and summary.

IMPORTANT: Generate the title and summary in the SAME LANGUAGE as the user's message. If the user writes in Chinese, respond in Chinese. If in English, respond in English.

User message:
${userMessage}

AI assistant reply:
${assistantMessage}

Requirements:
1. Generate a short title (max 50 characters) that captures the conversation topic
2. Generate a summary (max 150 characters) that briefly describes the core content
3. Title should be concise and clear, avoid complete sentences
4. Summary should contain key information while staying brief
5. Use the SAME LANGUAGE as the user's message

Output in the following JSON format (JSON only, no other content):
{
  "title": "Conversation title",
  "summary": "Conversation summary"
}`;

			const messages: ChatMessage[] = [
				{
					role: 'user',
					content: summaryPrompt,
				},
			];

			const response = await this.callModel(messages, abortSignal);

			if (!response || response.trim().length === 0) {
				logger.warn('Summary agent: Empty response, using fallback');
				return this.generateFallbackSummary(userMessage, assistantMessage);
			}

			// Parse JSON response
			try {
				// Extract JSON from markdown code blocks if present
				let jsonStr = response.trim();
				const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
				if (jsonMatch) {
					jsonStr = jsonMatch[1]!.trim();
				}

				const parsed = JSON.parse(jsonStr);

				if (!parsed.title || !parsed.summary) {
					logger.warn('Summary agent: Invalid JSON structure, using fallback');
					return this.generateFallbackSummary(userMessage, assistantMessage);
				}

				// Ensure title and summary are within length limits
				const title = this.truncateString(parsed.title, 50);
				const summary = this.truncateString(parsed.summary, 150);

				logger.info('Summary agent: Successfully generated summary', {
					title,
					summary,
				});

				return {title, summary};
			} catch (parseError) {
				logger.warn(
					'Summary agent: Failed to parse JSON response, using fallback',
					parseError,
				);
				return this.generateFallbackSummary(userMessage, assistantMessage);
			}
		} catch (error) {
			logger.error('Summary agent: Failed to generate summary', error);
			return this.generateFallbackSummary(userMessage, assistantMessage);
		}
	}

	/**
	 * Generate fallback summary when AI generation fails
	 * Simply truncates the user message for title and summary
	 */
	private generateFallbackSummary(
		userMessage: string,
		_assistantMessage: string,
	): {title: string; summary: string} {
		// Clean newlines and extra spaces
		const cleanedUser = userMessage
			.replace(/[\r\n]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		// Use first 50 chars as title
		const title = this.truncateString(cleanedUser, 50);

		// Use first 150 chars as summary
		const summary = this.truncateString(cleanedUser, 150);

		return {title, summary};
	}

	/**
	 * Truncate string to specified length, adding ellipsis if truncated
	 */
	private truncateString(str: string, maxLength: number): string {
		if (str.length <= maxLength) {
			return str;
		}
		return str.slice(0, maxLength - 3) + '...';
	}
}

// Export singleton instance
export const summaryAgent = new SummaryAgent();
