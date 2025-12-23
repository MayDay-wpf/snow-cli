import { homedir } from 'os';
import { join } from 'path';
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	unlinkSync,
} from 'fs';

export type RequestMethod = 'chat' | 'responses' | 'gemini' | 'anthropic';

export interface CompactModelConfig {
	modelName: string;
}

export interface ThinkingConfig {
	type: 'enabled';
	budget_tokens: number;
}

export interface GeminiThinkingConfig {
	enabled: boolean;
	budget: number;
}

export interface ResponsesReasoningConfig {
	enabled: boolean;
	effort: 'low' | 'medium' | 'high' | 'xhigh';
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
	anthropicCacheTTL?: '5m' | '1h'; // Anthropic prompt cache TTL (default: 5m)
	thinking?: ThinkingConfig; // Anthropic thinking configuration
	geminiThinking?: GeminiThinkingConfig; // Gemini thinking configuration
	responsesReasoning?: ResponsesReasoningConfig; // Responses API reasoning configuration
	enablePromptOptimization?: boolean; // Enable prompt optimization agent (default: true)
	enableAutoCompress?: boolean; // Enable automatic context compression (default: true)
	showThinking?: boolean; // Show AI thinking process in UI (default: true)
	// 选填：覆盖 system-prompt.json 的 active（undefined=跟随全局；''=不使用；其它=按ID选择）
	systemPromptId?: string;
	// 选填：覆盖 custom-headers.json 的 active（undefined=跟随全局；''=不使用；其它=按ID选择）
	customHeadersSchemeId?: string;
}

export interface MCPServer {
	url?: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>; // 环境变量
	enabled?: boolean; // 是否启用该MCP服务，默认为true
	timeout?: number; // 工具调用超时时间（毫秒），默认 300000 (5分钟)
}

export interface MCPConfig {
	mcpServers: Record<string, MCPServer>;
}

export interface AppConfig {
	snowcfg: ApiConfig;
	openai?: ApiConfig; // 向下兼容旧版本
}

/**
 * 系统提示词配置项
 */
export interface SystemPromptItem {
	id: string; // 唯一标识
	name: string; // 名称
	content: string; // 提示词内容
	createdAt: string; // 创建时间
}

/**
 * 系统提示词配置
 */
export interface SystemPromptConfig {
	active: string; // 当前激活的提示词 ID
	prompts: SystemPromptItem[]; // 提示词列表
}

/**
 * 自定义请求头方案项
 */
export interface CustomHeadersItem {
	id: string; // 唯一标识
	name: string; // 方案名称
	headers: Record<string, string>; // 请求头键值对
	createdAt: string; // 创建时间
}

/**
 * 自定义请求头配置
 */
export interface CustomHeadersConfig {
	active: string; // 当前激活的方案 ID
	schemes: CustomHeadersItem[]; // 方案列表
}

export const DEFAULT_CONFIG: AppConfig = {
	snowcfg: {
		baseUrl: 'https://api.openai.com/v1',
		apiKey: '',
		requestMethod: 'chat',
		advancedModel: '',
		basicModel: '',
		maxContextTokens: 120000,
		maxTokens: 32000,
		anthropicBeta: false,
	},
};

const DEFAULT_MCP_CONFIG: MCPConfig = {
	mcpServers: {},
};

const CONFIG_DIR = join(homedir(), '.snow');
const PROXY_CONFIG_FILE = join(CONFIG_DIR, 'proxy-config.json');

const SYSTEM_PROMPT_FILE = join(CONFIG_DIR, 'system-prompt.txt'); // 旧版本，保留用于迁移
const SYSTEM_PROMPT_JSON_FILE = join(CONFIG_DIR, 'system-prompt.json'); // 新版本
const CUSTOM_HEADERS_FILE = join(CONFIG_DIR, 'custom-headers.json');

/**
 * 迁移旧版本的 proxy 配置到新的独立文件
 */
