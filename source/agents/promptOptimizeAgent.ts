import {getOpenAiConfig} from '../utils/config/apiConfig.js';
import {logger} from '../utils/core/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {RequestMethod} from '../utils/config/apiConfig.js';

/**
 * Prompt Optimization Agent Service
 *
 * Optimizes user prompts for better AI understanding and response quality.
 * This service operates using the basic model for efficient, low-cost optimization.
 *
 * Features:
 * - Uses basicModel for efficient prompt optimization
 * - Follows the same API routing as main flow (chat, responses, gemini, anthropic)
 * - Filters context to only include user->assistant pairs without tool calls
 * - Returns optimized prompt that preserves user intent while improving clarity
 * - Silent execution with error handling to prevent main flow disruption
 */
export class PromptOptimizeAgent {
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private initialized: boolean = false;

	/**
	 * Initialize the prompt optimization agent with current configuration
	 * @returns true if initialized successfully, false otherwise
	 */
	private async initialize(): Promise<boolean> {
		try {
			const config = getOpenAiConfig();

			// Check if basic model is configured
			if (!config.basicModel) {
				logger.warn('Prompt optimize agent: Basic model not configured');
				return false;
			}

			this.modelName = config.basicModel;
			this.requestMethod = config.requestMethod;
			this.initialized = true;

			return true;
		} catch (error) {
			logger.warn('Prompt optimize agent: Failed to initialize:', error);
			return false;
		}
	}

	/**
	 * Check if prompt optimization agent is available
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
						max_tokens: 1000, // Limited tokens for prompt optimization
						includeBuiltinSystemPrompt: false,
						disableThinking: true, // Agents don't use Extended Thinking
					},
					abortSignal,
				);
				break;

			case 'gemini':
				streamGenerator = createStreamingGeminiCompletion(
					{
						model: this.modelName,
						messages,
						includeBuiltinSystemPrompt: false,
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
						includeBuiltinSystemPrompt: false,
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
						includeBuiltinSystemPrompt: false,
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
			logger.error('Prompt optimize agent: Streaming error:', streamError);
			throw streamError;
		}

		return completeContent;
	}

	/**
	 * Filter conversation history to only include user->assistant pairs without tool calls
	 * This creates a lightweight context for prompt optimization
	 *
	 * @param messages - Full conversation history
	 * @returns Filtered messages containing only user->assistant exchanges
	 */
	private filterContextMessages(messages: ChatMessage[]): ChatMessage[] {
		const filtered: ChatMessage[] = [];

		for (const msg of messages) {
			// Only include user and assistant messages
			if (msg.role === 'user' || msg.role === 'assistant') {
				// For assistant messages, skip if they contain tool calls
				if (msg.role === 'assistant') {
					// Check if message has tool_calls (OpenAI format) or tool_use content (Anthropic format)
					const hasToolCalls = !!(msg as any).tool_calls;
					const hasToolUseContent =
						Array.isArray(msg.content) &&
						msg.content.some(
							(c: any) => c.type === 'tool_use' || c.type === 'tool_call',
						);

					if (hasToolCalls || hasToolUseContent) {
						continue; // Skip assistant messages with tool calls
					}
				}

				// Add message to filtered list
				filtered.push(msg);
			}
		}

		return filtered;
	}

	/**
	 * Optimize user prompt for better AI understanding
	 *
	 * @param userPrompt - Original user prompt
	 * @param conversationHistory - Full conversation history for context
	 * @param abortSignal - Optional abort signal to cancel optimization
	 * @returns Optimized prompt, or original prompt if optimization fails
	 */
	async optimizePrompt(
		userPrompt: string,
		conversationHistory: ChatMessage[],
		abortSignal?: AbortSignal,
	): Promise<string> {
		const available = await this.isAvailable();
		if (!available) {
			return userPrompt;
		}

		try {
			// Check character count - if prompt < 100 characters, skip optimization
			// Short prompts likely lack context and may not benefit from optimization
			const charCount = userPrompt.trim().length;
			if (charCount < 100) {
				return userPrompt;
			}

			// Filter conversation history to lightweight context (only user<->assistant, no tool calls)
			const contextMessages = this.filterContextMessages(conversationHistory);

			// Build context summary if there's conversation history
			let contextSummary = '';
			if (contextMessages.length > 0) {
				// Take last 8 messages to keep context focused, but use full content (no truncation)
				const recentContext = contextMessages.slice(-8);
				contextSummary =
					'\n\nRecent conversation context:\n' +
					recentContext
						.map(msg => {
							const content =
								typeof msg.content === 'string'
									? msg.content
									: JSON.stringify(msg.content);
							// Use full message content (no truncation)
							return `${msg.role}: ${content}`;
						})
						.join('\n');
			}

			const optimizationPrompt = `You are a prompt optimization assistant. Your task is to improve user prompts for better AI understanding while maintaining HIGH FIDELITY to the original content.

User's original prompt:
${userPrompt}${contextSummary}

Your optimization goals (in priority order):
1. **HIGH FIDELITY REQUIREMENT**: Preserve ALL important information, details, and requirements from the user's original prompt - DO NOT lose or omit any critical content
2. Preserve the EXACT SAME LANGUAGE as the user (if Chinese, stay Chinese; if English, stay English)
3. Keep the core intent and meaning unchanged
4. Make the prompt clearer and more specific ONLY if vague - if already clear, keep it as-is
5. Add relevant context if the user is asking follow-up questions
6. Break down complex requests into clear requirements without losing details
7. Keep the tone natural and conversational
8. DO NOT add unnecessary formality or change the user's communication style
9. If the prompt is already clear and specific, return it as-is

CRITICAL RULES:
- NEVER remove important details, specific requirements, file paths, code snippets, or technical specifications
- NEVER simplify the prompt if it means losing user-provided information
- When in doubt, prefer preserving the original over optimizing
- The goal is CLARITY, not BREVITY - keep all important content

IMPORTANT: Output ONLY the optimized prompt text. No explanations, no meta-commentary, no JSON format. Just the optimized prompt itself.`;

			const messages: ChatMessage[] = [
				{
					role: 'user',
					content: optimizationPrompt,
				},
			];

			const optimizedPrompt = await this.callModel(messages, abortSignal);

			if (!optimizedPrompt || optimizedPrompt.trim().length === 0) {
				logger.warn(
					'Prompt optimize agent: Empty response, using original prompt',
				);
				return userPrompt;
			}

			// Clean up the response (remove any markdown formatting if present)
			let cleanedPrompt = optimizedPrompt.trim();

			// Remove markdown code blocks if present
			const codeBlockMatch = cleanedPrompt.match(/```[\s\S]*?\n([\s\S]*?)```/);
			if (codeBlockMatch) {
				cleanedPrompt = codeBlockMatch[1]!.trim();
			}

			// If optimized prompt is suspiciously short or looks like it failed, use original
			if (cleanedPrompt.length < userPrompt.length * 0.3) {
				logger.warn(
					'Prompt optimize agent: Optimized prompt too short, using original',
				);
				return userPrompt;
			}

			// Append original user message to ensure no information is lost
			const finalPrompt = `${cleanedPrompt}

---
Original user message: ${userPrompt}`;

			return finalPrompt;
		} catch (error) {
			logger.error('Prompt optimize agent: Failed to optimize prompt', error);
			return userPrompt;
		}
	}
}

// Export singleton instance
export const promptOptimizeAgent = new PromptOptimizeAgent();
