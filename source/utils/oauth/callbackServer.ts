/**
 * OAuth 本地回调服务器：登录期间在本机监听 provider 约定的端口，
 * 接收浏览器重定向的授权码并返回结果页面。
 *
 * 对齐 Snow App 的 native/src/api/oauth/server.rs。
 */

import {createServer, type Server} from 'http';
import type {AddressInfo} from 'net';
import {OAUTH_PROVIDERS} from './constants.js';
import type {OAuthProviderId} from './types.js';

export interface CallbackServerHandle {
	server: Server;
	port: number;
	/** 关闭监听（幂等） */
	close: () => void;
}

export interface CallbackServerOptions {
	provider: OAuthProviderId;
	/** 按顺序尝试绑定的端口列表 */
	ports: number[];
	onCallback: (
		params: URLSearchParams,
	) => Promise<{ok: boolean; message?: string}>;
}

/**
 * 在 127.0.0.1 上按顺序尝试绑定端口，返回第一个成功监听的句柄；
 * 全部端口不可用时返回 null（调用方进入手动粘贴回调地址模式）。
 */
export async function startCallbackServer(
	options: CallbackServerOptions,
): Promise<CallbackServerHandle | null> {
	const def = OAUTH_PROVIDERS[options.provider];
	const path = def.callbackPath;

	for (const port of options.ports) {
		const handle = await tryListen(port, async (req, res) => {
			try {
				const url = new URL(req.url ?? '/', `http://${def.redirectHost}`);
				if (url.pathname !== path) {
					res.statusCode = 404;
					res.setHeader('Content-Type', 'text/plain; charset=utf-8');
					res.end('Not found');
					return;
				}
				const result = await options.onCallback(url.searchParams);
				if (result.ok) {
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.end(renderPage(successBody()));
				} else {
					res.statusCode = 400;
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.end(
						renderPage(
							errorBody(escapeHtml(result.message ?? 'Sign-in failed')),
						),
					);
				}
			} catch (error) {
				res.statusCode = 500;
				res.setHeader('Content-Type', 'text/plain; charset=utf-8');
				res.end(error instanceof Error ? error.message : 'Internal error');
			}
		});
		if (handle) {
			return handle;
		}
	}
	return null;
}

function tryListen(
	port: number,
	handler: (
		req: import('http').IncomingMessage,
		res: import('http').ServerResponse,
	) => Promise<void>,
): Promise<CallbackServerHandle | null> {
	return new Promise(resolve => {
		const server = createServer((req, res) => {
			void handler(req, res);
		});

		let settled = false;
		server.once('error', () => {
			if (settled) {
				return;
			}
			settled = true;
			try {
				server.close();
			} catch {
				// ignore
			}
			resolve(null);
		});

		server.listen(port, '127.0.0.1', () => {
			if (settled) {
				return;
			}
			settled = true;
			const address = server.address() as AddressInfo | null;
			resolve({
				server,
				port: address?.port ?? port,
				close: () => {
					try {
						server.close();
					} catch {
						// ignore close errors
					}
				},
			});
		});
	});
}

function renderPage(body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snow CLI</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0f1115; color: #e8eaed; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 420px; padding: 40px 32px; text-align: center; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
p { font-size: 13px; line-height: 1.7; color: #9aa0a6; margin: 6px 0; }
.icon { width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.06); font-size: 26px; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function successBody(): string {
	return `<div class="icon">&#10003;</div>
<h1>Sign-in complete</h1>
<p>You can close this window and return to Snow CLI.</p>
<p>登录已完成，可以关闭此窗口并返回 Snow CLI。</p>`;
}

function errorBody(message: string): string {
	return `<div class="icon">!</div>
<h1>Sign-in failed</h1>
<p>${message}</p>
<p>登录失败，请返回 Snow CLI 后重试。</p>`;
}

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
