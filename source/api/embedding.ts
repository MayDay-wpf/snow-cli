import {loadCodebaseConfig} from '../utils/config/codebaseConfig.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';

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

	// Use baseUrl directly, append /embeddings if needed
	const url = baseUrl.endsWith('/embeddings')
		? baseUrl
		: `${baseUrl.replace(/\/$/, '')}/embeddings`;

	// Build headers - only include Authorization if API key is provided
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'x-snow': 'true',
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
