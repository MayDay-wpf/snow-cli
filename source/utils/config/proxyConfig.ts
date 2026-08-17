import {homedir} from 'os';
import {join} from 'path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';

/**
 * Supported search engine identifiers. Keep in sync with
 * `source/mcp/engines/websearch/types.ts` (SearchEngineId).
 *
 * Built-in engines are 'duckduckgo' and 'bing', but the id space is open:
 * users can drop additional engine plugins into
 * `~/.snow/plugin/search_engines/` and reference their ids here.
 */
export type SearchEngineId = string;

export interface ProxyConfig {
	enabled: boolean;
	port: number;
	host?: string; // Proxy host (IP or hostname), defaults to DEFAULT_PROXY_HOST
	browserPath?: string; // Custom browser executable path
	browserDebugPort?: number; // Remote debugging port for WSL mode (default: 9222)
	/**
	 * Search engine used by the web-search MCP tool. Defaults to 'duckduckgo'.
	 * Both engines are scraped via a headless browser (no public API used).
	 */
	searchEngine?: SearchEngineId;
	/**
	 * Regex patterns (one per entry) for blocking sites from search results
	 * and web page fetches. A URL whose host matches any pattern is filtered
	 * out of search results and cannot be fetched via websearch-fetch.
	 */
	blockedPatterns?: string[];
}

/** Default proxy host used when the user does not provide one. */
export const DEFAULT_PROXY_HOST = '127.0.0.1';

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
	enabled: false,
	port: 7890,
	host: DEFAULT_PROXY_HOST,
	browserDebugPort: 9222,
	searchEngine: 'duckduckgo',
	blockedPatterns: [],
};

/**
 * Sanitizes a proxy host string: strips protocol prefixes, trims whitespace,
 * and falls back to {@link DEFAULT_PROXY_HOST} when the result is empty.
 * Use this wherever a proxy URL is constructed from user-supplied config.
 */
export function sanitizeProxyHost(host: string | undefined): string {
	if (!host) {
		return DEFAULT_PROXY_HOST;
	}

	return host.trim().replace(/^https?:\/\//i, '') || DEFAULT_PROXY_HOST;
}

const CONFIG_DIR = join(homedir(), '.snow');
const PROXY_CONFIG_FILE = join(CONFIG_DIR, 'proxy-config.json');

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

/**
 * 加载代理配置
 */
export function loadProxyConfig(): ProxyConfig {
	ensureConfigDirectory();

	if (!existsSync(PROXY_CONFIG_FILE)) {
		saveProxyConfig(DEFAULT_PROXY_CONFIG);
		return DEFAULT_PROXY_CONFIG;
	}

	try {
		const configData = readFileSync(PROXY_CONFIG_FILE, 'utf8');
		const parsedConfig = JSON.parse(configData) as Partial<ProxyConfig>;

		const mergedConfig: ProxyConfig = {
			...DEFAULT_PROXY_CONFIG,
			...parsedConfig,
		};

		return mergedConfig;
	} catch (error) {
		console.error('Failed to load proxy config:', error);
		return DEFAULT_PROXY_CONFIG;
	}
}

/**
 * 保存代理配置
 */
export function saveProxyConfig(config: ProxyConfig): void {
	ensureConfigDirectory();

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(PROXY_CONFIG_FILE, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save proxy configuration: ${error}`);
	}
}

/**
 * 获取代理配置
 */
export function getProxyConfig(): ProxyConfig {
	return loadProxyConfig();
}

/**
 * 更新代理配置
 */
export async function updateProxyConfig(
	proxyConfig: ProxyConfig,
): Promise<void> {
	saveProxyConfig(proxyConfig);

	// Also save to the active profile if profiles system is initialized
	try {
		// Dynamic import for ESM compatibility
		const {getActiveProfileName, saveProfile, loadProfile} = await import(
			'./configManager.js'
		);
		const activeProfileName = getActiveProfileName();
		if (activeProfileName) {
			// Get current profile config
			const profileConfig = loadProfile(activeProfileName);
			if (profileConfig) {
				// Note: Profile configs don't include proxy anymore
				// Proxy is now managed independently
				// Just update profile's other configs if needed
				saveProfile(activeProfileName, profileConfig);
			}
		}
	} catch {
		// Profiles system not available yet (during initialization), skip sync
	}
}

/**
 * 推荐屏蔽模板：覆盖低质 SEO 站点及其全部二级/子域名。
 * `(^|\.)` 前缀 + `$` 结尾保证只匹配该域名本身及其子域，不误伤主域其它站点
 * （如 baidu.com 搜索本身、tencent.com 官网）。
 */
export const RECOMMENDED_BLOCKED_PATTERNS: string[] = [
	// 腾讯云计算（cloud.tencent.com 及 *.cloud.tencent.com）
	String.raw`(^|\.)cloud\.tencent\.com$`,
	// 百度文库（wenku.baidu.com 及子域）
	String.raw`(^|\.)wenku\.baidu\.com$`,
	// 百度智能云（cloud.baidu.com / bce.baidu.com 旧域名及子域）
	String.raw`(^|\.)(cloud|bce)\.baidu\.com$`,
	// 百度开发者中心（developer.baidu.com 及子域）
	String.raw`(^|\.)developer\.baidu\.com$`,
	// CSDN 全站（www/blog/ask/download 等子域）
	String.raw`(^|\.)csdn\.net$`,
];

/**
 * 将配置中的正则字符串列表编译为 RegExp 实例，跳过无效规则。
 * 所有规则均使用大小写不敏感匹配（`i` 标志）。
 */
export function compileBlockedPatterns(
	patterns: string[] | undefined,
): RegExp[] {
	if (!patterns || patterns.length === 0) {
		return [];
	}

	const compiled: RegExp[] = [];
	for (const pattern of patterns) {
		const trimmed = pattern.trim();
		if (!trimmed) {
			continue;
		}

		try {
			compiled.push(new RegExp(trimmed, 'i'));
		} catch {
			// Ignore invalid regex patterns
		}
	}

	return compiled;
}

/**
 * 检查给定 URL 是否命中拦截规则。
 *
 * 匹配候选包括 URL 原文和 URL 的 host 部分，确保像
 * `(^|\.)csdn\.net$` 这样的规则既能匹配 `https://blog.csdn.net/...`
 * （通过 host `blog.csdn.net`），也能匹配裸 URL。
 */
export function isUrlBlocked(
	url: string,
	compiledPatterns: RegExp[],
): boolean {
	if (compiledPatterns.length === 0) {
		return false;
	}

	const candidates = [url];
	try {
		candidates.push(new URL(url).host);
	} catch {
		// 非标准 URL 直接匹配原文
	}

	return compiledPatterns.some(regex =>
		candidates.some(candidate => regex.test(candidate)),
	);
}
