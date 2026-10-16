import {
	parseCanonicalPath,
	type StructuredPath,
} from '../core/canonicalPath.js';

/**
 * 强类型环境变量注册表与安全提取微内核
 *
 * 核心防御原则：
 * 1. 集中定义已知环境变量白名单，杜绝散落裸调 process.env['...']；
 * 2. 强类型安全解析：杜绝 "false" === true 的 JS 陷阱与 NaN 定时器崩溃；
 * 3. 路径输出一律经由 CanonicalPath / StructuredPath 结构化，防跨盘符污染；
 * 4. 提供测试环境安全快照与还原机制，杜绝测试间环境变量泄露。
 */

export const KNOWN_ENV_KEYS = [
	'SNOW_CONFIG_DIR',
	'SNOW_DEV_MODE',
	'SNOW_SHELL',
	'SNOW_DEBUG_HOOKS',
	'SNOW_SESSION_ID',
	'SNOW_TASK_MODE',
	'SNOW_WEBSEARCH_IDLE_CLEANUP_MS',
	'SNOW_IGNORE_NODE_OPTIONS',
	'TRELLIS_CONTEXT_ID',
	'HTTP_PROXY',
	'http_proxy',
	'HTTPS_PROXY',
	'https_proxy',
	'SSE_DAEMON_LOG_FILE',
	'SSH_AUTH_SOCK',
] as const;

export type KnownEnvKey = (typeof KNOWN_ENV_KEYS)[number];

export interface SnowEnvConfig {
	/** 沙箱或全局配置根目录（已转换为 StructuredPath 结构化对象） */
	readonly configDir?: StructuredPath;
	/** 开发者模式开关 */
	readonly isDevMode: boolean;
	/** 显式指定的终端 shell（如 'pwsh', 'bash', 'cmd'） */
	readonly shell?: string;
	/** 是否开启 Hook 注入调试 */
	readonly isDebugHooks: boolean;
	/** 外部指定的显式会话 ID */
	readonly sessionId?: string;
	/** 任务模式标识 */
	readonly taskMode?: string;
	/** 网页搜索后台进程空闲回收时间（毫秒） */
	readonly websearchIdleCleanupMs: number;
	/** 是否忽略外部 NODE_OPTIONS */
	readonly ignoreNodeOptions: boolean;
	/** Trellis 上下文 ID */
	readonly trellisContextId?: string;
	/** 统一 HTTP 代理地址 */
	readonly httpProxy?: string;
	/** 统一 HTTPS 代理地址 */
	readonly httpsProxy?: string;
	/** SSE 守护进程日志路径 */
	readonly sseDaemonLogFile?: string;
	/** SSH 认证代理套接字 */
	readonly sshAuthSock?: string;
}

/**
 * 安全解析布尔值环境变量
 * 仅 'true' / '1' / 'yes' 视为 true，'false' / '0' / 'no' / 空 / 其他非法值一律视为 false
 */
export function parseEnvBoolean(val: string | undefined, defaultValue = false): boolean {
	if (val === undefined || val === null) return defaultValue;
	const trimmed = val.trim().toLowerCase();
	if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
	if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
	return defaultValue;
}

/**
 * 安全解析正整数环境变量
 * 抵御 NaN、浮点数、负数与格式错误，异常时回退到默认值
 */
export function parseEnvInteger(
	val: string | undefined,
	defaultValue: number,
	minValue = 0,
): number {
	if (!val) return defaultValue;
	const parsed = Number.parseInt(val.trim(), 10);
	if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < minValue) {
		return defaultValue;
	}
	return parsed;
}

/**
 * 安全解析路径型环境变量，返回结构化不可变路径
 */
export function parseEnvPath(val: string | undefined): StructuredPath | undefined {
	if (!val) return undefined;
	const trimmed = val.trim();
	if (!trimmed) return undefined;
	return parseCanonicalPath(trimmed);
}

/**
 * 读取当前环境变量并构造成冻结的强类型 SnowEnvConfig 视图
 */
export function getSnowEnv(env: NodeJS.ProcessEnv = process.env): SnowEnvConfig {
	const rawConfigDir = env['SNOW_CONFIG_DIR'];
	const configDir = parseEnvPath(rawConfigDir);

	const isDevMode = parseEnvBoolean(env['SNOW_DEV_MODE'], false);
	const shell = env['SNOW_SHELL']?.trim() || undefined;
	const isDebugHooks = parseEnvBoolean(env['SNOW_DEBUG_HOOKS'], false);
	const sessionId = env['SNOW_SESSION_ID']?.trim() || undefined;
	const taskMode = env['SNOW_TASK_MODE']?.trim() || undefined;
	const websearchIdleCleanupMs = parseEnvInteger(
		env['SNOW_WEBSEARCH_IDLE_CLEANUP_MS'],
		60_000,
		1_000,
	);
	const ignoreNodeOptions = parseEnvBoolean(env['SNOW_IGNORE_NODE_OPTIONS'], false);
	const trellisContextId = env['TRELLIS_CONTEXT_ID']?.trim() || undefined;

	const httpProxy = env['HTTP_PROXY']?.trim() || env['http_proxy']?.trim() || undefined;
	const httpsProxy = env['HTTPS_PROXY']?.trim() || env['https_proxy']?.trim() || undefined;

	const sseDaemonLogFile = env['SSE_DAEMON_LOG_FILE']?.trim() || undefined;
	const sshAuthSock = env['SSH_AUTH_SOCK']?.trim() || undefined;

	return Object.freeze({
		configDir,
		isDevMode,
		shell,
		isDebugHooks,
		sessionId,
		taskMode,
		websearchIdleCleanupMs,
		ignoreNodeOptions,
		trellisContextId,
		httpProxy,
		httpsProxy,
		sseDaemonLogFile,
		sshAuthSock,
	});
}

/**
 * 沙箱测试专用的安全环境变量覆写器
 * 在回调执行完毕后 100% 恢复环境，防止跨测试套件污染
 */
export async function withEnvOverrides<T>(
	overrides: Record<string, string | undefined>,
	fn: () => Promise<T> | T,
): Promise<T> {
	const original: Record<string, string | undefined> = {};

	for (const key of Object.keys(overrides)) {
		original[key] = process.env[key];
		const newVal = overrides[key];
		if (newVal === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = newVal;
		}
	}

	try {
		return await fn();
	} finally {
		for (const key of Object.keys(overrides)) {
			const origVal = original[key];
			if (origVal === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = origVal;
			}
		}
	}
}
