import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CodebaseConfig {
	enabled: boolean;
	embedding: {
		modelName: string;
		baseUrl: string;
		apiKey: string;
		dimensions: number;
	};
	llm: {
		modelName: string;
		baseUrl: string;
		apiKey: string;
	};
	batch: {
		maxLines: number;
		concurrency: number;
	};
}

const DEFAULT_CONFIG: CodebaseConfig = {
	enabled: false,
	embedding: {
		modelName: '',
		baseUrl: '',
		apiKey: '',
		dimensions: 1536,
	},
	llm: {
		modelName: '',
		baseUrl: '',
		apiKey: '',
	},
	batch: {
		maxLines: 10,
		concurrency: 3,
	},
};

const getConfigDir = (): string => {
	const homeDir = os.homedir();
	const configDir = path.join(homeDir, '.snow');
	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, {recursive: true});
	}
	return configDir;
};

const getConfigPath = (): string => {
	return path.join(getConfigDir(), 'codebase.json');
};

export const loadCodebaseConfig = (): CodebaseConfig => {
	try {
		const configPath = getConfigPath();
		if (!fs.existsSync(configPath)) {
			return {...DEFAULT_CONFIG};
		}

		const configContent = fs.readFileSync(configPath, 'utf-8');
		const config = JSON.parse(configContent);

		// Merge with defaults to ensure all fields exist
		return {
			enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
			embedding: {
				modelName:
					config.embedding?.modelName ?? DEFAULT_CONFIG.embedding.modelName,
				baseUrl: config.embedding?.baseUrl ?? DEFAULT_CONFIG.embedding.baseUrl,
				apiKey: config.embedding?.apiKey ?? DEFAULT_CONFIG.embedding.apiKey,
				dimensions:
					config.embedding?.dimensions ?? DEFAULT_CONFIG.embedding.dimensions,
			},
			llm: {
				modelName: config.llm?.modelName ?? DEFAULT_CONFIG.llm.modelName,
				baseUrl: config.llm?.baseUrl ?? DEFAULT_CONFIG.llm.baseUrl,
				apiKey: config.llm?.apiKey ?? DEFAULT_CONFIG.llm.apiKey,
			},
			batch: {
				maxLines: config.batch?.maxLines ?? DEFAULT_CONFIG.batch.maxLines,
				concurrency:
					config.batch?.concurrency ?? DEFAULT_CONFIG.batch.concurrency,
			},
		};
	} catch (error) {
		console.error('Failed to load codebase config:', error);
		return {...DEFAULT_CONFIG};
	}
};

export const saveCodebaseConfig = (config: CodebaseConfig): void => {
	try {
		const configPath = getConfigPath();
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
	} catch (error) {
		console.error('Failed to save codebase config:', error);
		throw error;
	}
};
