import {loadCodebaseConfig} from '../utils/config/codebaseConfig.js';
import {logger} from '../utils/core/logger.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';
import {getVersionHeader} from '../utils/core/version.js';

export interface EmbeddingOptions {
	model?: string;
	input: string[];
	baseUrl?: string;
	apiKey?: string;
	dimensions?: number;
	task?: string;
}

export interface EmbeddingResponse {
	model: string;
	object: string;
	usage: {
		total_tokens: number;
		prompt_tokens: number;
	};
	data: Array<{
		object: string;
		index: number;
		embedding: number[];
	}>;
}

type OllamaEmbeddingsMode = 'openai' | 'ollama';

interface OllamaEmbeddingResponse {
	model: string;
	embeddings: number[][];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
}

function isOpenAIEmbeddingsResponse(data: any): data is EmbeddingResponse {
	return (
		Boolean(data) &&
		data.object === 'list' &&
		Array.isArray(data.data) &&
		data.data.every(
			(item: any) =>
				Boolean(item) &&
				item.object === 'embedding' &&
				typeof item.index === 'number' &&
				Array.isArray(item.embedding),
		)
	);
}

function isOllamaEmbedResponse(data: any): data is OllamaEmbeddingResponse {
	return (
		Boolean(data) &&
		typeof data.model === 'string' &&
		Array.isArray(data.embeddings)
	);
}

export function resolveOllamaEmbeddingsEndpoint(baseUrl: string): {
	url: string;
	mode: OllamaEmbeddingsMode;
} {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');

	if (trimmed.endsWith('/v1/embeddings')) {
		return {url: trimmed, mode: 'openai'};
	}

	if (trimmed.endsWith('/api/embed')) {
		return {url: trimmed, mode: 'ollama'};
	}

	if (trimmed.endsWith('/v1')) {
		return {url: `${trimmed}/embeddings`, mode: 'openai'};
	}

	if (trimmed.endsWith('/api')) {
		return {url: `${trimmed}/embed`, mode: 'ollama'};
	}

	// If the user passes a fully-qualified endpoint, try to infer mode.
	if (trimmed.endsWith('/embeddings')) {
		return {url: trimmed, mode: 'openai'};
	}

	if (trimmed.endsWith('/embed')) {
		return {url: trimmed, mode: 'ollama'};
	}

	// Default to OpenAI-compatible endpoint for better interoperability.
	return {url: `${trimmed}/v1/embeddings`, mode: 'openai'};
}

function resolveOpenAICompatibleEmbeddingsEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');

	if (trimmed.endsWith('/v1/embeddings')) {
		return trimmed;
	}

	// Allow users to pass a fully-qualified endpoint.
	if (trimmed.endsWith('/embeddings')) {
		return trimmed;
	}

	if (trimmed.endsWith('/v1')) {
		return `${trimmed}/embeddings`;
	}

	// Most OpenAI-compatible providers use /v1/embeddings.
	return `${trimmed}/v1/embeddings`;
}

function warnOnDimensionMismatch(params: {
	expectedDimensions?: number;
	actualDimensions?: number;
	model: string;
	url: string;
	mode: OllamaEmbeddingsMode;
}): void {
	const {expectedDimensions, actualDimensions, model, url, mode} = params;

	if (!expectedDimensions || !actualDimensions) {
		return;
	}

	if (expectedDimensions === actualDimensions) {
		return;
	}

	logger.warn(
		`Embedding dimension mismatch (expected ${expectedDimensions}, got ${actualDimensions}). Some providers ignore 'dimensions'.`,
		{
			model,
			url,
			mode,
			expectedDimensions,
			actualDimensions,
		},
	);
}

