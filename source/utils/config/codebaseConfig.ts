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

// Get global config directory (~/.snow)
const getGlobalConfigDir = (): string => {
	const homeDir = os.homedir();
	const configDir = path.join(homeDir, '.snow');
	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, {recursive: true});
	}
	return configDir;
};

// Get project config directory (.snow in current working directory)
const getProjectConfigDir = (workingDirectory?: string): string => {
	const baseDir = workingDirectory || process.cwd();
	const configDir = path.join(baseDir, '.snow');
	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, {recursive: true});
	}
	return configDir;
};

// Get project-level config path
const getProjectConfigPath = (workingDirectory?: string): string => {
	return path.join(getProjectConfigDir(workingDirectory), 'codebase.json');
};

// Get global config path (for embedding settings only)
const getGlobalConfigPath = (): string => {
	return path.join(getGlobalConfigDir(), 'codebase.json');
};

// Load global embedding config (shared across projects)
const loadGlobalEmbeddingConfig = (): CodebaseConfig['embedding'] => {
	try {
		const configPath = getGlobalConfigPath();
		if (!fs.existsSync(configPath)) {
			return {...DEFAULT_CONFIG.embedding};
		}
		const configContent = fs.readFileSync(configPath, 'utf-8');
		const config = JSON.parse(configContent);
		return {
			type: config.embedding?.type ?? DEFAULT_CONFIG.embedding.type,
			modelName:
				config.embedding?.modelName ?? DEFAULT_CONFIG.embedding.modelName,
			baseUrl: config.embedding?.baseUrl ?? DEFAULT_CONFIG.embedding.baseUrl,
			apiKey: config.embedding?.apiKey ?? DEFAULT_CONFIG.embedding.apiKey,
			dimensions:
				config.embedding?.dimensions ?? DEFAULT_CONFIG.embedding.dimensions,
		};
	} catch {
		return {...DEFAULT_CONFIG.embedding};
	}
};

// Load codebase config - project-level enabled/disabled, global embedding settings
export const loadCodebaseConfig = (
	workingDirectory?: string,
): CodebaseConfig => {
	try {
		const projectConfigPath = getProjectConfigPath(workingDirectory);
		const globalEmbedding = loadGlobalEmbeddingConfig();

		// Check project-level config for enabled status
		let projectConfig: Partial<CodebaseConfig> = {};
		if (fs.existsSync(projectConfigPath)) {
			const configContent = fs.readFileSync(projectConfigPath, 'utf-8');
			projectConfig = JSON.parse(configContent);
		}

		// Merge: project-level enabled/settings + global embedding
		return {
			enabled: projectConfig.enabled ?? DEFAULT_CONFIG.enabled,
			enableAgentReview:
				projectConfig.enableAgentReview ?? DEFAULT_CONFIG.enableAgentReview,
			embedding: globalEmbedding,
			batch: {
				maxLines:
					projectConfig.batch?.maxLines ?? DEFAULT_CONFIG.batch.maxLines,
				concurrency:
					projectConfig.batch?.concurrency ?? DEFAULT_CONFIG.batch.concurrency,
			},
			chunking: {
				maxLinesPerChunk:
					projectConfig.chunking?.maxLinesPerChunk ??
					DEFAULT_CONFIG.chunking.maxLinesPerChunk,
				minLinesPerChunk:
					projectConfig.chunking?.minLinesPerChunk ??
					DEFAULT_CONFIG.chunking.minLinesPerChunk,
				minCharsPerChunk:
					projectConfig.chunking?.minCharsPerChunk ??
					DEFAULT_CONFIG.chunking.minCharsPerChunk,
				overlapLines:
					projectConfig.chunking?.overlapLines ??
					DEFAULT_CONFIG.chunking.overlapLines,
			},
		};
	} catch (error) {
		console.error('Failed to load codebase config:', error);
		return {...DEFAULT_CONFIG};
	}
};

// Save codebase config
// - Embedding settings are saved globally (~/.snow/codebase.json)
// - Other settings (enabled, batch, chunking) are saved per-project (.snow/codebase.json)
export const saveCodebaseConfig = (
	config: CodebaseConfig,
	workingDirectory?: string,
): void => {
	try {
		// Save embedding settings globally
		const globalConfigPath = getGlobalConfigPath();
		const globalConfig = {embedding: config.embedding};
		fs.writeFileSync(
			globalConfigPath,
			JSON.stringify(globalConfig, null, 2),
			'utf-8',
		);

		// Save project-specific settings
		const projectConfigPath = getProjectConfigPath(workingDirectory);
		const projectConfig = {
			enabled: config.enabled,
			enableAgentReview: config.enableAgentReview,
			batch: config.batch,
			chunking: config.chunking,
		};
		fs.writeFileSync(
			projectConfigPath,
			JSON.stringify(projectConfig, null, 2),
			'utf-8',
		);
	} catch (error) {
		console.error('Failed to save codebase config:', error);
		throw error;
	}
};

// Check if codebase is enabled for current project
export const isCodebaseEnabled = (workingDirectory?: string): boolean => {
	const config = loadCodebaseConfig(workingDirectory);
	return config.enabled;
};

// Toggle codebase enabled status for current project
export const toggleCodebaseEnabled = (workingDirectory?: string): boolean => {
	const config = loadCodebaseConfig(workingDirectory);
	config.enabled = !config.enabled;
	saveCodebaseConfig(config, workingDirectory);
	return config.enabled;
};

// Enable codebase for current project
export const enableCodebase = (workingDirectory?: string): void => {
	const config = loadCodebaseConfig(workingDirectory);
	config.enabled = true;
	saveCodebaseConfig(config, workingDirectory);
};

// Disable codebase for current project
export const disableCodebase = (workingDirectory?: string): void => {
	const config = loadCodebaseConfig(workingDirectory);
	config.enabled = false;
	saveCodebaseConfig(config, workingDirectory);
};
