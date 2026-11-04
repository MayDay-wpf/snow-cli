import {promises as fs} from 'node:fs';
import path from 'node:path';
import {getGlobalSnowDir} from '../core/snowContext.js';
import {logger} from '../core/logger.js';
import {
	createDefaultConfig,
	createDefaultRuntime,
	createDefaultState,
	type ConnectBinding,
	type ConnectChannelId,
	type ConnectChannelState,
	type ConnectChannelStatePatch,
	type ConnectConfig,
	type ConnectLogEntry,
	type ConnectRuntime,
	type ConnectSnapshot,
	type ConnectState,
	DEFAULT_FEISHU_CONFIG,
	DEFAULT_TELEGRAM_CONFIG,
} from './types.js';

const log = logger.child('connect:store');

const CONNECT_DIR = getGlobalSnowDir().native;
const CONFIG_PATH = path.join(CONNECT_DIR, 'connect.json');
const STATE_PATH = path.join(CONNECT_DIR, 'connect-state.json');
const RUNTIME_PATH = path.join(CONNECT_DIR, 'connect-runtime.json');
const MAX_LOGS = 80;

/** 所有写操作串行化，避免面板保存、后台状态更新互相覆盖。 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
	const next = writeChain.then(task, task);
	writeChain = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

async function ensureDir(): Promise<void> {
	await fs.mkdir(CONNECT_DIR, {recursive: true});
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		const parsed = JSON.parse(raw) as unknown;
		return parsed as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			log.debug('Failed to read connect json', {filePath, error});
		}
		return fallback;
	}
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await ensureDir();
	const tempPath = `${filePath}.tmp-${process.pid}`;
	await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600,
	});
	await fs.rename(tempPath, filePath);
	try {
		await fs.chmod(filePath, 0o600);
	} catch (error) {
		// Windows 不支持 POSIX 权限；忽略即可。
		log.debug('Failed to chmod connect json', {filePath, error});
	}
}

function normalizeConfig(value: Partial<ConnectConfig> | null): ConnectConfig {
	const base = createDefaultConfig(process.cwd());
	return {
		...base,
		...value,
		telegram: {
			...DEFAULT_TELEGRAM_CONFIG,
			...(value?.telegram ?? {}),
			allowedUserIds: Array.isArray(value?.telegram?.allowedUserIds)
				? value?.telegram?.allowedUserIds.map(String)
				: [],
		},
		feishu: {
			...DEFAULT_FEISHU_CONFIG,
			...(value?.feishu ?? {}),
			allowedOpenIds: Array.isArray(value?.feishu?.allowedOpenIds)
				? value?.feishu?.allowedOpenIds.map(String)
				: [],
		},
		pushMode: value?.pushMode === 'stream' ? 'stream' : 'final',
	};
}

function normalizeState(value: Partial<ConnectState> | null): ConnectState {
	const base = createDefaultState();
	const mergeChannel = (channel: ConnectChannelId): ConnectChannelState => {
		const defaults = base[channel];
		const incoming = value?.[channel];
		return {
			...defaults,
			...(incoming ?? {}),
			stats: {...defaults.stats, ...(incoming?.stats ?? {})},
		};
	};

	return {
		...base,
		...(value ?? {}),
		telegram: mergeChannel('telegram'),
		feishu: mergeChannel('feishu'),
		logs: Array.isArray(value?.logs) ? (value?.logs as ConnectLogEntry[]) : [],
	};
}

function normalizeRuntime(
	value: Partial<ConnectRuntime> | null,
): ConnectRuntime {
	const base = createDefaultRuntime();
	return {
		bindings:
			value?.bindings && typeof value.bindings === 'object'
				? value.bindings
				: base.bindings,
		telegramCursor: {
			...base.telegramCursor,
			...(value?.telegramCursor ?? {}),
		},
		feishuCursor: {
			...base.feishuCursor,
			...(value?.feishuCursor ?? {}),
		},
	};
}

export function getConnectPaths() {
	return {
		config: CONFIG_PATH,
		state: STATE_PATH,
		runtime: RUNTIME_PATH,
	};
}

export async function loadConnectConfig(): Promise<ConnectConfig> {
	const raw = await readJson<Partial<ConnectConfig> | null>(CONFIG_PATH, null);
	return normalizeConfig(raw);
}

export async function saveConnectConfig(config: ConnectConfig): Promise<void> {
	const normalized = normalizeConfig(config);
	await serialize(() => writeJson(CONFIG_PATH, normalized));
}

export async function loadConnectState(): Promise<ConnectState> {
	const raw = await readJson<Partial<ConnectState> | null>(STATE_PATH, null);
	return normalizeState(raw);
}

export async function patchConnectState(
	channel: ConnectChannelId,
	patch: ConnectChannelStatePatch,
): Promise<ConnectState> {
	return serialize(async () => {
		const current = normalizeState(
			await readJson<Partial<ConnectState> | null>(STATE_PATH, null),
		);
		const nextChannel: ConnectChannelState = {
			...current[channel],
			...patch,
			stats: {...current[channel].stats, ...(patch.stats ?? {})},
		};
		const next: ConnectState = {
			...current,
			[channel]: nextChannel,
			updatedAt: Date.now(),
		};
		await writeJson(STATE_PATH, next);
		return next;
	});
}

export async function appendConnectLog(
	channel: ConnectChannelId | 'system',
	level: ConnectLogEntry['level'],
	text: string,
): Promise<void> {
	const entry: ConnectLogEntry = {
		at: Date.now(),
		channel,
		level,
		text: String(text ?? '').slice(0, 500),
	};

	await serialize(async () => {
		const current = normalizeState(
			await readJson<Partial<ConnectState> | null>(STATE_PATH, null),
		);
		await writeJson(STATE_PATH, {
			...current,
			logs: [...current.logs, entry].slice(-MAX_LOGS),
			updatedAt: Date.now(),
		} satisfies ConnectState);
	});
}

export async function clearConnectLogs(): Promise<void> {
	await serialize(async () => {
		const current = normalizeState(
			await readJson<Partial<ConnectState> | null>(STATE_PATH, null),
		);
		await writeJson(STATE_PATH, {
			...current,
			logs: [],
			updatedAt: Date.now(),
		} satisfies ConnectState);
	});
}

export async function loadConnectRuntime(): Promise<ConnectRuntime> {
	const raw = await readJson<Partial<ConnectRuntime> | null>(
		RUNTIME_PATH,
		null,
	);
	return normalizeRuntime(raw);
}

export async function saveConnectRuntime(
	runtime: ConnectRuntime,
): Promise<void> {
	await serialize(() => writeJson(RUNTIME_PATH, normalizeRuntime(runtime)));
}

export function bindingKey(channel: ConnectChannelId, chatKey: string): string {
	return `${channel}:${chatKey}`;
}

export async function getBinding(
	channel: ConnectChannelId,
	chatKey: string,
): Promise<ConnectBinding | null> {
	const runtime = await loadConnectRuntime();
	return runtime.bindings[bindingKey(channel, chatKey)] ?? null;
}

export async function setBinding(
	channel: ConnectChannelId,
	chatKey: string,
	binding: ConnectBinding,
): Promise<void> {
	await serialize(async () => {
		const runtime = normalizeRuntime(
			await readJson<Partial<ConnectRuntime> | null>(RUNTIME_PATH, null),
		);
		runtime.bindings[bindingKey(channel, chatKey)] = {
			...binding,
			updatedAt: Date.now(),
		};
		await writeJson(RUNTIME_PATH, runtime);
	});
}

export async function removeBinding(
	channel: ConnectChannelId,
	chatKey: string,
): Promise<void> {
	await serialize(async () => {
		const runtime = normalizeRuntime(
			await readJson<Partial<ConnectRuntime> | null>(RUNTIME_PATH, null),
		);
		delete runtime.bindings[bindingKey(channel, chatKey)];
		await writeJson(RUNTIME_PATH, runtime);
	});
}

export async function updateTelegramCursor(
	offset: number,
	botId: number,
): Promise<void> {
	await serialize(async () => {
		const runtime = normalizeRuntime(
			await readJson<Partial<ConnectRuntime> | null>(RUNTIME_PATH, null),
		);
		runtime.telegramCursor = {offset, botId};
		await writeJson(RUNTIME_PATH, runtime);
	});
}

export async function updateFeishuCursor(eventId: string): Promise<void> {
	await serialize(async () => {
		const runtime = normalizeRuntime(
			await readJson<Partial<ConnectRuntime> | null>(RUNTIME_PATH, null),
		);
		runtime.feishuCursor = {eventId};
		await writeJson(RUNTIME_PATH, runtime);
	});
}

export async function getConnectSnapshot(): Promise<ConnectSnapshot> {
	const [config, state, runtime] = await Promise.all([
		loadConnectConfig(),
		loadConnectState(),
		loadConnectRuntime(),
	]);
	return {config, state, runtime};
}

/** 面板展示用：保留首尾少量字符，避免整段密钥出现在屏幕上。 */
export function maskSecret(value: string): string {
	const text = String(value ?? '');
	if (!text) {
		return '';
	}
	if (text.length <= 8) {
		return `${text.slice(0, 2)}****`;
	}
	return `${text.slice(0, 4)}****${text.slice(-4)}`;
}
