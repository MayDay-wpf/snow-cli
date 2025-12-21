import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CodebaseConfig {
	enabled: boolean;
	enableAgentReview: boolean;
	embedding: {
		type?: 'jina' | 'ollama'; // 请求类型，默认为jina
		modelName: string;
		baseUrl: string;
		apiKey: string;
		dimensions: number;
	};
	batch: {
		maxLines: number;
		concurrency: number;
	};
	chunking: {
		maxLinesPerChunk: number;
		minLinesPerChunk: number;
		minCharsPerChunk: number;
		overlapLines: number;
	};
}

const DEFAULT_CONFIG: CodebaseConfig = {
	enabled: false,
	enableAgentReview: true,
	embedding: {
		type: 'jina', // 默认使用jina
		modelName: '',
		baseUrl: '',
		apiKey: '',
		dimensions: 1536,
	},
	batch: {
		maxLines: 10,
		concurrency: 3,
	},
	chunking: {
		maxLinesPerChunk: 200,
		minLinesPerChunk: 10,
		minCharsPerChunk: 20,
		overlapLines: 20,
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
			enableAgentReview:
				config.enableAgentReview ?? DEFAULT_CONFIG.enableAgentReview,
			embedding: {
				type: config.embedding?.type ?? DEFAULT_CONFIG.embedding.type,
				modelName:
					config.embedding?.modelName ?? DEFAULT_CONFIG.embedding.modelName,
				baseUrl: config.embedding?.baseUrl ?? DEFAULT_CONFIG.embedding.baseUrl,
				apiKey: config.embedding?.apiKey ?? DEFAULT_CONFIG.embedding.apiKey,
				dimensions:
					config.embedding?.dimensions ?? DEFAULT_CONFIG.embedding.dimensions,
			},
			batch: {
				maxLines: config.batch?.maxLines ?? DEFAULT_CONFIG.batch.maxLines,
				concurrency:
					config.batch?.concurrency ?? DEFAULT_CONFIG.batch.concurrency,
			},
			chunking: {
				maxLinesPerChunk:
					config.chunking?.maxLinesPerChunk ??
					DEFAULT_CONFIG.chunking.maxLinesPerChunk,
				minLinesPerChunk:
					config.chunking?.minLinesPerChunk ??
					DEFAULT_CONFIG.chunking.minLinesPerChunk,
				minCharsPerChunk:
					config.chunking?.minCharsPerChunk ??
					DEFAULT_CONFIG.chunking.minCharsPerChunk,
				overlapLines:
					config.chunking?.overlapLines ?? DEFAULT_CONFIG.chunking.overlapLines,
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