function migrateProxyConfigToNewFile(legacyProxy: any): void {
	try {
		if (!existsSync(PROXY_CONFIG_FILE)) {
			const proxyConfig = {
				enabled: legacyProxy.enabled ?? false,
				port: legacyProxy.port ?? 7890,
				browserPath: legacyProxy.browserPath,
			};
			writeFileSync(
				PROXY_CONFIG_FILE,
				JSON.stringify(proxyConfig, null, 2),
				'utf8',
			);
			//console.log('✅ Migrated proxy config to proxy-config.json');
		}
	} catch (error) {
		console.error('Failed to migrate proxy config:', error);
	}
}

function normalizeRequestMethod(method: unknown): RequestMethod {
	if (
		method === 'chat' ||
		method === 'responses' ||
		method === 'gemini' ||
		method === 'anthropic'
	) {
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
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

function cloneDefaultMCPConfig(): MCPConfig {
	return {
		mcpServers: { ...DEFAULT_MCP_CONFIG.mcpServers },
	};
}

// 配置缓存
let configCache: AppConfig | null = null;

export function loadConfig(): AppConfig {
	// 如果缓存存在，直接返回缓存
	if (configCache !== null) {
		return configCache;
	}

	ensureConfigDirectory();

	if (!existsSync(CONFIG_FILE)) {
		saveConfig(DEFAULT_CONFIG);
		configCache = DEFAULT_CONFIG;
		return DEFAULT_CONFIG;
	}

	try {
		const configData = readFileSync(CONFIG_FILE, 'utf8');
		const parsedConfig = JSON.parse(configData) as Partial<AppConfig> & {
			mcp?: unknown;
			proxy?: unknown;
		};
		const { mcp: legacyMcp, proxy: legacyProxy, ...restConfig } = parsedConfig;
		const configWithoutMcp = restConfig as Partial<AppConfig>;

		// 向下兼容：如果存在 openai 配置但没有 snowcfg，则使用 openai 配置
		let apiConfig: ApiConfig;
		if (configWithoutMcp.snowcfg) {
			apiConfig = {
				...DEFAULT_CONFIG.snowcfg,
				...configWithoutMcp.snowcfg,
				requestMethod: normalizeRequestMethod(
					configWithoutMcp.snowcfg.requestMethod,
				),
			};
		} else if (configWithoutMcp.openai) {
			// 向下兼容旧版本
			apiConfig = {
				...DEFAULT_CONFIG.snowcfg,
				...configWithoutMcp.openai,
				requestMethod: normalizeRequestMethod(
					configWithoutMcp.openai.requestMethod,
				),
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

		// 如果检测到旧版本的 proxy 配置，迁移到新的独立文件
		if (legacyProxy !== undefined) {
			// 使用同步方式迁移
			migrateProxyConfigToNewFile(legacyProxy);
		}

		// 如果是从旧版本迁移过来的，保存新配置（移除 proxy 字段）
		if (
			legacyMcp !== undefined ||
			legacyProxy !== undefined ||
			(configWithoutMcp.openai && !configWithoutMcp.snowcfg)
		) {
			saveConfig(mergedConfig);
		}

		// 缓存配置
		configCache = mergedConfig;
		return mergedConfig;
	} catch (error) {
		configCache = DEFAULT_CONFIG;
		return DEFAULT_CONFIG;
	}
}

export function saveConfig(config: AppConfig): void {
	ensureConfigDirectory();

	try {
		// 只保留 snowcfg，去除 openai 字段
		const { openai, ...configWithoutOpenai } = config;
		const configData = JSON.stringify(configWithoutOpenai, null, 2);
		writeFileSync(CONFIG_FILE, configData, 'utf8');
		// 清除缓存，下次加载时会重新读取
		configCache = null;
	} catch (error) {
		throw new Error(`Failed to save configuration: ${error}`);
	}
}

/**
 * 清除配置缓存，强制下次调用 loadConfig 时重新读取磁盘
 */
export function clearConfigCache(): void {
	configCache = null;
}

/**
 * 重新加载配置（清除缓存后重新读取）
 */
export function reloadConfig(): AppConfig {
	clearConfigCache();
	return loadConfig();
}

export async function updateOpenAiConfig(
	apiConfig: Partial<ApiConfig>,
): Promise<void> {
	const currentConfig = loadConfig();
	const updatedConfig: AppConfig = {
		...currentConfig,
		snowcfg: { ...currentConfig.snowcfg, ...apiConfig },
	};
	saveConfig(updatedConfig);

	// Also save to the active profile if profiles system is initialized
	try {
		// Dynamic import for ESM compatibility
		const { getActiveProfileName, saveProfile, clearAllAgentCaches } =
			await import('./configManager.js');
		const activeProfileName = getActiveProfileName();
		if (activeProfileName) {
			saveProfile(activeProfileName, updatedConfig);
		}
		// Clear all agent caches to ensure they reload with new configuration
		clearAllAgentCaches();
	} catch {
		// Profiles system not available yet (during initialization), skip sync
	}
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
				const urlWithEnvReplaced = server.url.replace(
					/\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/g,
					'placeholder',
				);
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
						errors.push(
							`Environment variable name cannot be empty for server "${name}"`,
						);
					}
					if (typeof envValue !== 'string') {
						errors.push(
							`Environment variable "${envName}" must be a string for server "${name}"`,
						);
					}
				});
			}
		});
	}

	return errors;
}

