/**
 * OpenAI Responses API 的 WebSocket 传输层。
 *
 * 协议要点（对齐官方 WebSocket mode）：
 * - 复用 HTTP 模式的 /responses 端点，仅把协议从 http(s) 换成 ws(s)。
 * - 客户端发送 type 为 response.create 的事件，字段与 POST /v1/responses 相同；
 *   其中 stream 在 WebSocket 下是隐式的，不应发送。
 * - 服务端推送与 SSE 完全一致的事件对象（response.output_text.delta 等），
 *   因此上层可以复用同一套事件处理逻辑。
 * - 服务端以 response.completed / response.failed / response.incomplete / error
 *   结束一轮响应。
 */

import {WebSocket} from 'ws';
import {HttpProxyAgent} from 'http-proxy-agent';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {
	getProxyConfig,
	sanitizeProxyHost,
} from '../utils/config/proxyConfig.js';
import {shouldBypassProxy} from '../utils/core/proxyUtils.js';
import {
	STREAM_IDLE_TIMEOUT_MS,
	StreamIdleTimeoutError,
} from '../utils/core/streamGuards.js';
import {logger} from '../utils/core/logger.js';

const log = logger.child('api:responsesWebSocket');

/** WebSocket 握手超时（毫秒）。 */
const WEB_SOCKET_HANDSHAKE_TIMEOUT_MS = 30000;

export type ResponsesWebSocketRequest = {
	/** HTTP(S) 形式的 /responses 端点；内部会转换为 ws(s) 端点。 */
	endpoint: string;
	/** 握手请求头（Authorization、自定义请求头等）。 */
	headers: Record<string, string>;
	/** response.create 负载；stream 字段由本层剔除。 */
	payload: Record<string, unknown>;
	/** 用户中断信号。 */
	abortSignal?: AbortSignal;
	/** 空闲超时（毫秒），超时按可重试的流中断处理。 */
	idleTimeoutMs?: number;
};

/**
 * 把 HTTP(S) 端点转换为 WebSocket 端点，路径与查询参数保持不变。
 * 例：https://api.openai.com/v1/responses -> wss://api.openai.com/v1/responses
 */
