import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {resolveSnowConfigDir} from './apiConfig.js';

/**
 * AI 请求重试策略配置（对齐 Snow App 的 retry_policy）。
 *
 * 只决定「哪些错误可以重试」，与 API 档案中的最大重试次数（maxRetries）
 * 和重试间隔（retryDelayMs）互不干扰；作用于所有 API 档案，
 * 落盘于 ~/.snow/retry-policy.json。文件缺失或非法时回退到内置默认类别，
 * 行为与未配置时保持一致。
 */

export interface RetryCategoryDefaults {
	id: string;
	keywords: readonly string[];
}

/**
 * 内置可重试错误类别。关键词按「不区分大小写的子串」匹配错误消息；
 * 纯数字关键词（HTTP 状态码）按完整数字匹配，避免命中会话 ID 等大数字片段。
 */
export const DEFAULT_RETRY_CATEGORIES: readonly RetryCategoryDefaults[] = [
	{id: 'overloaded', keywords: ['overloaded', '529']},
	{
		id: 'network',
		keywords: [
			'network',
			'econnrefused',
			'econnreset',
			'etimedout',
			'timeout',
			'connection refused',
			'connection closed',
			'connection aborted',
			'connection reset',
			'socket hang up',
			'fetch failed',
			'dns lookup',
			'getaddrinfo',
			'enotfound',
			'ehostunreach',
			'enetunreach',
			'network is unreachable',
			'no route to host',
			'unexpected eof',
			'tls handshake',
			'proxy error',
		],
	},
	{
		id: 'rateLimit',
		keywords: ['rate limit', 'rate_limit', 'too many requests', '429'],
	},
	{
		id: 'serverError',
		keywords: [
			'500',
			'502',
			'503',
			'504',
			'520',
			'521',
			'522',
			'523',
			'524',
			'525',
			'530',
			'server_error',
			'internal server error',
			'bad gateway',
			'service unavailable',
			'gateway timeout',
		],
	},
	{id: 'unavailable', keywords: ['unavailable']},
	{id: 'terminated', keywords: ['terminated']},
	{
		id: 'stream',
		keywords: [
			'stream ended',
			'stream terminated',
			'incomplete data',
			'reader error',
		],
	},
	{id: 'idleTimeout', keywords: ['idle timeout']},
	{
		id: 'toolCallJson',
		keywords: ['invalid tool call json', 'incomplete tool call json'],
	},
];

export const IDLE_TIMEOUT_CATEGORY_ID = 'idleTimeout';

export interface RetryCategoryState {
	enabled: boolean;
	/** 逗号分隔的关键词；留空表示使用该类别的内置默认关键词 */
	keywords: string;
}

export interface RetryPolicyConfig {
	/** 开启后任何错误都会重试（仍受最大重试次数限制，取消请求除外） */
	always: boolean;
	categories: Record<string, RetryCategoryState>;
	/** 额外关键词，逗号或换行分隔 */
	customKeywords: string;
}

export interface ResolvedRetryRules {
	always: boolean;
	keywords: string[];
	/** 启用的类别 ID 集合（用于按错误类型而非文案的判定，例如流空闲超时） */
	enabledCategories: Set<string>;
}

const CONFIG_DIR = resolveSnowConfigDir();
const RETRY_POLICY_FILE = join(CONFIG_DIR, 'retry-policy.json');

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

export function getRetryPolicyFilePath(): string {
	return RETRY_POLICY_FILE;
}

export function createDefaultRetryPolicy(): RetryPolicyConfig {
	const categories: Record<string, RetryCategoryState> = {};
	for (const category of DEFAULT_RETRY_CATEGORIES) {
		categories[category.id] = {enabled: true, keywords: ''};
	}
	return {always: false, categories, customKeywords: ''};
}

