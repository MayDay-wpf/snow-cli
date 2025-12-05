import { getOpenAiConfig, getCustomHeaders } from '../utils/config/apiConfig.js';
import { addProxyToFetchOptions } from '../utils/core/proxyUtils.js';

export interface Model {
	id: string;
	object: string;
	created: number;
	owned_by: string;
}

export interface ModelsResponse {
	object: string;
	data: Model[];
}

// Gemini API response format
interface GeminiModel {
	name: string; // Format: "models/gemini-pro"
	displayName: string;
	description?: string;
	supportedGenerationMethods?: string[];
}

interface GeminiModelsResponse {
	models: GeminiModel[];
}

// Anthropic API response format
interface AnthropicModel {
	id: string;
	display_name?: string;
	created_at: string;
	type: string;
}

/**
 * Fetch models from OpenAI-compatible API
 */
async function fetchOpenAIModels(baseUrl: string, apiKey: string, customHeaders: Record<string, string>): Promise<Model[]> {
	const url = `${baseUrl}/models`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...customHeaders,
	};

	if (apiKey) {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	const fetchOptions = addProxyToFetchOptions(url, {
		method: 'GET',
		headers,
	});
	const response = await fetch(url, fetchOptions);

	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
	}

	const data: ModelsResponse = await response.json();
	return data.data || [];
}

/**
 * Fetch models from Gemini API
 */
async function fetchGeminiModels(baseUrl: string, apiKey: string): Promise<Model[]> {
	// Gemini uses API key as query parameter
	const url = `${baseUrl}/models?key=${apiKey}`;

	const fetchOptions = addProxyToFetchOptions(url, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
		},
	});
	const response = await fetch(url, fetchOptions);

	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
	}

	const data: GeminiModelsResponse = await response.json();

	// Convert Gemini format to standard Model format
	return (data.models || []).map(model => ({
		id: model.name.replace('models/', ''), // Remove "models/" prefix
		object: 'model',
		created: 0,
		owned_by: 'google',
	}));
}

/**
 * Fetch models from Anthropic API
 * Supports both Anthropic native format and OpenAI-compatible format for backward compatibility
 */
async function fetchAnthropicModels(baseUrl: string, apiKey: string, customHeaders: Record<string, string>): Promise<Model[]> {
	const url = `${baseUrl}/models`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...customHeaders,
	};

	if (apiKey) {
		headers['x-api-key'] = apiKey;
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	const fetchOptions = addProxyToFetchOptions(url, {
		method: 'GET',
		headers,
	});
	const response = await fetch(url, fetchOptions);

	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
	}

	const data: any = await response.json();

	// Try to parse as Anthropic format first
	if (data.data && Array.isArray(data.data) && data.data.length > 0) {
		const firstItem = data.data[0];

		// Check if it's Anthropic format (has created_at field)
		if ('created_at' in firstItem && typeof firstItem.created_at === 'string') {
			// Anthropic native format
			return (data.data as AnthropicModel[]).map(model => ({
				id: model.id,
				object: 'model',
				created: new Date(model.created_at).getTime() / 1000,
				owned_by: 'anthropic',
			}));
		}

		// Fallback to OpenAI format (has created field as number)
		if ('id' in firstItem && 'object' in firstItem) {
			// OpenAI-compatible format
			return data.data as Model[];
		}
	}

	// If no data array or empty, return empty array
	return [];
}

/**
 * Fetch available models based on configured request method
 */
export async function fetchAvailableModels(): Promise<Model[]> {
	const config = getOpenAiConfig();

	if (!config.baseUrl) {
		throw new Error('Base URL not configured. Please configure API settings first.');
	}

	const customHeaders = getCustomHeaders();

	try {
		let models: Model[];

		switch (config.requestMethod) {
			case 'gemini':
				if (!config.apiKey) {
					throw new Error('API key is required for Gemini API');
				}
				models = await fetchGeminiModels(config.baseUrl.replace(/\/$/, ''), config.apiKey);
				break;

			case 'anthropic':
				if (!config.apiKey) {
					throw new Error('API key is required for Anthropic API');
				}
				models = await fetchAnthropicModels(config.baseUrl.replace(/\/$/, ''), config.apiKey, customHeaders);
				break;

			case 'chat':
			case 'responses':
			default:
				// OpenAI-compatible API
				models = await fetchOpenAIModels(config.baseUrl.replace(/\/$/, ''), config.apiKey, customHeaders);
				break;
		}

		// Sort models alphabetically by id for better UX
		return models.sort((a, b) => a.id.localeCompare(b.id));
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Error fetching models: ${error.message}`);
		}
		throw new Error('Unknown error occurred while fetching models');
	}
}

export function filterModels(models: Model[], searchTerm: string): Model[] {
	if (!searchTerm.trim()) {
		return models;
	}

	const lowerSearchTerm = searchTerm.toLowerCase();
	return models.filter(model =>
		model.id.toLowerCase().includes(lowerSearchTerm)
	);
}