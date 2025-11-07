import {CodebaseDatabase} from '../utils/codebaseDatabase.js';
import {createEmbedding} from '../api/embedding.js';
import {logger} from '../utils/logger.js';
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
	private isCodebaseIndexAvailable(): {available: boolean; reason?: string} {
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
			db.initialize();

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
	 * Search codebase using semantic similarity
	 */
	async search(query: string, topN: number = 10): Promise<any> {
		// Check if codebase index is available
		const {available, reason} = this.isCodebaseIndexAvailable();
		if (!available) {
			return {
				error: reason,
				results: [],
				totalResults: 0,
			};
		}

		try {
			const projectRoot = process.cwd();
			const db = new CodebaseDatabase(projectRoot);
			db.initialize();

			const totalChunks = db.getTotalChunks();

			// Generate embedding for query
			logger.info(`Generating embedding for query: "${query}"`);
			const queryEmbedding = await createEmbedding(query);

			// Search similar chunks
			logger.info(
				`Searching top ${topN} similar chunks from ${totalChunks} total chunks`,
			);
			const results = db.searchSimilar(queryEmbedding, topN);

			// Format results with similarity scores and full content (no truncation)
			const formattedResults = results.map((chunk, index) => {
				const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
				const scorePercent = (score * 100).toFixed(2);

				return {
					rank: index + 1,
					filePath: chunk.filePath,
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					content: chunk.content, // Full content, no truncation
					similarityScore: scorePercent,
					location: `${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`,
				};
			});

			db.close();

			return {
				query,
				totalChunks,
				resultsCount: formattedResults.length,
				results: formattedResults,
			};
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
			'🔍 Semantic search across the codebase using embeddings. ' +
			'Finds code snippets similar to your query based on meaning, not just keywords. ' +
			'Returns full code content with similarity scores and file locations. ' +
			'NOTE: Only available when codebase indexing is enabled and the index has been built. ' +
			'If the index is not available, the tool will return an error message with instructions.',
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
