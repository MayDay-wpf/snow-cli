import {loadCodebaseConfig} from '../utils/config/codebaseConfig.js';
import {logger} from '../utils/core/logger.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';
import {getVersionHeader} from '../utils/core/version.js';

export interface RerankOptions {
	model?: string;
	query: string;
	documents: string[];
	topN?: number;
	baseUrl?: string;
	apiKey?: string;
	contextLength?: number;
}

export interface RerankResult {
	index: number;
	relevanceScore: number;
}

export interface RerankResponse {
	results: RerankResult[];
	droppedDocuments?: number;
	truncatedDocuments?: number;
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const CONTEXT_RESERVE_RATIO = 0.95;
const SINGLE_DOC_MAX_RATIO = 0.3;

/**
 * Count tokens using tiktoken. Falls back to char-based estimation.
 */
async function countTokens(text: string): Promise<number> {
	try {
		const {encoding_for_model} = await import('tiktoken');
		let encoder;
		try {
			encoder = encoding_for_model('gpt-5');
		} catch {
			encoder = encoding_for_model('gpt-3.5-turbo');
		}
		try {
			return encoder.encode(text).length;
		} finally {
			encoder.free();
		}
	} catch {
		return Math.ceil(text.length / 4);
	}
}

/**
 * Truncate text to fit within a token budget.
 */
async function truncateText(
	text: string,
	maxTokens: number,
): Promise<string> {
	try {
		const {encoding_for_model} = await import('tiktoken');
		let encoder;
		try {
			encoder = encoding_for_model('gpt-5');
		} catch {
			encoder = encoding_for_model('gpt-3.5-turbo');
		}
		try {
			const tokens = encoder.encode(text);
			if (tokens.length <= maxTokens) {
				return text;
			}
			const truncated = tokens.slice(0, maxTokens);
			const decoder = new TextDecoder();
			return decoder.decode(encoder.decode(truncated));
		} finally {
			encoder.free();
		}
	} catch {
		const maxChars = maxTokens * 4;
		return text.length <= maxChars ? text : text.slice(0, maxChars);
	}
}

interface FitResult {
	documents: string[];
	/** Original indices that survived (maps new index → original index) */
	originalIndices: number[];
	droppedCount: number;
	truncatedCount: number;
}

/**
 * Fit documents into the rerank model's context window.
 *
 * Strategy:
 * 1. Reserve tokens for query + request overhead
 * 2. Walk documents in order; accumulate until budget exhausted
 * 3. If a single document exceeds 30% of context, truncate it
 * 4. Drop documents that no longer fit
 */
async function fitDocumentsToContext(
	query: string,
	documents: string[],
	contextLength: number,
): Promise<FitResult> {
	const budgetTotal = Math.floor(contextLength * CONTEXT_RESERVE_RATIO);
	const queryTokens = await countTokens(query);
	const overhead = 50;
	let remaining = budgetTotal - queryTokens - overhead;

	if (remaining <= 0) {
		logger.warn(
			`Rerank context budget exhausted by query alone (${queryTokens} tokens, budget ${budgetTotal})`,
		);
		return {
			documents: [],
			originalIndices: [],
			droppedCount: documents.length,
			truncatedCount: 0,
		};
	}

	const singleDocMax = Math.floor(contextLength * SINGLE_DOC_MAX_RATIO);
	const fitted: string[] = [];
	const originalIndices: number[] = [];
	let droppedCount = 0;
	let truncatedCount = 0;

	for (let i = 0; i < documents.length; i++) {
		const doc = documents[i]!;
		let docTokens = await countTokens(doc);

		if (docTokens > singleDocMax) {
			const truncatedDoc = await truncateText(doc, singleDocMax);
			docTokens = await countTokens(truncatedDoc);
			truncatedCount++;

			if (docTokens <= remaining) {
				fitted.push(truncatedDoc);
				originalIndices.push(i);
				remaining -= docTokens;
			} else {
				droppedCount++;
			}
			continue;
		}

		if (docTokens <= remaining) {
			fitted.push(doc);
			originalIndices.push(i);
			remaining -= docTokens;
		} else {
			droppedCount++;
		}
	}

	if (droppedCount > 0 || truncatedCount > 0) {
		logger.info(
			`Rerank context fitting: ${documents.length} docs → ${fitted.length} kept, ${truncatedCount} truncated, ${droppedCount} dropped (context ${contextLength} tokens)`,
		);
	}

	return {documents: fitted, originalIndices, droppedCount, truncatedCount};
}

function resolveRerankEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');

