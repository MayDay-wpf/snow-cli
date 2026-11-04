import WebSocket from 'ws';
import {
	decodeFeishuFrame,
	encodeFeishuFrame,
	readFeishuHeader,
	type FeishuFrame,
} from './feishuProto.js';
import type {ConnectStatus} from './types.js';

const ENDPOINT_PATH = '/callback/ws/endpoint';
const DEFAULT_PING_INTERVAL_MS = 120000;
const MIN_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60000;
const PONG_GRACE_MS = 5000;
const FRAGMENT_TTL_MS = 5000;
const WATCHDOG_INTERVAL_MS = 5000;

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export interface FeishuConnectionOptions {
	domain: string;
	log: (message: string) => void;
	onEvent: (event: any) => Promise<void> | void;
	onStatus: (status: {status: ConnectStatus; detail?: string}) => void;
}

export interface FeishuConnection {
	start: (credentials: {appId: string; appSecret: string}) => Promise<void>;
	stop: () => void;
}

interface FragmentEntry {
	parts: Array<Buffer | null>;
	at: number;
}

export function createFeishuConnection(
	options: FeishuConnectionOptions,
): FeishuConnection {
	let link: WebSocket | null = null;
	let credentials: {appId: string; appSecret: string} | null = null;
	let running = false;
	let pingTimer: NodeJS.Timeout | null = null;
	let watchdogTimer: NodeJS.Timeout | null = null;
	let reconnectTimer: NodeJS.Timeout | null = null;
	let pingIntervalMs = DEFAULT_PING_INTERVAL_MS;
	let reconnectNonce = 30;
	let serviceId = 0;
	let attempt = 0;
	let lastInboundAt = 0;
	let generation = 0;
	const fragments = new Map<string, FragmentEntry>();

	const domain =
		String(options.domain ?? '')
			.trim()
			.replace(/\/+$/, '') || 'https://open.feishu.cn';

	const setStatus = (next: ConnectStatus, detail = ''): void => {
		options.onStatus({status: next, detail});
	};

	const clearTimers = (): void => {
		if (pingTimer) {
			clearInterval(pingTimer);
			pingTimer = null;
		}
		if (watchdogTimer) {
			clearInterval(watchdogTimer);
			watchdogTimer = null;
		}
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	};

	const applyConfig = (config: any): void => {
		const ping = Number(config?.PingInterval ?? 0);
		if (Number.isFinite(ping) && ping > 0) {
			pingIntervalMs = Math.max(10, ping) * 1000;
		}
		const nonce = Number(config?.ReconnectNonce ?? 0);
		if (Number.isFinite(nonce) && nonce > 0) {
			reconnectNonce = nonce;
		}
	};

	const bootstrap = async (): Promise<{url: string; config: any}> => {
		const response = await fetch(`${domain}${ENDPOINT_PATH}`, {
			method: 'POST',
			headers: {'Content-Type': 'application/json', locale: 'zh'},
			body: JSON.stringify({
				AppID: credentials?.appId,
				AppSecret: credentials?.appSecret,
			}),
			signal: AbortSignal.timeout(20000),
		});
		const parsed = (await response.json().catch(() => null)) as any;
		if (!parsed || parsed.code !== 0 || !parsed?.data?.URL) {
			throw new Error(
				`长连接引导失败：${parsed?.msg || `HTTP ${response.status}`}`,
			);
		}
		return {
			url: String(parsed.data.URL),
			config: parsed.data.ClientConfig ?? {},
		};
	};

	const sendBinary = (buffer: Buffer): boolean => {
		if (!link || link.readyState !== WebSocket.OPEN) {
			return false;
		}
		try {
			link.send(buffer);
			return true;
		} catch {
			return false;
		}
	};

	const sendPing = (): void => {
		const frame = encodeFeishuFrame({
			service: serviceId,
			method: 0,
			headers: [{key: 'type', value: 'ping'}],
		});
		if (!sendBinary(frame)) {
			options.log('飞书心跳帧发送失败');
		}
	};

	const startPing = (): void => {
		if (pingTimer) {
			clearInterval(pingTimer);
		}
		sendPing();
		pingTimer = setInterval(sendPing, pingIntervalMs);
	};

	const ack = (frame: FeishuFrame, code: number, startedAt: number): void => {
		const response = encodeFeishuFrame({
			seqId: frame.seqId,
			logId: frame.logId,
			service: frame.service,
			method: frame.method,
			headers: [
				...frame.headers,
				{key: 'biz_rt', value: String(Date.now() - startedAt)},
			],
			payload: Buffer.from(JSON.stringify({code}), 'utf8'),
		});
		if (!sendBinary(response)) {
			options.log('飞书事件回执发送失败');
		}
	};

	const handleEventFrame = async (
		frame: FeishuFrame,
		payload: Buffer,
		startedAt: number,
	): Promise<void> => {
		let code = 200;
		try {
			const event = JSON.parse(payload.toString('utf8'));
			await options.onEvent(event);
		} catch (error) {
			code = 500;
			options.log(`飞书事件处理失败：${describe(error)}`);
		}
		ack(frame, code, startedAt);
	};

	const combine = (
		messageId: string,
		sum: number,
		seq: number,
		payload: Buffer,
	): Buffer | null => {
		if (!messageId || !Number.isInteger(sum) || !Number.isInteger(seq)) {
			return null;
		}
		const entry = fragments.get(messageId) ?? {
			parts: new Array<Buffer | null>(sum).fill(null),
			at: Date.now(),
		};
		if (entry.parts.length !== sum) {
			entry.parts = new Array<Buffer | null>(sum).fill(null);
		}
		entry.parts[seq] = payload;
		entry.at = Date.now();
		fragments.set(messageId, entry);
		if (entry.parts.some(part => !part)) {
			return null;
		}
		fragments.delete(messageId);
		return Buffer.concat(entry.parts as Buffer[]);
	};

	const dispatch = (frame: FeishuFrame): void => {
		if (frame.method === 0) {
			if (readFeishuHeader(frame, 'type') === 'pong' && frame.payload?.length) {
				try {
					applyConfig(JSON.parse(frame.payload.toString('utf8')));
				} catch {
					options.log('飞书心跳回包解析失败');
				}
			}
			return;
		}
		if (frame.method !== 1) {
			return;
		}
		const type = readFeishuHeader(frame, 'type');
		const sum = Number(readFeishuHeader(frame, 'sum') || 1);
		const seq = Number(readFeishuHeader(frame, 'seq') || 0);
		let payload = frame.payload;
		if (sum > 1) {
			payload = combine(
				readFeishuHeader(frame, 'message_id'),
				sum,
				seq,
				payload ?? Buffer.alloc(0),
			);
			if (!payload) {
				return;
			}
		}
		if (type !== 'event' || !payload) {
			return;
		}
		const startedAt = Date.now();
		void handleEventFrame(frame, payload, startedAt);
	};

	const scheduleReconnect = (forGeneration: number): void => {
		if (!running || forGeneration !== generation || reconnectTimer) {
			return;
		}
		const base = Math.min(
			MIN_RECONNECT_DELAY_MS * 2 ** Math.min(attempt, 5),
			MAX_RECONNECT_DELAY_MS,
		);
		attempt += 1;
		const jitter = Math.floor(
			Math.random() * Math.min(reconnectNonce, 10) * 1000,
		);
		const delay = base + jitter;
		options.log(
			`${Math.round(delay / 1000)} 秒后重连飞书长连接（第 ${attempt} 次）`,
		);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void connect(forGeneration);
		}, delay);
	};

	const handleClose = (
		forGeneration: number,
		code: number,
		reason: string,
	): void => {
		if (forGeneration !== generation) {
			return;
		}
		clearTimers();
		link = null;
		if (!running) {
			setStatus('idle');
			return;
		}
		options.log(`飞书长连接断开（${code}${reason ? ` ${reason}` : ''}）`);
		setStatus('reconnecting', `连接断开（${code}）`);
		scheduleReconnect(forGeneration);
	};

	const startWatchdog = (): void => {
		if (watchdogTimer) {
			clearInterval(watchdogTimer);
		}
		watchdogTimer = setInterval(() => {
			const now = Date.now();
			for (const [key, entry] of fragments) {
				if (now - entry.at > FRAGMENT_TTL_MS) {
					fragments.delete(key);
				}
			}
			if (!link) {
				return;
			}
			if (now - lastInboundAt > pingIntervalMs * 2 + PONG_GRACE_MS) {
				options.log('长时间未收到飞书服务端数据，主动重连');
				const socket = link;
				link = null;
				clearTimers();
				try {
					socket.close(1000, 'read timeout');
				} catch {
					options.log('关闭飞书超时连接失败');
				}
				setStatus('reconnecting', '读超时');
				scheduleReconnect(generation);
			}
		}, WATCHDOG_INTERVAL_MS);
	};

	const connect = async (forGeneration: number): Promise<void> => {
		setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
		try {
			const {url, config} = await bootstrap();
			if (!running || forGeneration !== generation) {
				return;
			}
			applyConfig(config);
			serviceId = Number(new URL(url).searchParams.get('service_id') ?? 0) || 0;

			const socket = new WebSocket(url);
			socket.on('open', () => {
				if (forGeneration !== generation) {
					return;
				}
				attempt = 0;
				lastInboundAt = Date.now();
				setStatus('online');
				startPing();
				startWatchdog();
			});
			socket.on('message', data => {
				if (forGeneration !== generation) {
					return;
				}
				lastInboundAt = Date.now();
				try {
					const buffer = Buffer.isBuffer(data)
						? data
						: Array.isArray(data)
						? Buffer.concat(data)
						: Buffer.from(data as ArrayBuffer);
					dispatch(decodeFeishuFrame(buffer));
				} catch (error) {
					options.log(`飞书帧解析失败：${describe(error)}`);
				}
			});
			socket.on('error', error => {
				if (forGeneration === generation) {
					options.log(`飞书长连接错误：${describe(error)}`);
				}
			});
			socket.on('close', (code, reason) => {
				handleClose(forGeneration, code, reason.toString());
			});

			if (!running || forGeneration !== generation) {
				try {
					socket.close(1000, 'stale connection');
				} catch {
					options.log('关闭过期飞书连接失败');
				}
				return;
			}
			link = socket;
		} catch (error) {
			if (!running || forGeneration !== generation) {
				return;
			}
			const message = describe(error);
			options.log(message);
			setStatus('error', message);
			scheduleReconnect(forGeneration);
		}
	};

	const stop = (): void => {
		running = false;
		generation += 1;
		clearTimers();
		fragments.clear();
		const socket = link;
		link = null;
		if (socket) {
			try {
				socket.close(1000, 'connect stopped');
			} catch {
				options.log('关闭飞书长连接失败');
			}
		}
		credentials = null;
		setStatus('idle');
	};

	const start = async (nextCredentials: {
		appId: string;
		appSecret: string;
	}): Promise<void> => {
		const appId = String(nextCredentials.appId ?? '').trim();
		const appSecret = String(nextCredentials.appSecret ?? '');
		if (
			running &&
			credentials &&
			credentials.appId === appId &&
			credentials.appSecret === appSecret
		) {
			return;
		}
		stop();
		if (!appId || !appSecret) {
			options.log('未配置飞书 App ID / App Secret，长连接不启动');
			return;
		}
		credentials = {appId, appSecret};
		running = true;
		attempt = 0;
		generation += 1;
		void connect(generation);
	};

	return {start, stop};
}
