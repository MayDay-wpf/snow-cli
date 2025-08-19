import {homedir} from 'os';
import {join} from 'path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';

export type RequestMethod = 'chat' | 'responses';

export interface ApiConfig {
	baseUrl: string;
	apiKey: string;
	requestMethod: RequestMethod;
	advancedModel?: string;
	basicModel?: string;
	maxContextTokens?: number;
}

export interface AppConfig {
	openai: ApiConfig;
}

const DEFAULT_CONFIG: AppConfig = {
	openai: {
		baseUrl: 'https://api.openai.com/v1',
		apiKey: '',
		requestMethod: 'chat',
		advancedModel: '',
		basicModel: '',
		maxContextTokens: 4000,
	},
};

const CONFIG_DIR = join(homedir(), '.snow');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

export function loadConfig(): AppConfig {
	ensureConfigDirectory();

	if (!existsSync(CONFIG_FILE)) {
		saveConfig(DEFAULT_CONFIG);
		return DEFAULT_CONFIG;
	}

	try {
		const configData = readFileSync(CONFIG_FILE, 'utf8');
		const config = JSON.parse(configData);
		// Ensure backward compatibility by adding default requestMethod if missing
		const mergedConfig = {
			...DEFAULT_CONFIG,
			...config,
			openai: {
				...DEFAULT_CONFIG.openai,
				...config.openai,
				requestMethod: (config.openai?.requestMethod === 'completions' ? 'chat' : config.openai?.requestMethod) || DEFAULT_CONFIG.openai.requestMethod,
			},
		};
		return mergedConfig;
	} catch (error) {
		return DEFAULT_CONFIG;
	}
}

export function saveConfig(config: AppConfig): void {
	ensureConfigDirectory();

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(CONFIG_FILE, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save configuration: ${error}`);
	}
}

export function updateOpenAiConfig(apiConfig: Partial<ApiConfig>): void {
	const currentConfig = loadConfig();
	const updatedConfig = {
		...currentConfig,
		openai: {...currentConfig.openai, ...apiConfig},
	};
	saveConfig(updatedConfig);
}

export function getOpenAiConfig(): ApiConfig {
	const config = loadConfig();
	return config.openai;
}

export function validateApiConfig(config: Partial<ApiConfig>): string[] {
	const errors: string[] = [];

	if (config.baseUrl && !isValidUrl(config.baseUrl)) {
		errors.push('Invalid base URL format');
	}

	if (config.apiKey && config.apiKey.trim().length === 0) {
		errors.push('API key cannot be empty');
	}

	return errors;
}

function isValidUrl(url: string): boolean {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
}