	if (trimmed.endsWith('/rerank')) {
		return trimmed;
	}
	if (trimmed.endsWith('/v1/rerank')) {
		return trimmed;
	}
	if (trimmed.endsWith('/v1')) {
		return `${trimmed}/rerank`;
	}
	return `${trimmed}/v1/rerank`;
}

/**
 * Normalize various rerank API response formats into a unified structure.
 * Supports Jina, Cohere, and OpenAI-compatible rerank responses.
 */
function normalizeRerankResponse(data: any): RerankResponse {
	if (data && Array.isArray(data.results)) {
		return {
			results: data.results.map((r: any) => ({
				index: r.index ?? 0,
				relevanceScore: r.relevance_score ?? r.relevanceScore ?? 0,
			})),
		};
	}
	if (Array.isArray(data)) {
		return {
			results: data.map((r: any) => ({
				index: r.index ?? 0,
				relevanceScore: r.relevance_score ?? r.relevanceScore ?? r.score ?? 0,
			})),
		};
	}
	throw new Error(
		`Unexpected rerank API response format: ${JSON.stringify(data).slice(0, 200)}`,
	);
}

async function callRerankAPI(options: {
	url: string;
	model: string;
	query: string;
	documents: string[];
	topN?: number;
	apiKey?: string;
}): Promise<RerankResponse> {
	const {url, model, query, documents, topN, apiKey} = options;

	const requestBody: Record<string, unknown> = {
		model,
		query,
		documents,
	};
	if (topN !== undefined) {
		requestBody['top_n'] = topN;
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'x-snow': getVersionHeader(),
	};
	if (apiKey) {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	const fetchOptions = addProxyToFetchOptions(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(requestBody),
	});

	const response = await fetch(url, fetchOptions);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Rerank API error (${response.status}): ${errorText}`);
	}

	const data = await response.json();
	return normalizeRerankResponse(data);
}

/**
 * Rerank documents against a query with automatic retry.
 *
 * Before calling the API, documents are fitted into the model's context window
 * (configured via `reranking.contextLength`). Documents that exceed the budget
 * are truncated or dropped, and the response maps indices back to the original
 * document array so callers can match results correctly.
 *
 * @returns Sorted results with relevance scores (indices refer to the original documents array).
 *          If topN >= documents.length, all documents are returned (full ranking).
 */
export async function rerankDocuments(
	options: RerankOptions,
): Promise<RerankResponse> {
	const config = loadCodebaseConfig();
	const rerankingConfig = config.reranking;

	const model = options.model || rerankingConfig.modelName;
	const baseUrl = options.baseUrl || rerankingConfig.baseUrl;
	const apiKey = options.apiKey || rerankingConfig.apiKey;
	const topN = options.topN ?? rerankingConfig.topN;
	const contextLength =
		options.contextLength ?? rerankingConfig.contextLength;
	const {query, documents} = options;

	if (!model) {
		throw new Error('Reranking model name is required');
	}
	if (!baseUrl) {
		throw new Error('Reranking base URL is required');
	}
	if (!documents || documents.length === 0) {
		throw new Error('Documents are required for reranking');
	}

	// ── Context length protection ──
	const fitResult = await fitDocumentsToContext(
		query,
		documents,
		contextLength,
	);

	if (fitResult.documents.length === 0) {
		logger.warn(
			'All documents dropped during context fitting, returning empty results',
		);
		return {
			results: [],
			droppedDocuments: fitResult.droppedCount,
			truncatedDocuments: fitResult.truncatedCount,
		};
	}

	const url = resolveRerankEndpoint(baseUrl);
	const effectiveTopN =
		topN >= fitResult.documents.length ? undefined : topN;

	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			logger.info(
				`Rerank API call attempt ${attempt}/${MAX_RETRIES} (${fitResult.documents.length}/${documents.length} docs, context ${contextLength})`,
			);

			const response = await callRerankAPI({
				url,
				model,
				query,
				documents: fitResult.documents,
				topN: effectiveTopN,
				apiKey,
			});

			// Map fitted indices back to original document indices
			const mappedResults: RerankResult[] = response.results.map(r => ({
				index: fitResult.originalIndices[r.index] ?? r.index,
				relevanceScore: r.relevanceScore,
			}));

			logger.info(
				`Rerank API succeeded on attempt ${attempt}, got ${mappedResults.length} results`,
			);

			return {
				results: mappedResults,
				droppedDocuments: fitResult.droppedCount,
				truncatedDocuments: fitResult.truncatedCount,
			};
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			logger.warn(
				`Rerank API attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`,
			);

			if (attempt < MAX_RETRIES) {
				const delay = RETRY_BASE_DELAY_MS * attempt;
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	throw new Error(
		`Rerank API failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
	);
}