/**
 * 从旧版本 system-prompt.txt 迁移到新版本 system-prompt.json
 */
function migrateSystemPromptFromTxt(): void {
	if (!existsSync(SYSTEM_PROMPT_FILE)) {
		return;
	}

	try {
		const txtContent = readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
		if (txtContent.trim().length === 0) {
			return;
		}

		// 创建默认配置，将旧内容作为默认项
		const config: SystemPromptConfig = {
			active: 'default',
			prompts: [
				{
					id: 'default',
					name: 'Default',
					content: txtContent,
					createdAt: new Date().toISOString(),
				},
			],
		};

		// 保存到新文件
		writeFileSync(
			SYSTEM_PROMPT_JSON_FILE,
			JSON.stringify(config, null, 2),
			'utf8',
		);

		// 删除旧文件
		unlinkSync(SYSTEM_PROMPT_FILE);

		// console.log('✅ Migrated system prompt from txt to json format.');
	} catch (error) {
		console.error('Failed to migrate system prompt:', error);
	}
}

/**
 * 读取系统提示词配置
 */
export function getSystemPromptConfig(): SystemPromptConfig | undefined {
	ensureConfigDirectory();

	// 先尝试迁移旧版本
	if (existsSync(SYSTEM_PROMPT_FILE) && !existsSync(SYSTEM_PROMPT_JSON_FILE)) {
		migrateSystemPromptFromTxt();
	}

	// 读取 JSON 配置
	if (!existsSync(SYSTEM_PROMPT_JSON_FILE)) {
		return undefined;
	}

	try {
		const content = readFileSync(SYSTEM_PROMPT_JSON_FILE, 'utf8');
		if (content.trim().length === 0) {
			return undefined;
		}

		const config: SystemPromptConfig = JSON.parse(content);
		return config;
	} catch (error) {
		console.error('Failed to read system prompt config:', error);
		return undefined;
	}
}

/**
 * 保存系统提示词配置
 */
export function saveSystemPromptConfig(config: SystemPromptConfig): void {
	ensureConfigDirectory();

	try {
		writeFileSync(
			SYSTEM_PROMPT_JSON_FILE,
			JSON.stringify(config, null, 2),
			'utf8',
		);
	} catch (error) {
		console.error('Failed to save system prompt config:', error);
		throw error;
	}
}

/**
 * 读取自定义系统提示词（当前激活的）
 * 兼容旧版本 system-prompt.txt
 * 新版本从 system-prompt.json 读取当前激活的提示词
 */