function normalizeOllamaResponse(params: {
	data: unknown;
	mode: OllamaEmbeddingsMode;
	model: string;
	expectedDimensions?: number;
	url: string;
}): EmbeddingResponse {
	const {data, mode, model, expectedDimensions, url} = params;

	// Some Ollama deployments return OpenAI-compatible format from /v1/embeddings.
	if (isOpenAIEmbeddingsResponse(data)) {
		const actualDimensions =
			Array.isArray(data.data) && data.data.length > 0
				? data.data[0]?.embedding?.length
				: undefined;

		warnOnDimensionMismatch({
			expectedDimensions,
			actualDimensions,
			model,
			url,
			mode,
		});

		return data;
	}

	// Ollama native response format from /api/embed.
	if (isOllamaEmbedResponse(data)) {
		const actualDimensions =
			Array.isArray(data.embeddings) && data.embeddings.length > 0
				? data.embeddings[0]?.length
				: undefined;

		warnOnDimensionMismatch({
			expectedDimensions,
			actualDimensions,
			model,
			url,
			mode,
		});

		return {
			model: data.model,
			object: 'list',
			usage: {
				total_tokens: data.prompt_eval_count || 0,
				prompt_tokens: data.prompt_eval_count || 0,
			},
			data: data.embeddings.map((embedding, index) => ({
				object: 'embedding',
				index,
				embedding,
			})),
		};
	}

	throw new Error(
		`Unexpected Ollama embeddings response format from ${url}. Try setting baseUrl to http://localhost:11434 (or /v1 for OpenAI-compatible mode).`,
	);
}

/**
 * Create embeddings for text array (single API call)
 * @param options Embedding options
 * @returns Embedding response with vectors
 */
export async function createEmbeddings(
	options: EmbeddingOptions,
): Promise<EmbeddingResponse> {
	const config = loadCodebaseConfig();

	// Use config defaults if not provided
	const model = options.model || config.embedding.modelName;
	const baseUrl = options.baseUrl || config.embedding.baseUrl;
	const apiKey = options.apiKey || config.embedding.apiKey;
	const dimensions = options.dimensions ?? config.embedding.dimensions;
	const {input, task} = options;

	if (!model) {
		throw new Error('Embedding model name is required');
	}
	if (!baseUrl) {
		throw new Error('Embedding base URL is required');
	}
	// API key is optional for local deployments (e.g., Ollama)
	// if (!apiKey) {
	// 	throw new Error('Embedding API key is required');
	// }
	if (!input || input.length === 0) {
		throw new Error('Input texts are required');
	}

	// Build request body
	const requestBody: {
		model: string;
		input: string[];
		task?: string;
		dimensions?: number;
	} = {
		model,
		input,
	};

	if (task) {
		requestBody.task = task;
	}

	if (dimensions) {
		requestBody.dimensions = dimensions;
	}

	// Determine endpoint based on provider type
	const embeddingType = config.embedding.type || 'jina';
	let url: string;
	let ollamaMode: OllamaEmbeddingsMode | undefined;

	if (embeddingType === 'ollama') {
		const resolved = resolveOllamaEmbeddingsEndpoint(baseUrl);
		url = resolved.url;
		ollamaMode = resolved.mode;
	} else {
		// Jina/OpenAI-compatible embeddings endpoint
		url = resolveOpenAICompatibleEmbeddingsEndpoint(baseUrl);
	}

	// Build headers - only include Authorization if API key is provided
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
		throw new Error(`Embedding API error (${response.status}): ${errorText}`);
	}

	const data = await response.json();

	if (embeddingType === 'ollama') {
		return normalizeOllamaResponse({
			data,
			mode: ollamaMode || 'openai',
			model,
			expectedDimensions: dimensions,
			url,
		});
	}

	return data as EmbeddingResponse;
}

/**
 * Create embedding for single text
 * @param text Single text to embed
 * @param options Optional embedding options
 * @returns Embedding vector
 */
export async function createEmbedding(
	text: string,
	options?: Partial<EmbeddingOptions>,
): Promise<number[]> {
	const response = await createEmbeddings({
		input: [text],
		...options,
	});

	if (response.data.length === 0) {
		throw new Error('No embedding returned from API');
	}

	return response.data[0]!.embedding;
}
