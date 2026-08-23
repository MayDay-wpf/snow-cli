import {getProxyConfig, sanitizeProxyHost} from '../config/proxyConfig.js';
import {Agent, ProxyAgent, setGlobalDispatcher} from 'undici';

let globalProxyInitialized = false;
let directAgent: Agent | undefined;

function isPrivateIPv4(host: string): boolean {
	const octets = host.split('.');
	if (octets.length !== 4 || octets.some(octet => !/^\d+$/.test(octet))) {
		return false;
	}

	const values = octets.map(Number);
	if (values.some(value => value < 0 || value > 255)) {
		return false;
	}

	const first = values[0] ?? -1;
	const second = values[1] ?? -1;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

/**
 * 判断主机是否为本机或私有网络地址。
 * 代理只用于外部请求，避免全局 ProxyAgent 把 MCP 的本地请求也转发到代理。
 */
export function isLocalOrPrivateHost(host: string): boolean {
	const normalized =
		host
			.trim()
			.toLowerCase()
			.replace(/^\[|\]$/g, '')
			.split('%', 1)[0] ?? '';

	if (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized.endsWith('.local')
	) {
		return true;
	}

	if (isPrivateIPv4(normalized)) {
		return true;
	}

	if (normalized === '::' || normalized === '::1') {
		return true;
	}

	if (normalized.startsWith('::ffff:')) {
		return isPrivateIPv4(normalized.slice('::ffff:'.length));
	}

	const firstColon = normalized.indexOf(':');
	if (firstColon === -1) {
		return false;
	}

	const firstHextet = normalized.slice(0, firstColon);
	const firstByte = Number.parseInt(firstHextet.slice(0, 2), 16);
	const secondByte = Number.parseInt(
		firstHextet.length > 2
			? firstHextet.slice(2, 4)
			: normalized.slice(firstColon + 1, firstColon + 3),
		16,
	);

	return (
		(firstByte >= 0xfc && firstByte <= 0xfd) ||
		(firstByte === 0xfe && secondByte >= 0x80 && secondByte <= 0xbf)
	);
}

/** 判断 URL 是否应绕过应用代理。无法解析的 URL 默认仍使用代理。 */
export function shouldBypassProxy(targetUrl: string): boolean {
	try {
		return isLocalOrPrivateHost(new URL(targetUrl).hostname);
	} catch {
		return false;
	}
}

function getDirectAgent(): Agent {
	if (!directAgent) {
		directAgent = new Agent();
	}

	return directAgent;
}

/**
 * 初始化全局代理（让所有fetch请求自动走代理）
 * 优先使用Snow配置，其次使用系统环境变量
 */
export function initGlobalProxy(): void {
	if (globalProxyInitialized) {
		return;
	}

	let proxyUrl: string | undefined;

	//优先使用Snow代理配置
	const proxyConfig = getProxyConfig();
	if (proxyConfig.enabled) {
		const host = sanitizeProxyHost(proxyConfig.host);
		proxyUrl = `http://${host}:${proxyConfig.port}`;
	} else {
		//其次使用系统环境变量
		proxyUrl =
			process.env['https_proxy'] ||
			process.env['HTTPS_PROXY'] ||
			process.env['http_proxy'] ||
			process.env['HTTP_PROXY'];
	}

	if (proxyUrl) {
		try {
			const agent = new ProxyAgent(proxyUrl);
			setGlobalDispatcher(agent);
			globalProxyInitialized = true;
		} catch (error) {
			console.error('Failed to initialize global proxy:', error);
		}
	}
}

/**
 * 创建 undici ProxyAgent（如果启用了代理）
 * @param targetUrl - 目标 URL（用于日志或未来扩展）
 * @returns ProxyAgent，如果未启用代理则返回 undefined
 */
export function createProxyAgent(
	targetUrl: string,
): ProxyAgent | Agent | undefined {
	// 全局 ProxyAgent 会接管没有 dispatcher 的 fetch。为本地和私有网络
	// 请求显式指定直连 Agent，才能真正绕过全局代理。
	if (shouldBypassProxy(targetUrl)) {
		return getDirectAgent();
	}

	const proxyConfig = getProxyConfig();

	// 如果代理未启用，直接返回 undefined
	if (!proxyConfig.enabled) {
		return undefined;
	}

	// 构建代理 URL
	const host = sanitizeProxyHost(proxyConfig.host);
	const proxyUrl = `http://${host}:${proxyConfig.port}`;

	try {
		return new ProxyAgent(proxyUrl);
	} catch (error) {
		// 代理创建失败，返回 undefined 让请求直连
		console.error('Failed to create proxy agent:', error);
		return undefined;
	}
}

/**
 * 为 fetch 请求添加代理支持
 * 使用 undici 的 dispatcher 选项（Node.js 原生 fetch 支持）
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @returns 添加了代理支持的 fetch 选项
 */
export function addProxyToFetchOptions(
	url: string,
	options: RequestInit = {},
): RequestInit {
	const agent = createProxyAgent(url);

	if (!agent) {
		return options;
	}

	// 使用 undici 的 dispatcher 选项
	// Node.js 原生 fetch 基于 undici，支持 dispatcher
	return {
		...options,
		// @ts-expect-error - Node.js fetch 支持 dispatcher 选项，但 TypeScript 类型定义中没有
		dispatcher: agent,
	};
}
