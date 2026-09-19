import {getSnowConfig} from '../utils/config/apiConfig.js';
import {logger} from '../utils/core/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {RequestMethod} from '../utils/config/apiConfig.js';
import {loadCodebaseConfig} from '../utils/config/codebaseConfig.js';
import {getDecisionModelsConfig} from '../utils/config/decisionModelsConfig.js';
import {
	evaluateRelevance,
	resolveDecisionModelReviewConfig,
	type DecisionModelReviewConfig,
} from '../api/decisionModel.js';

/** One search result as produced by the codebase search service. */
type ReviewResultItem = {
	rank: number;
	filePath: string;
	startLine: number;
	endLine: number;
	content: string;
	similarityScore: string;
	location: string;
};

/**
 * Codebase Review Agent Service
 *
 * Reviews codebase search results to filter out irrelevant items.
 *
 * Two review backends share this service:
 * - LLM (default): the active API config's basic model judges relevance with
 *   function calling and can suggest a refined search query.
 * - Decision model: when `codebase.agentReviewModelId` selects a configured
 *   decision model, its per-result verdict is the review; the LLM is only used
 *   to write a refined query when the verdict calls for a re-search.
 *
 * A decision-model failure (transport, protocol, missing configuration) falls
 * back to the full LLM review, so a search never degrades because of the
 * review backend.
 */
export class CodebaseReviewAgent {
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private initialized: boolean = false;
	private readonly MAX_RETRIES = 3;

	/**
	 * When the decision model removes more than this fraction of the results,
	 * ask the LLM for a refined query so the search can be retried.
	 */
	private readonly DECISION_RESEARCH_THRESHOLD = 0.5;

	/**
	 * Function calling tool definition for result review
	 */
	private readonly REVIEW_TOOL = {
		type: 'function' as const,
		function: {
			name: 'review_search_results',
			description:
				'Review code search results and identify relevant ones, suggest improvements',
			parameters: {
				type: 'object',
				properties: {
					relevantIndices: {
						type: 'array',
						items: {type: 'integer'},
						description:
							'Array of relevant result indices (1-based). Example: [1, 3, 5]',
					},
					removedIndices: {
						type: 'array',
						items: {type: 'integer'},
						description:
							'Array of irrelevant result indices that should be removed (1-based). Example: [2, 4]',
					},
					suggestion: {
						type: 'string',
						description:
							'If there are relevant results but not enough, extract actual code snippet from the RELEVANT results to use as new search term. Copy real code text like function names, class names, key variable names, or important code lines. Example: if relevant result contains "async function validateUserInput(data)", extract "validateUserInput" or "async function validateUserInput". This helps find similar code patterns.',
					},
					highConfidenceFiles: {
						type: 'array',
						items: {type: 'string'},
						description:
							'File paths with high confidence that may contain more relevant code. Include files with >2 relevant results or core implementation files',
					},
				},
				required: ['relevantIndices', 'removedIndices'],
			},
		},
	};

	/**
	 * Initialize the review agent with current configuration
	 */
	private async initialize(): Promise<boolean> {
		try {
			const config = getSnowConfig();

			if (!config.basicModel) {
				logger.warn(
					'Codebase review agent: Basic model not configured, using advanced model as fallback',
				);
				if (!config.advancedModel) {
					logger.warn('Codebase review agent: No model configured');
					return false;
				}
				this.modelName = config.advancedModel;
			} else {
				this.modelName = config.basicModel;
			}

			this.requestMethod = config.requestMethod;
			this.initialized = true;

			return true;
		} catch (error) {
			logger.warn('Codebase review agent: Failed to initialize:', error);
			return false;
		}
	}

	/**
	 * Clear cached configuration (called when profile switches)
	 */
	clearCache(): void {
		// The decision model selection is read from the codebase config on every
		// review, so there is nothing to cache or clear for it here.
		this.initialized = false;
		this.modelName = '';
		this.requestMethod = 'chat';
	}

	/**
	 * Check if review agent is available
	 */
	async isAvailable(): Promise<boolean> {
		if (!this.initialized) {
			return await this.initialize();
		}
		return true;
	}