function normalizePolicy(raw: unknown): RetryPolicyConfig {
	const policy = createDefaultRetryPolicy();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return policy;
	}

	const data = raw as {
		always?: unknown;
		categories?: unknown;
		customKeywords?: unknown;
	};

	policy.always = data.always === true;
	policy.customKeywords =
		typeof data.customKeywords === 'string' ? data.customKeywords : '';

	if (data.categories && typeof data.categories === 'object') {
		const savedCategories = data.categories as Record<string, unknown>;
		for (const category of DEFAULT_RETRY_CATEGORIES) {
			const saved = savedCategories[category.id];
			if (!saved || typeof saved !== 'object') {
				continue;
			}
			const entry = saved as {enabled?: unknown; keywords?: unknown};
			policy.categories[category.id] = {
				enabled: entry.enabled !== false,
				keywords: typeof entry.keywords === 'string' ? entry.keywords : '',
			};
		}
	}

	return policy;
}

/**
 * 读取重试策略。文件不存在或内容非法时返回默认策略。
 */
export function getRetryPolicyConfig(): RetryPolicyConfig {
	if (!existsSync(RETRY_POLICY_FILE)) {
		return createDefaultRetryPolicy();
	}

	try {
		const content = readFileSync(RETRY_POLICY_FILE, 'utf8');
		if (content.trim().length === 0) {
			return createDefaultRetryPolicy();
		}
		return normalizePolicy(JSON.parse(content));
	} catch {
		return createDefaultRetryPolicy();
	}
}

export function saveRetryPolicyConfig(config: RetryPolicyConfig): void {
	ensureConfigDirectory();

	try {
		const content = JSON.stringify(normalizePolicy(config), null, 2);
		writeFileSync(RETRY_POLICY_FILE, content, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save retry policy config: ${error}`);
	}
}

export function splitRetryKeywords(raw: string): string[] {
	return raw
		.split(/[,\n]/)
		.map(value => value.trim().toLowerCase())
		.filter(value => value.length > 0);
}

export function getDefaultCategoryKeywords(categoryId: string): string[] {
	const category = DEFAULT_RETRY_CATEGORIES.find(item => item.id === categoryId);
	return category ? [...category.keywords] : [];
}

/**
 * 把策略展开为可直接匹配的规则：
 * - 已禁用的类别不贡献关键词；
 * - 类别自定义关键词为空时使用内置默认关键词；
 * - customKeywords 追加在所有类别之后。
 */
export function resolveRetryRules(
	policy: RetryPolicyConfig = getRetryPolicyConfig(),
): ResolvedRetryRules {
	const keywords: string[] = [];
	const enabledCategories = new Set<string>();

	for (const category of DEFAULT_RETRY_CATEGORIES) {
		const state = policy.categories[category.id];
		if (state && !state.enabled) {
			continue;
		}
		enabledCategories.add(category.id);
		const custom = state?.keywords.trim() ?? '';
		if (custom) {
			keywords.push(...splitRetryKeywords(custom));
		} else {
			keywords.push(...category.keywords);
		}
	}

	keywords.push(...splitRetryKeywords(policy.customKeywords));

	return {always: policy.always, keywords, enabledCategories};
}

function isNumericKeyword(keyword: string): boolean {
	return /^\d+$/.test(keyword);
}

/**
 * 数字关键词按完整数字匹配：前后不得紧邻其他数字，
 * 防止 `conv-1791567107342905000` 之类的 ID 片段把 400 误判为 500。
 */
function containsNumericKeyword(message: string, keyword: string): boolean {
	let index = message.indexOf(keyword);
	while (index !== -1) {
		const before = index === 0 ? '' : message[index - 1]!;
		const afterIndex = index + keyword.length;
		const after = afterIndex >= message.length ? '' : message[afterIndex]!;
		if (!/\d/.test(before) && !/\d/.test(after)) {
			return true;
		}
		index = message.indexOf(keyword, index + 1);
	}
	return false;
}

/**
 * 错误消息是否命中重试规则中的任一关键词。
 */
export function matchesRetryKeywords(
	message: string,
	keywords: readonly string[],
): boolean {
	const normalized = message.toLowerCase();
	return keywords.some(keyword => {
		if (!keyword) return false;
		return isNumericKeyword(keyword)
			? containsNumericKeyword(normalized, keyword)
			: normalized.includes(keyword);
	});
}
