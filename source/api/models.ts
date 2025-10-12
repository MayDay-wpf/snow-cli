import { getOpenAiConfig, getCustomHeaders } from '../utils/apiConfig.js';

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

interface AnthropicModelsResponse {
	data: AnthropicModel[];
	first_id?: string;
	last_id?: string;
	has_more?: boolean;
}

/**
 * Fetch models from OpenAI-compatible API
 */
async function fetchOpenAIModels(baseUrl: string, apiKey: string, customHeaders: Record<string, string>): Promise<Model[]> {
	const url = `${baseUrl.replace(/\/$/, '')}/models`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...customHeaders,
	};

	if (apiKey) {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	const response = await fetch(url, {
		method: 'GET',
		headers,
	});

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
	const url = `${baseUrl.replace(/\/$/, '')}/models?key=${apiKey}`;

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
		},
	});

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
 */
async function fetchAnthropicModels(baseUrl: string, apiKey: string, customHeaders: Record<string, string>): Promise<Model[]> {
	const url = `${baseUrl.replace(/\/$/, '')}/models`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'anthropic-version': '2023-06-01',
		...customHeaders,
	};

	if (apiKey) {
		headers['x-api-key'] = apiKey;
	}

	const response = await fetch(url, {
		method: 'GET',
		headers,
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
	}

	const data: AnthropicModelsResponse = await response.json();

	// Convert Anthropic format to standard Model format
	return (data.data || []).map(model => ({
		id: model.id,
		object: 'model',
		created: new Date(model.created_at).getTime() / 1000, // Convert to Unix timestamp
		owned_by: 'anthropic',
	}));
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
				models = await fetchGeminiModels(config.baseUrl.replace(/\/$/, '') + '/v1beta', config.apiKey);
				break;

			case 'anthropic':
				if (!config.apiKey) {
					throw new Error('API key is required for Anthropic API');
				}
				models = await fetchAnthropicModels(config.baseUrl.replace(/\/$/, '') + '/v1', config.apiKey, customHeaders);
				break;

			case 'chat':
			case 'responses':
			default:
				// OpenAI-compatible API
				models = await fetchOpenAIModels(config.baseUrl, config.apiKey, customHeaders);
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