	/**
	 * Call the model with streaming API and assemble complete response
	 * Uses Function Calling to ensure structured output
	 */
	private async callModel(
		messages: ChatMessage[],
		abortSignal?: AbortSignal,
		useReviewTool: boolean = true,
	): Promise<{content: string; tool_calls?: any[]}> {
		let streamGenerator: AsyncGenerator<any, void, unknown>;

		switch (this.requestMethod) {
			case 'anthropic':
				streamGenerator = createStreamingAnthropicCompletion(
					{
						model: this.modelName,
						messages,
						...(useReviewTool ? {tools: [this.REVIEW_TOOL]} : {}),
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
					},
					abortSignal,
				);
				break;

			case 'gemini':
				streamGenerator = createStreamingGeminiCompletion(
					{
						model: this.modelName,
						messages,
						...(useReviewTool ? {tools: [this.REVIEW_TOOL]} : {}),
						includeBuiltinSystemPrompt: false,
						disableThinking: true, // Agents 不使用思考功能
					},
					abortSignal,
				);
				break;

			case 'responses':
				streamGenerator = createStreamingResponse(
					{
						model: this.modelName,
						messages,
						...(useReviewTool ? {tools: [this.REVIEW_TOOL]} : {}),
						stream: true,
						includeBuiltinSystemPrompt: false,
						disableThinking: true, // Agents 不使用思考功能
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
						...(useReviewTool ? {tools: [this.REVIEW_TOOL]} : {}),
						stream: true,
						includeBuiltinSystemPrompt: false,
						disableThinking: true, // Agents 不使用思考功能
					},
					abortSignal,
				);
				break;
		}

		let completeContent = '';
		let tool_calls: any[] = [];

		try {
			for await (const chunk of streamGenerator) {
				if (abortSignal?.aborted) {
					throw new Error('Request aborted');
				}

				// All streaming APIs yield the unified StreamChunk format
				if (chunk.type === 'content' && chunk.content) {
					completeContent += chunk.content;
				}
				if (chunk.type === 'tool_calls' && chunk.tool_calls) {
					tool_calls = chunk.tool_calls;
				}
			}
		} catch (streamError) {
			logger.error('Codebase review agent: Streaming error:', streamError);
			throw streamError;
		}

		return {content: completeContent, tool_calls};
	}

	/**
	 * Try to parse JSON response with retry logic
	 */
	private tryParseJSON(response: string): any | null {
		try {
			// Extract JSON from markdown code blocks if present
			let jsonStr = response.trim();
			const jsonMatch = jsonStr.match(
				/```(?:json)?\\s*\\n?([\\s\\S]*?)\\n?```/,
			);
			if (jsonMatch) {
				jsonStr = jsonMatch[1]!.trim();
			}

			const parsed = JSON.parse(jsonStr);

			// Validate structure
			if (!Array.isArray(parsed.relevantIndices)) {
				logger.warn(
					'Codebase review agent: Invalid JSON structure - missing relevantIndices array',
				);
				return null;
			}

			return parsed;
		} catch (error) {
			logger.warn('Codebase review agent: JSON parse error:', error);
			return null;
		}
	}

	/**
	 * Review search results with retry mechanism
	 */
	private async reviewWithRetry(
		query: string,
		results: Array<{
			rank: number;
			filePath: string;
			startLine: number;
			endLine: number;
			content: string;
			similarityScore: string;
			location: string;
		}>,
		conversationContext?: Array<{role: string; content: string}>,
		abortSignal?: AbortSignal,
	): Promise<{parsed: any; attempt: number} | null> {
		// Build conversation context section
		let conversationSection = '';
		if (conversationContext && conversationContext.length > 0) {
			conversationSection =
				`\n\nConversation Context (Recent Messages):\n` +
				conversationContext
					.map((msg, idx) => `[${idx + 1}] ${msg.role}: ${msg.content}`)
					.join('\n') +
				'\n';
		}

		const reviewPrompt = `You are a code search result reviewer. Your task is to analyze search results and determine which ones are truly relevant to the user's query.
${conversationSection}
Search Query: "${query}"

Search Results (${results.length} items):
${results
	.map(
		(r, idx) =>
			`\n[Result ${idx + 1}]
File: ${r.filePath}
Lines: ${r.startLine}-${r.endLine}
Similarity Score: ${r.similarityScore}%
Code:
\`\`\`
${r.content}
\`\`\``,
	)
	.join('\n---')}

Please call the review_search_results function to provide your analysis.

