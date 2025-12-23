import {homedir} from 'os';
import {join} from 'path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';

export interface ProxyConfig {
	enabled: boolean;
	port: number;
	browserPath?: string; // Custom browser executable path
	browserDebugPort?: number; // Remote debugging port for WSL mode (default: 9222)
}

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
	enabled: false,
	port: 7890,
	browserDebugPort: 9222,
};

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