export function toWebSocketEndpoint(endpoint: string): string {
	const url = new URL(endpoint);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

/**
 * 依据目标端点协议选择代理 agent。
 * 代理未启用或目标命中直连规则时返回 undefined（表示直连）。
 */
function createProxyAgent(
	endpoint: string,
): HttpProxyAgent<string> | HttpsProxyAgent<string> | undefined {
	if (shouldBypassProxy(endpoint)) {
		return undefined;
	}

	const proxyConfig = getProxyConfig();
	if (!proxyConfig.enabled) {
		return undefined;
	}

	const proxyUrl = `http://${sanitizeProxyHost(proxyConfig.host)}:${
		proxyConfig.port
	}`;

	try {
		return endpoint.startsWith('wss:')
			? new HttpsProxyAgent(proxyUrl)
			: new HttpProxyAgent(proxyUrl);
	} catch {
		// 代理不可用时退化为直连，避免代理配置问题完全阻断请求
		return undefined;
	}
}

/**
 * 通过 Responses API WebSocket 长连接执行一次 response.create，
 * 并逐个产出服务端事件（结构与 SSE 事件一致）。
 *
 * 错误约定：网络异常、握手失败与空闲超时都会抛出可重试错误
 * （消息包含 [RETRIABLE] 语义关键词），交由上层重试链路处理。
 */
export async function* streamResponsesWebSocket(
	request: ResponsesWebSocketRequest,
): AsyncGenerator<any, void, unknown> {
	const endpoint = toWebSocketEndpoint(request.endpoint);
	const idleTimeoutMs = request.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
	const {abortSignal} = request;

	// WebSocket 模式下 stream 是隐式语义，必须从负载中剔除
	const payload: Record<string, unknown> = {...request.payload};
	delete payload['stream'];

	const socket = new WebSocket(endpoint, {
		headers: request.headers,
		agent: createProxyAgent(endpoint),
	});

	/** 已解析但尚未被消费的服务端事件。 */
	const pendingEvents: any[] = [];
	/** 等待中的消费者唤醒回调。 */
	let waiters: Array<() => void> = [];
	let handshakeSettled = false;
	let opened = false;
	let closed = false;
	let failure: Error | null = null;
	let idleTimeoutError: StreamIdleTimeoutError | null = null;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

	const wakeAll = () => {
		const pending = waiters;
		waiters = [];
		for (const resolve of pending) {
			resolve();
		}
	};

	const waitForSignal = () =>
		new Promise<void>(resolve => {
			waiters.push(resolve);
		});

	const terminateSocket = () => {
		try {
			if (
				socket.readyState === WebSocket.OPEN ||
				socket.readyState === WebSocket.CONNECTING
			) {
				socket.terminate();
			}
		} catch (e) {
			log.debug('Failed to terminate websocket cleanly', {
				error: e instanceof Error ? e.message : String(e),
			});
		}
	};

	const resetIdleTimer = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
		}

		idleTimer = setTimeout(() => {
			idleTimeoutError = new StreamIdleTimeoutError(
				`No WebSocket data received for ${idleTimeoutMs}ms`,
				idleTimeoutMs,
			);
			wakeAll();
			terminateSocket();
		}, idleTimeoutMs);
	};

	const clearTimers = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}

		if (handshakeTimer) {
			clearTimeout(handshakeTimer);
			handshakeTimer = null;
		}
	};

	const handleAbort = () => {
		wakeAll();
		terminateSocket();
	};

	const cleanup = () => {
		clearTimers();
		abortSignal?.removeEventListener('abort', handleAbort);
		socket.removeAllListeners();
		// 保留空 error 监听，避免关闭阶段的 error 事件成为未捕获异常
		socket.on('error', () => {
			// 清理阶段忽略后续错误
		});

		try {
			if (
				socket.readyState === WebSocket.OPEN ||
				socket.readyState === WebSocket.CONNECTING
			) {
				socket.close();
			}
		} catch (e) {
			log.debug('Failed to close websocket cleanly on cleanup', {
				error: e instanceof Error ? e.message : String(e),
			});
		}
	};

	socket.on('open', () => {
		handshakeSettled = true;
		opened = true;

		if (handshakeTimer) {
			clearTimeout(handshakeTimer);
			handshakeTimer = null;
		}

		resetIdleTimer();
		wakeAll();
	});

	socket.on('message', data => {
		resetIdleTimer();

		const buffer = Array.isArray(data)
			? Buffer.concat(data)
			: Buffer.isBuffer(data)
			? data
			: Buffer.from(data);

		let event: any;
		try {
			event = JSON.parse(buffer.toString('utf8'));
		} catch {
			// 非 JSON 帧直接忽略，等待后续事件
			return;
		}

		if (
			!event ||
			typeof event !== 'object' ||
			typeof event.type !== 'string'
		) {
			return;
		}

		pendingEvents.push(event);
		wakeAll();
	});

	socket.on('error', error => {
		handshakeSettled = true;

		if (!failure) {
			// 措辞需包含网络类关键词，确保被重试链路的可重试判定识别
			failure = new Error(
				`OpenAI Responses WebSocket network error: ${error.message}`,
			);
		}

		wakeAll();
	});

	socket.on('close', (code, reason) => {
		handshakeSettled = true;
		closed = true;

		if (!failure && !idleTimeoutError && !abortSignal?.aborted) {
			const reasonText = reason?.toString('utf8').trim();
			const detail = reasonText ? `, reason: ${reasonText}` : '';
			failure = new Error(
				opened
					? `Stream terminated unexpectedly: WebSocket closed with code ${code}${detail}`
					: `OpenAI Responses WebSocket network error: connection unavailable during handshake (close code ${code}${detail})`,
			);
		}

		wakeAll();
	});

	if (abortSignal?.aborted) {
		cleanup();
		return;
	}

	abortSignal?.addEventListener('abort', handleAbort);

	handshakeTimer = setTimeout(() => {
		if (handshakeSettled) {
			return;
		}

		failure = new Error(
			`OpenAI Responses WebSocket network error: handshake timeout after ${WEB_SOCKET_HANDSHAKE_TIMEOUT_MS}ms`,
		);
		wakeAll();
		terminateSocket();
	}, WEB_SOCKET_HANDSHAKE_TIMEOUT_MS);

	try {
		while (!handshakeSettled) {
			await waitForSignal();
		}

		if (abortSignal?.aborted) {
			return;
		}

		if (failure) {
			throw failure;
		}

		if (idleTimeoutError) {
			throw idleTimeoutError;
		}

		if (!opened) {
			throw new Error(
				'OpenAI Responses WebSocket network error: connection did not open',
			);
		}

		socket.send(JSON.stringify({type: 'response.create', ...payload}));

		while (true) {
			if (pendingEvents.length > 0) {
				yield pendingEvents.shift();
				continue;
			}

			if (abortSignal?.aborted) {
				return;
			}

			if (idleTimeoutError) {
				throw idleTimeoutError;
			}

			if (failure) {
				throw failure;
			}

			if (closed) {
				throw new Error(
					'Stream terminated unexpectedly: WebSocket closed before the response completed',
				);
			}

			await waitForSignal();
		}
	} finally {
		cleanup();
	}
}