Guidelines:
- Be strict but fair: code doesn't need to match exactly, but should be semantically related
- Consider file paths, code content, and context
- If a result is marginally relevant, keep it
- IMPORTANT for suggestion: If there are relevant results but not enough (results < threshold), extract actual code snippet from the RELEVANT results. Copy real code text like function names, class names, key variable names, or important code lines that appear in relevant results. Example: if relevant result contains "async function validateUserInput(data)", extract "validateUserInput" or "async function validateUserInput". Use this extracted code as the new search term to find similar code patterns.
- Identify files with >2 relevant results OR that seem to be core implementation files (look for patterns: multiple hits, core modules, entry points)`;

		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: reviewPrompt,
			},
		];

		// Retry loop
		for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
			try {
				logger.info(
					`Codebase review agent: Attempt ${attempt}/${this.MAX_RETRIES}`,
				);

				const response = await this.callModel(messages, abortSignal);

				// Check for empty response
				if (
					!response ||
					(!response.content &&
						(!response.tool_calls || response.tool_calls.length === 0))
				) {
					logger.warn(
						`Codebase review agent: Empty response on attempt ${attempt}`,
					);
					if (attempt < this.MAX_RETRIES) {
						await this.sleep(500 * attempt); // Exponential backoff
						continue;
					}
					return null;
				}

				// Try to parse from tool calls first (more reliable)
				if (response.tool_calls && response.tool_calls.length > 0) {
					try {
						const toolCall = response.tool_calls[0];
						if (
							toolCall.type === 'function' &&
							toolCall.function?.name === 'review_search_results'
						) {
							const parsed = JSON.parse(toolCall.function.arguments);

							// Validate structure
							if (!Array.isArray(parsed.relevantIndices)) {
								logger.warn(
									`Codebase review agent: Tool call returned invalid structure on attempt ${attempt}`,
								);
								if (attempt < this.MAX_RETRIES) {
									await this.sleep(500 * attempt);
									continue;
								}
								return null;
							}

							logger.info(
								`Codebase review agent: Successfully parsed from tool call on attempt ${attempt}`,
							);
							return {parsed, attempt};
						}
					} catch (toolError) {
						logger.warn(
							'Codebase review agent: Tool call parse error:',
							toolError,
						);
						// Fall through to try JSON parsing from content
					}
				}

				// Fallback: Try to parse JSON from content
				if (response.content) {
					const parsed = this.tryParseJSON(response.content);
					if (parsed) {
						logger.info(
							`Codebase review agent: Successfully parsed from content on attempt ${attempt}`,
						);
						return {parsed, attempt};
					}
				}

				// If parse failed and we have retries left
				if (attempt < this.MAX_RETRIES) {
					logger.warn(
						`Codebase review agent: Parse failed on attempt ${attempt}, retrying...`,
					);
					await this.sleep(500 * attempt); // Exponential backoff
					continue;
				}

				return null;
			} catch (error) {
				logger.error(
					`Codebase review agent: Error on attempt ${attempt}:`,
					error,
				);
				if (attempt < this.MAX_RETRIES) {
					await this.sleep(500 * attempt); // Exponential backoff
					continue;
				}
				return null;
			}
		}

		return null;
	}

	/**
	 * Sleep utility for retry backoff
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Resolve the decision model selected for codebase agent review.
	 *
	 * Returns `undefined` when nothing is selected, when the selected entry no
	 * longer exists, or when its request information is incomplete — the caller
	 * then keeps using the LLM review path.
	 */
	private resolveDecisionReviewConfig(): DecisionModelReviewConfig | undefined {
		try {
			const config = loadCodebaseConfig();
			const modelId = config.agentReviewModelId?.trim();
			if (!modelId) {
				return undefined;
			}

			const models = getDecisionModelsConfig();
			const item = models?.models.find(model => model.id === modelId);
			if (!item) {
				logger.warn(
					`Codebase review agent: Decision model "${modelId}" not found, using LLM review`,
				);
				return undefined;
			}

			const resolved = resolveDecisionModelReviewConfig(item);
			if (!resolved) {
				logger.warn(
					`Codebase review agent: Decision model "${modelId}" is missing API key or model, using LLM review`,
				);
				return undefined;
			}

			return resolved;
		} catch (error) {
			logger.warn(
				'Codebase review agent: Failed to resolve the decision model, using LLM review:',
				error,
			);
			return undefined;
		}
	}

	/**
	 * Review results with the selected decision model.
	 *
	 * The decision model's verdict *is* the review, so the LLM is never asked to
	 * judge the same results again. A decision model cannot write a refined
	 * query, so when the verdict removes enough results to warrant a re-search
	 * the LLM is asked for that single job. Any failure returns `null` and the
	 * caller falls back to the full LLM review.
	 */
	private async reviewViaDecisionModel(
		config: DecisionModelReviewConfig,
		query: string,
		results: ReviewResultItem[],
		abortSignal?: AbortSignal,
	): Promise<{
		filteredResults: ReviewResultItem[];
		removedCount: number;
		suggestion?: string;
		reviewFailed: boolean;
	} | null> {
		try {
			const relevantIndices = await evaluateRelevance(
				config,
				query,
				results,
				abortSignal,
			);

			const filteredResults = results.filter((_, index) =>
				relevantIndices.includes(index),
			);
			const removedCount = results.length - filteredResults.length;

			let suggestion: string | undefined;
			const removedFraction =
				results.length > 0 ? removedCount / results.length : 0;
			if (removedFraction > this.DECISION_RESEARCH_THRESHOLD) {
				suggestion = await this.generateRefinedQuery(
					query,
					results,
					abortSignal,
				);
			}

			logger.info('Codebase review agent: Decision model review completed', {
				originalCount: results.length,
				filteredCount: filteredResults.length,
				removedCount,
				hasSuggestion: Boolean(suggestion),
			});

			return {
				filteredResults,
				removedCount,
				suggestion,
				reviewFailed: false,
			};
		} catch (error) {
			logger.warn(
				'Codebase review agent: Decision model review failed, falling back to LLM review:',
				error,
			);
			return null;
		}
	}

	/**
	 * Ask the LLM for a better search query.
	 *
	 * The decision model cannot rewrite the query, so this is the only LLM job
	 * in the decision review path. A failure keeps the decision verdict and
	 * simply drops the suggestion.
	 */
	private async generateRefinedQuery(
		query: string,
		results: ReviewResultItem[],
		abortSignal?: AbortSignal,
	): Promise<string | undefined> {
		try {
			const resultsSummary = results
				.map(
					(result, index) =>
						`[${index + 1}] ${result.filePath} (lines ${result.startLine}-${
							result.endLine
						})\n${result.content.slice(0, 400)}`,
				)
				.join('\n---\n');

			const messages: ChatMessage[] = [
				{
					role: 'user',
					content: `The developer's code search query returned mostly irrelevant results.\n\nOriginal query: "${query}"\n\nResults:\n${resultsSummary}\n\nWrite a better search query that is more likely to find the code they are actually looking for. Output ONLY the new search query on a single line: no quotes, no explanation, no markdown, no JSON. Keep the same language as the original query. If no better query exists, repeat the original query unchanged.`,
				},
			];

			const response = await this.callModel(messages, abortSignal, false);
			const refined = response.content
				.split('\n')
				.map(line => line.trim())
				.find(line => line.length > 0)
				?.replace(/^["'`]+|["'`]+$/g, '')
				.trim();

			if (!refined || refined === query) {
				return undefined;
			}

			return refined;
		} catch (error) {
			logger.warn(
				'Codebase review agent: Failed to generate a refined query, keeping the decision verdict:',
				error,
			);
			return undefined;
		}
	}

	/**
	 * Review search results and filter out irrelevant ones
	 * With retry mechanism and graceful degradation
	 *
	 * @param query - Original search query
	 * @param results - Search results to review
	 * @param conversationContext - Optional conversation context (messages without tool calls)
	 * @param returns Object with filtered results and optional suggestion
	 */
	async reviewResults(
		query: string,
		results: Array<{
			rank: number;
			filePath: string;
			startLine: number;
			endLine: number;
			content: string;
			similarityScore: string;
			location: string;
		}>,
		conversationContext?: Array<{role: string; content: string}>,
		abortSignal?: AbortSignal,
	): Promise<{
		filteredResults: typeof results;
		removedCount: number;
		suggestion?: string;
		highConfidenceFiles?: string[];
		reviewFailed?: boolean;
	}> {
		// A decision model selected for review replaces the generative review
		// entirely; any failure falls through to the LLM review below.
		const decisionConfig = this.resolveDecisionReviewConfig();
		if (decisionConfig) {
			const decisionReview = await this.reviewViaDecisionModel(
				decisionConfig,
				query,
				results,
				abortSignal,
			);
			if (decisionReview) {
				return decisionReview;
			}
		}

		const available = await this.isAvailable();

		if (!available) {
			logger.warn(
				'Codebase review agent: Not available, returning original results',
			);
			return {
				filteredResults: results,
				removedCount: 0,
				reviewFailed: true,
			};
		}

		// Attempt review with retry
		const reviewResult = await this.reviewWithRetry(
			query,
			results,
			conversationContext,
			abortSignal,
		);

		// If all retries failed, gracefully degrade
		if (!reviewResult) {
			logger.warn(
				'Codebase review agent: All retry attempts failed, returning original results',
			);
			return {
				filteredResults: results,
				removedCount: 0,
				reviewFailed: true,
			};
		}

		// Success - filter results
		const {parsed, attempt} = reviewResult;

		const filteredResults = results.filter((_, idx) =>
			parsed.relevantIndices.includes(idx + 1),
		);

		const removedCount = results.length - filteredResults.length;

		logger.info('Codebase review agent: Review completed', {
			originalCount: results.length,
			filteredCount: filteredResults.length,
			removedCount,
			attempts: attempt,
			hasSuggestion: !!parsed.suggestion,
			hasHighConfidenceFiles: !!parsed.highConfidenceFiles?.length,
		});

		return {
			filteredResults,
			removedCount,
			suggestion: parsed.suggestion || undefined,
			highConfidenceFiles: parsed.highConfidenceFiles || undefined,
			reviewFailed: false,
		};
	}
}

// Export singleton instance
export const codebaseReviewAgent = new CodebaseReviewAgent();
