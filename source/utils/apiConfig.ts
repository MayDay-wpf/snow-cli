import {homedir} from 'os';
import {join} from 'path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';

export type RequestMethod = 'chat' | 'responses' | 'gemini' | 'anthropic';

export interface CompactModelConfig {
	baseUrl: string;
	apiKey: string;
	modelName: string;
}

export interface ApiConfig {
	baseUrl: string;
	apiKey: string;
	requestMethod: RequestMethod;
	advancedModel?: string;
	basicModel?: string;
	maxContextTokens?: number;
	maxTokens?: number; // Max tokens for single response (API request parameter)
	compactModel?: CompactModelConfig;
	anthropicBeta?: boolean; // Enable Anthropic Beta features
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
	snowcfg: ApiConfig;
	openai?: ApiConfig; // 向下兼容旧版本
}

const DEFAULT_CONFIG: AppConfig = {
	snowcfg: {
		baseUrl: 'https://api.openai.com/v1',
		apiKey: '',
		requestMethod: 'chat',
		advancedModel: '',
		basicModel: '',
		maxContextTokens: 4000,
		maxTokens: 4096,
		anthropicBeta: false,
	},
};

const DEFAULT_MCP_CONFIG: MCPConfig = {
	mcpServers: {},
};

const CONFIG_DIR = join(homedir(), '.snow');

const SYSTEM_PROMPT_FILE = join(CONFIG_DIR, 'system-prompt.txt');

function normalizeRequestMethod(method: unknown): RequestMethod {
	if (method === 'chat' || method === 'responses' || method === 'gemini' || method === 'anthropic') {
		return method;
	}

	if (method === 'completions') {
		return 'chat';
	}

	return DEFAULT_CONFIG.snowcfg.requestMethod;
}


const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const MCP_CONFIG_FILE = join(CONFIG_DIR, 'mcp-config.json');

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

function cloneDefaultMCPConfig(): MCPConfig {
	return {
		mcpServers: {...DEFAULT_MCP_CONFIG.mcpServers},
	};
}

export function loadConfig(): AppConfig {
	ensureConfigDirectory();

	if (!existsSync(CONFIG_FILE)) {
		saveConfig(DEFAULT_CONFIG);
		return DEFAULT_CONFIG;
	}

	try {
		const configData = readFileSync(CONFIG_FILE, 'utf8');
		const parsedConfig = JSON.parse(configData) as Partial<AppConfig> & {mcp?: unknown};
		const {mcp: legacyMcp, ...restConfig} = parsedConfig;
		const configWithoutMcp = restConfig as Partial<AppConfig>;

		// 向下兼容：如果存在 openai 配置但没有 snowcfg，则使用 openai 配置
		let apiConfig: ApiConfig;
		if (configWithoutMcp.snowcfg) {
			apiConfig = {
				...DEFAULT_CONFIG.snowcfg,
				...configWithoutMcp.snowcfg,
				requestMethod: normalizeRequestMethod(configWithoutMcp.snowcfg.requestMethod),
			};
		} else if (configWithoutMcp.openai) {
			// 向下兼容旧版本
			apiConfig = {
				...DEFAULT_CONFIG.snowcfg,
				...configWithoutMcp.openai,
				requestMethod: normalizeRequestMethod(configWithoutMcp.openai.requestMethod),
			};
		} else {
			apiConfig = {
				...DEFAULT_CONFIG.snowcfg,
				requestMethod: DEFAULT_CONFIG.snowcfg.requestMethod,
			};
		}

		const mergedConfig: AppConfig = {
			...DEFAULT_CONFIG,
			...configWithoutMcp,
			snowcfg: apiConfig,
		};

		// 如果是从旧版本迁移过来的，保存新配置
		if (legacyMcp !== undefined || (configWithoutMcp.openai && !configWithoutMcp.snowcfg)) {
			saveConfig(mergedConfig);
		}

		return mergedConfig;
	} catch (error) {
		return DEFAULT_CONFIG;
	}
}

export function saveConfig(config: AppConfig): void {
	ensureConfigDirectory();

	try {
		// 只保留 snowcfg，去除 openai 字段
		const {openai, ...configWithoutOpenai} = config;
		const configData = JSON.stringify(configWithoutOpenai, null, 2);
		writeFileSync(CONFIG_FILE, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save configuration: ${error}`);
	}
}

export function updateOpenAiConfig(apiConfig: Partial<ApiConfig>): void {
	const currentConfig = loadConfig();
	const updatedConfig: AppConfig = {
		...currentConfig,
		snowcfg: {...currentConfig.snowcfg, ...apiConfig},
	};
	saveConfig(updatedConfig);
}

export function getOpenAiConfig(): ApiConfig {
	const config = loadConfig();
	return config.snowcfg;
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
		const defaultMCPConfig = cloneDefaultMCPConfig();
		updateMCPConfig(defaultMCPConfig);
		return defaultMCPConfig;
	}

	try {
		const configData = readFileSync(MCP_CONFIG_FILE, 'utf8');
		const config = JSON.parse(configData) as MCPConfig;
		return config;
	} catch (error) {
		const defaultMCPConfig = cloneDefaultMCPConfig();
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

/**
 * 读取自定义系统提示词
 * 如果 system-prompt.txt 文件存在且不为空，返回其内容
 * 否则返回 undefined (使用默认系统提示词)
 */
export function getCustomSystemPrompt(): string | undefined {
	ensureConfigDirectory();

	if (!existsSync(SYSTEM_PROMPT_FILE)) {
		return undefined;
	}

	try {
		const content = readFileSync(SYSTEM_PROMPT_FILE, 'utf8');

		// 只有当文件完全为空时才返回 undefined
		if (content.length === 0) {
			return undefined;
		}

		// 返回原始内容，不做任何处理
		return content;
	} catch {
		return undefined;
	}
}
