import { getOpenAiConfig } from '../utils/apiConfig.js';

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

export async function fetchAvailableModels(): Promise<Model[]> {
	const config = getOpenAiConfig();
	
	if (!config.baseUrl) {
		throw new Error('Base URL not configured. Please configure API settings first.');
	}

	const url = `${config.baseUrl.replace(/\/$/, '')}/models`;
	
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	// Add Authorization header only if API key is provided
	if (config.apiKey) {
		headers['Authorization'] = `Bearer ${config.apiKey}`;
	}

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers,
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
		}

		const data: ModelsResponse = await response.json();
		// Sort models alphabetically by id for better UX
		return (data.data || []).sort((a, b) => a.id.localeCompare(b.id));
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