export function getCustomSystemPrompt(): string | undefined {
	const { systemPromptId } = getOpenAiConfig();
	const config = getSystemPromptConfig();

	if (!config) {
		return undefined;
	}

	// 显式关闭（即使全局有 active 也不使用）
	if (systemPromptId === '') {
		return undefined;
	}

	// profile 覆盖：允许选择列表中的任意项（不依赖 active 状态）
	if (systemPromptId) {
		const prompt = config.prompts.find(p => p.id === systemPromptId);
		return prompt?.content;
	}

	// 默认行为：跟随全局激活
	if (!config.active) {
		return undefined;
	}

	const activePrompt = config.prompts.find(p => p.id === config.active);
	return activePrompt?.content;
}

/**
 * 读取自定义请求头配置
 * 如果 custom-headers.json 文件存在且有效，返回其内容
 * 否则返回空对象
 */
export function getCustomHeaders(): Record<string, string> {
	ensureConfigDirectory();

	const { customHeadersSchemeId } = getOpenAiConfig();
	const config = getCustomHeadersConfig();
	if (!config) {
		return {};
	}

	// 显式关闭（即使全局有 active 也不使用）
	if (customHeadersSchemeId === '') {
		return {};
	}

	// profile 覆盖：允许选择列表中的任意项（不依赖 active 状态）
	if (customHeadersSchemeId) {
		const scheme = config.schemes.find(s => s.id === customHeadersSchemeId);
		return scheme?.headers || {};
	}

	// 默认行为：跟随全局激活
	if (!config.active) {
		return {};
	}

	const activeScheme = config.schemes.find(s => s.id === config.active);
	return activeScheme?.headers || {};
}

/**
 * 保存自定义请求头配置
 * @deprecated 使用 saveCustomHeadersConfig 替代
 */
export function saveCustomHeaders(headers: Record<string, string>): void {
	ensureConfigDirectory();

	try {
		// 过滤掉空键值对
		const filteredHeaders: Record<string, string> = {};
		for (const [key, value] of Object.entries(headers)) {
			if (key.trim() && value.trim()) {
				filteredHeaders[key.trim()] = value.trim();
			}
		}

		const content = JSON.stringify(filteredHeaders, null, 2);
		writeFileSync(CUSTOM_HEADERS_FILE, content, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save custom headers: ${error}`);
	}
}

/**
 * 获取自定义请求头配置（多方案）
 */
export function getCustomHeadersConfig(): CustomHeadersConfig | null {
	ensureConfigDirectory();

	if (!existsSync(CUSTOM_HEADERS_FILE)) {
		return null;
	}

	try {
		const content = readFileSync(CUSTOM_HEADERS_FILE, 'utf8');
		const data = JSON.parse(content);

		// 兼容旧版本格式 (直接是 Record<string, string>)
		if (
			typeof data === 'object' &&
			data !== null &&
			!Array.isArray(data) &&
			!('active' in data) &&
			!('schemes' in data)
		) {
			// 旧格式：转换为新格式
			const headers: Record<string, string> = {};
			for (const [key, value] of Object.entries(data)) {
				if (typeof value === 'string') {
					headers[key] = value;
				}
			}

			if (Object.keys(headers).length > 0) {
				// 创建默认方案
				const defaultScheme: CustomHeadersItem = {
					id: Date.now().toString(),
					name: 'Default Headers',
					headers,
					createdAt: new Date().toISOString(),
				};

				return {
					active: defaultScheme.id,
					schemes: [defaultScheme],
				};
			}

			return null;
		}

		// 新格式：验证结构
		if (
			typeof data === 'object' &&
			data !== null &&
			'active' in data &&
			'schemes' in data &&
			Array.isArray(data.schemes)
		) {
			return data as CustomHeadersConfig;
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * 保存自定义请求头配置（多方案）
 */
export function saveCustomHeadersConfig(config: CustomHeadersConfig): void {
	ensureConfigDirectory();

	try {
		const content = JSON.stringify(config, null, 2);
		writeFileSync(CUSTOM_HEADERS_FILE, content, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save custom headers config: ${error}`);
	}
}
