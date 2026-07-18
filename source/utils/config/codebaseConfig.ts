import {readSettings, updateSettings} from './unifiedSettings.js';

/**
 * Codebase configuration.
 *
 * Storage layout (now unified into `settings.json`):
 *   - Project-level fields (enabled / batch / chunking / enableAgentReview /
 *     enableReranking) live in `<cwd>/.snow/settings.json` under
 *     `settings.codebase`.
 *   - Embedding & reranking provider settings are shared across projects and
 *     live in `~/.snow/settings.json` under `settings.codebase.embedding` /
 *     `settings.codebase.reranking`.
 */
export interface CodebaseConfig {
	enabled: boolean;
	enableAgentReview: boolean;
	enableReranking: boolean;
	embedding: {
		type?: 'jina' | 'ollama' | 'gemini' | 'mistral'; // 请求类型，默认为jina
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
	reranking: {
		modelName: string;
		baseUrl: string;
		apiKey: string;
		contextLength: number;
		topN: number;
	};
}

const DEFAULT_CONFIG: CodebaseConfig = {
	enabled: false,
	enableAgentReview: true,
	enableReranking: false,
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
	reranking: {
		modelName: '',
		baseUrl: '',
		apiKey: '',
		contextLength: 4096,
		topN: 5,
	},
};

// Load codebase config - project-level enabled/disabled, global embedding settings
export const loadCodebaseConfig = (
	workingDirectory?: string,
): CodebaseConfig => {
	try {
		const globalSettings = readSettings('global');
		const projectSettings = readSettings('project', workingDirectory);
		const globalCb = globalSettings.codebase ?? {};
		const projectCb = projectSettings.codebase ?? {};

		const embedding = {
			type: globalCb.embedding?.type ?? DEFAULT_CONFIG.embedding.type,
			modelName:
				globalCb.embedding?.modelName ?? DEFAULT_CONFIG.embedding.modelName,
			baseUrl: globalCb.embedding?.baseUrl ?? DEFAULT_CONFIG.embedding.baseUrl,
			apiKey: globalCb.embedding?.apiKey ?? DEFAULT_CONFIG.embedding.apiKey,
			dimensions:
				globalCb.embedding?.dimensions ?? DEFAULT_CONFIG.embedding.dimensions,
		};

		const reranking = {
			modelName:
				globalCb.reranking?.modelName ?? DEFAULT_CONFIG.reranking.modelName,
			baseUrl: globalCb.reranking?.baseUrl ?? DEFAULT_CONFIG.reranking.baseUrl,
			apiKey: globalCb.reranking?.apiKey ?? DEFAULT_CONFIG.reranking.apiKey,
			contextLength:
				globalCb.reranking?.contextLength ??
				DEFAULT_CONFIG.reranking.contextLength,
			topN: globalCb.reranking?.topN ?? DEFAULT_CONFIG.reranking.topN,
		};

		return {
			enabled: projectCb.enabled ?? DEFAULT_CONFIG.enabled,
			enableAgentReview:
				projectCb.enableAgentReview ?? DEFAULT_CONFIG.enableAgentReview,
			enableReranking:
				projectCb.enableReranking ?? DEFAULT_CONFIG.enableReranking,
			embedding,
			batch: {
				maxLines: projectCb.batch?.maxLines ?? DEFAULT_CONFIG.batch.maxLines,
				concurrency:
					projectCb.batch?.concurrency ?? DEFAULT_CONFIG.batch.concurrency,
			},
			chunking: {
				maxLinesPerChunk:
					projectCb.chunking?.maxLinesPerChunk ??
					DEFAULT_CONFIG.chunking.maxLinesPerChunk,
				minLinesPerChunk:
					projectCb.chunking?.minLinesPerChunk ??
					DEFAULT_CONFIG.chunking.minLinesPerChunk,
				minCharsPerChunk:
					projectCb.chunking?.minCharsPerChunk ??
					DEFAULT_CONFIG.chunking.minCharsPerChunk,
				overlapLines:
					projectCb.chunking?.overlapLines ??
					DEFAULT_CONFIG.chunking.overlapLines,
			},
			reranking,
		};
	} catch (error) {
		console.error('Failed to load codebase config:', error);
		return {...DEFAULT_CONFIG};
	}
};

// Save codebase config
// - Embedding and reranking settings are saved globally (~/.snow/settings.json)
// - Other settings (enabled, batch, chunking) are saved per-project
//   (<cwd>/.snow/settings.json)
export const saveCodebaseConfig = (
	config: CodebaseConfig,
	workingDirectory?: string,
): void => {
	try {
		updateSettings('global', settings => {
			const cb = settings.codebase ?? {};
			cb.embedding = config.embedding;
			cb.reranking = config.reranking;
			settings.codebase = cb;
		});

		updateSettings(
			'project',
			settings => {
				const cb = settings.codebase ?? {};
				cb.enabled = config.enabled;
				cb.enableAgentReview = config.enableAgentReview;
				cb.enableReranking = config.enableReranking;
				cb.batch = config.batch;
				cb.chunking = config.chunking;
				settings.codebase = cb;
			},
			workingDirectory,
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
