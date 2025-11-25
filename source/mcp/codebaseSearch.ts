import {CodebaseDatabase} from '../utils/codebase/codebaseDatabase.js';
import {createEmbedding} from '../api/embedding.js';
import {logger} from '../utils/core/logger.js';
import {codebaseReviewAgent} from '../agents/codebaseReviewAgent.js';
import {codebaseSearchEvents} from '../utils/codebase/codebaseSearchEvents.js';
import {loadCodebaseConfig} from '../utils/config/codebaseConfig.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Codebase Search Service
 * Provides semantic search capabilities for the codebase using embeddings
 */
class CodebaseSearchService {
	/**
	 * Check if codebase index is available and has data
	 */
	private async isCodebaseIndexAvailable(): Promise<{
		available: boolean;
		reason?: string;
	}> {
		try {
			const projectRoot = process.cwd();
			const dbPath = path.join(
				projectRoot,
				'.snow',
				'codebase',
				'embeddings.db',
			);

			// Check if database file exists
			if (!fs.existsSync(dbPath)) {
				return {
					available: false,
					reason:
						'Codebase index not found. Please run codebase indexing first.',
				};
			}

			// Initialize database and check for data
			const db = new CodebaseDatabase(projectRoot);
			await db.initialize();

			const totalChunks = db.getTotalChunks();
			db.close();

			if (totalChunks === 0) {
				return {
					available: false,
					reason:
						'Codebase index is empty. Please run indexing to build the index.',
				};
			}

			return {available: true};
		} catch (error) {
			logger.error('Error checking codebase index availability:', error);
			return {
				available: false,
				reason: `Error checking codebase index: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			};
		}
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error('Vectors must have same length');
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i]! * b[i]!;
			normA += a[i]! * a[i]!;
			normB += b[i]! * b[i]!;
		}

		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	}

	/**
	 * Search codebase using semantic similarity with retry logic
	 */
	async search(query: string, topN: number = 10): Promise<any> {
		// Load codebase config
		const config = loadCodebaseConfig();
		const enableAgentReview = config.enableAgentReview;

		// Check if codebase index is available
		const {available, reason} = await this.isCodebaseIndexAvailable();
		if (!available) {
			return {
				error: reason,
				results: [],
				totalResults: 0,
			};
		}

		const MAX_SEARCH_RETRIES = 3;
		const MIN_RESULTS_THRESHOLD = Math.ceil(topN * 0.5); // 50% of topN

		try {
			const projectRoot = process.cwd();
			const db = new CodebaseDatabase(projectRoot);
			await db.initialize();

			const totalChunks = db.getTotalChunks();

			let lastResults: any = null;
			let searchAttempt = 0;
			let currentTopN = topN;

			// Retry loop: if results are too few, increase search range and retry
			while (searchAttempt < MAX_SEARCH_RETRIES) {
				searchAttempt++;

				// Emit search event (only if agent review is enabled)
				if (enableAgentReview) {
					codebaseSearchEvents.emitSearchEvent({
						type: searchAttempt === 1 ? 'search-start' : 'search-retry',
						attempt: searchAttempt,
						maxAttempts: MAX_SEARCH_RETRIES,
						currentTopN,
						message: `Searching top ${currentTopN} code chunks...`,
						query,
					});
				}

				// Generate embedding for query
				logger.info(
					`Search attempt ${searchAttempt}/${MAX_SEARCH_RETRIES}: Searching top ${currentTopN} chunks for query: "${query}"`,
				);
				const queryEmbedding = await createEmbedding(query);

				// Search similar chunks
				const results = db.searchSimilar(queryEmbedding, currentTopN);

				// Format results with similarity scores and full content
				const formattedResults = results.map((chunk, index) => {
					const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
					const scorePercent = (score * 100).toFixed(2);

					return {
						rank: index + 1,
						filePath: chunk.filePath,
						startLine: chunk.startLine,
						endLine: chunk.endLine,
						content: chunk.content,
						similarityScore: scorePercent,
						location: `${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`,
					};
				});

				// Use review agent to filter irrelevant results (if enabled)
				let finalResults;
				let reviewFailed = false;
				let removedCount = 0;
				let suggestions: string[] = [];

				if (enableAgentReview) {
					// Emit reviewing event
					codebaseSearchEvents.emitSearchEvent({
						type: 'search-retry',
						attempt: searchAttempt,
						maxAttempts: MAX_SEARCH_RETRIES,
						currentTopN,
						message: `Reviewing ${formattedResults.length} results with AI...`,
						query,
					});

					logger.info(
						`Reviewing ${formattedResults.length} search results (attempt ${searchAttempt})`,
					);
					const reviewResult = await codebaseReviewAgent.reviewResults(
						query,
						formattedResults,
					);

					finalResults = reviewResult.filteredResults;
					reviewFailed = reviewResult.reviewFailed || false;
					removedCount = reviewResult.removedCount;
					suggestions = reviewResult.suggestions || [];
				} else {
					// Skip agent review, use all formatted results
					finalResults = formattedResults;
					reviewFailed = false;
					removedCount = 0;
					suggestions = [];

					// When agent review is disabled, we don't need to retry
					// Just return results immediately
					logger.info(
						`Agent review disabled, returning all ${finalResults.length} search results`,
					);
				}

				// Store current results as last results
				lastResults = {
					query,
					totalChunks,
					originalResultsCount: formattedResults.length,
					resultsCount: finalResults.length,
					removedCount,
					reviewFailed,
					results: finalResults,
					suggestions,
					searchAttempts: searchAttempt,
				};

				// If agent review is disabled, return immediately (no need to retry)
				if (!enableAgentReview) {
					// Emit search complete event
					codebaseSearchEvents.emitSearchEvent({
						type: 'search-complete',
						attempt: searchAttempt,
						maxAttempts: MAX_SEARCH_RETRIES,
						currentTopN,
						message: `Found ${finalResults.length} results`,
						query,
					});

					db.close();
					return lastResults;
				}

				// If review failed, return immediately (no point retrying)
				if (reviewFailed) {
					logger.info('Review failed, returning all results without retry');

					// Emit search complete event
					codebaseSearchEvents.emitSearchEvent({
						type: 'search-complete',
						attempt: searchAttempt,
						maxAttempts: MAX_SEARCH_RETRIES,
						currentTopN,
						message: 'Review failed, returning all results',
						query,
					});

					db.close();
					return lastResults;
				}

				// Check if we have enough results
				if (finalResults.length >= MIN_RESULTS_THRESHOLD) {
					logger.info(
						`Found ${finalResults.length} results (>= ${MIN_RESULTS_THRESHOLD} threshold), search complete`,
					);

					// Emit search complete event
					codebaseSearchEvents.emitSearchEvent({
						type: 'search-complete',
						attempt: searchAttempt,
						maxAttempts: MAX_SEARCH_RETRIES,
						currentTopN,
						message: `Found ${finalResults.length} relevant results`,
						query,
					});

					db.close();
					return lastResults;
				}

				// Too few results, need to retry with more candidates
				if (searchAttempt < MAX_SEARCH_RETRIES) {
					const removedPercentage = (
						(removedCount / formattedResults.length) *
						100
					).toFixed(1);
					logger.warn(
						`Only ${finalResults.length} results after filtering (${removedPercentage}% removed, threshold: ${MIN_RESULTS_THRESHOLD}). Retrying with more candidates...`,
					);

					// Increase search range for next attempt (double it)
					currentTopN = Math.min(currentTopN * 2, totalChunks);
					continue;
				}

				// Last attempt exhausted
				logger.warn(
					`Search attempt ${searchAttempt} complete. Only ${finalResults.length} results found (threshold: ${MIN_RESULTS_THRESHOLD}). Returning last results.`,
				);
			}

			// Emit search complete event before closing
			codebaseSearchEvents.emitSearchEvent({
				type: 'search-complete',
				attempt: searchAttempt,
				maxAttempts: MAX_SEARCH_RETRIES,
				currentTopN,
				message: `Completed with ${lastResults?.resultsCount || 0} results`,
				query,
			});

			db.close();
			return lastResults;
		} catch (error) {
			logger.error('Codebase search failed:', error);
			throw error;
		}
	}
}

// Export singleton instance
export const codebaseSearchService = new CodebaseSearchService();

/**
 * MCP Tools Definition
 */
export const mcpTools = [
	{
		name: 'codebase-search',
		description:
		    '**Important:When you need to search for code, this is the highest priority tool. You need to use this Codebase tool first.**'+
			'* Semantic search across the codebase using embeddings. ' +
			'* Finds code snippets similar to your query based on meaning, not just keywords. ' +
			'* Returns full code content with similarity scores and file locations. ' +
			'* NOTE: Only available when codebase indexing is enabled and the index has been built. ' +
			'* If the index is not available, the tool will return an error message with instructions.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Search query describing the code you want to find (e.g., "database query", "error handling", "authentication logic")',
				},
				topN: {
					type: 'number',
					description:
						'Maximum number of results to return (default: 10, max: 50)',
					default: 10,
					minimum: 1,
					maximum: 50,
				},
			},
			required: ['query'],
		},
	},
];
