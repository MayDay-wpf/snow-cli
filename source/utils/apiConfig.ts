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

export interface MCPServer {
	url?: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>; // 环境变量
}

export interface MCPConfig {
	mcpServers: Record<string, MCPServer>;
}

export interface AppConfig {
	openai: ApiConfig;
	mcp?: MCPConfig;
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
	mcp: {
		mcpServers: {
		}
	},
};

const CONFIG_DIR = join(homedir(), '.snow');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const MCP_CONFIG_FILE = join(CONFIG_DIR, 'mcp-config.json');

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

export function updateMCPConfig(mcpConfig: MCPConfig): void {
	ensureConfigDirectory();
	try {
		const configData = JSON.stringify(mcpConfig, null, 2);
		writeFileSync(MCP_CONFIG_FILE, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save MCP configuration: ${error}`);
	}
}

export function getMCPConfig(): MCPConfig {
	ensureConfigDirectory();
	
	if (!existsSync(MCP_CONFIG_FILE)) {
		const defaultMCPConfig = DEFAULT_CONFIG.mcp!;
		updateMCPConfig(defaultMCPConfig);
		return defaultMCPConfig;
	}

	try {
		const configData = readFileSync(MCP_CONFIG_FILE, 'utf8');
		const config = JSON.parse(configData);
		return config;
	} catch (error) {
		const defaultMCPConfig = DEFAULT_CONFIG.mcp!;
		updateMCPConfig(defaultMCPConfig);
		return defaultMCPConfig;
	}
}

export function validateMCPConfig(config: Partial<MCPConfig>): string[] {
	const errors: string[] = [];

	if (config.mcpServers) {
		Object.entries(config.mcpServers).forEach(([name, server]) => {
			if (!name.trim()) {
				errors.push('Server name cannot be empty');
			}
			
			if (server.url && !isValidUrl(server.url)) {
				const urlWithEnvReplaced = server.url.replace(/\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/g, 'placeholder');
				if (!isValidUrl(urlWithEnvReplaced)) {
					errors.push(`Invalid URL format for server "${name}"`);
				}
			}
			
			if (server.command && !server.command.trim()) {
				errors.push(`Command cannot be empty for server "${name}"`);
			}
			
			if (!server.url && !server.command) {
				errors.push(`Server "${name}" must have either a URL or command`);
			}
			
			// 验证环境变量格式
			if (server.env) {
				Object.entries(server.env).forEach(([envName, envValue]) => {
					if (!envName.trim()) {
						errors.push(`Environment variable name cannot be empty for server "${name}"`);
					}
					if (typeof envValue !== 'string') {
						errors.push(`Environment variable "${envName}" must be a string for server "${name}"`);
					}
				});
			}
		});
	}

	return errors;
}
