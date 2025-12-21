import {getProxyConfig} from '../config/proxyConfig.js';
import {ProxyAgent, setGlobalDispatcher} from 'undici';

let globalProxyInitialized = false;

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
		proxyUrl = `http://127.0.0.1:${proxyConfig.port}`;
	} else {
		//其次使用系统环境变量
		proxyUrl = process.env['https_proxy'] || process.env['HTTPS_PROXY'] || 
		           process.env['http_proxy'] || process.env['HTTP_PROXY'];
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
export function createProxyAgent(_targetUrl: string): ProxyAgent | undefined {
	const proxyConfig = getProxyConfig();

	// 如果代理未启用，直接返回 undefined
	if (!proxyConfig.enabled) {
		return undefined;
	}

	// 构建代理 URL
	const proxyUrl = `http://127.0.0.1:${proxyConfig.port}`;

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
