import { getProxyConfig } from './apiConfig.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import type { Agent as HttpAgent } from 'http';
import type { Agent as HttpsAgent } from 'https';

/**
 * 创建代理 Agent（如果启用了代理）
 * @param targetUrl - 目标 URL，用于判断是否使用 HTTPS
 * @returns HTTP/HTTPS Agent，如果未启用代理则返回 undefined
 */
export function createProxyAgent(targetUrl: string): HttpAgent | HttpsAgent | undefined {
	const proxyConfig = getProxyConfig();

	// 如果代理未启用，直接返回 undefined
	if (!proxyConfig.enabled) {
		return undefined;
	}

	// 构建代理 URL
	const proxyUrl = `http://127.0.0.1:${proxyConfig.port}`;

	// 根据目标 URL 协议选择合适的代理 Agent
	try {
		const url = new URL(targetUrl);
		if (url.protocol === 'https:') {
			return new HttpsProxyAgent(proxyUrl) as HttpsAgent;
		} else {
			return new HttpProxyAgent(proxyUrl) as HttpAgent;
		}
	} catch (error) {
		// URL 解析失败，默认使用 HTTPS
		return new HttpsProxyAgent(proxyUrl) as HttpsAgent;
	}
}

/**
 * 为 fetch 请求添加代理支持
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @returns 添加了代理支持的 fetch 选项
 */
export function addProxyToFetchOptions(url: string, options: RequestInit = {}): RequestInit {
	const agent = createProxyAgent(url);

	if (!agent) {
		return options;
	}

	// 添加 agent 到 fetch 选项
	// 注意：Node.js 的 fetch 支持 dispatcher 选项
	return {
		...options,
		// @ts-ignore - Node.js fetch 支持 agent
		agent,
	};
}
