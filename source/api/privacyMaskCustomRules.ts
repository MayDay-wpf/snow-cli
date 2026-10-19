/**
 * 用户自定义脱敏规则：类型、校验、编译与匹配。
 *
 * 与 snow-app `native/src/mcp/privacy_mask/custom_rules.rs` 保持同一数据结构，
 * 正则使用 JavaScript 语法，同时兼容 Rust 写法中常见的开头内联标志
 * `(?i)` / `(?m)` / `(?s)` 与命名组 `(?P<name>...)`。
 */
import {randomUUID} from 'node:crypto';
import type {SensitiveMatch} from './privacyMask.js';

export interface PrivacyCustomRule {
	id: string;
	name: string;
	pattern: string;
	/** 遮罩的捕获组序号，0（缺省）为整段匹配 */
	group?: number;
	/** 替换文本；为空时按字符数替换为 * */
	replacement?: string;
	/** 缺省视为启用 */
	enabled?: boolean;
}

export interface CompiledCustomRule {
	regex: RegExp;
	group: number;
	matchType: string;
}

export const CUSTOM_RULES_MAX = 200;
export const CUSTOM_RULE_PATTERN_MAX_CHARS = 2000;
export const CUSTOM_RULE_NAME_MAX_CHARS = 120;
const CONFIDENCE = 0.99;

/** 星号遮罩的匹配类型；带替换文本时用前缀编码。 */
export const CUSTOM_MATCH_TYPE = 'custom';
export const CUSTOM_TEXT_PREFIX = 'custom_text:';

const LEADING_INLINE_FLAGS = /^\(\?([A-Za-z]+)\)/;
const SUPPORTED_INLINE_FLAGS = new Set(['i', 'm', 's']);

export function isCustomRuleEnabled(rule: PrivacyCustomRule): boolean {
	return rule.enabled !== false;
}

export function newCustomRuleId(): string {
	return `custom_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/** 编译规则正则；语法错误时抛出异常。 */
export function buildCustomRuleRegex(pattern: string): RegExp {
	let source = pattern;
	let flags = '';
	const leading = LEADING_INLINE_FLAGS.exec(source);
	if (leading) {
		for (const flag of leading[1]!) {
			if (!SUPPORTED_INLINE_FLAGS.has(flag)) {
				throw new Error(`unsupported inline flag "${flag}"`);
			}
			if (!flags.includes(flag)) {
				flags += flag;
			}
		}
		source = source.slice(leading[0].length);
	}
	// Rust/Python 命名组写法转换为 JavaScript 写法
	source = source.replace(/(?<!\\)\(\?P</g, '(?<');

	try {
		return new RegExp(source, `${flags}gdu`);
	} catch {
		return new RegExp(source, `${flags}gd`);
	}
}

function countCaptureGroups(regex: RegExp): number {
	const probe = new RegExp(`${regex.source}|`, regex.flags);
	return (probe.exec('')?.length ?? 1) - 1;
}

function ruleLabel(rule: PrivacyCustomRule): string {
	return rule.name?.trim() || rule.id;
}

/** 校验单条规则，返回错误信息；合法时返回 null。 */
export function validateCustomRule(rule: PrivacyCustomRule): string | null {
	const label = ruleLabel(rule);
	if (!rule.id?.trim()) {
		return `Rule "${label}": id must not be empty`;
	}
	if (!rule.name?.trim()) {
		return `Rule "${rule.id}": name is required`;
	}
	if ([...rule.name].length > CUSTOM_RULE_NAME_MAX_CHARS) {
		return `Rule "${label}": name exceeds ${CUSTOM_RULE_NAME_MAX_CHARS} characters`;
	}
	if (!rule.pattern) {
		return `Rule "${label}": pattern is required`;
	}
	if ([...rule.pattern].length > CUSTOM_RULE_PATTERN_MAX_CHARS) {
		return `Rule "${label}": pattern exceeds ${CUSTOM_RULE_PATTERN_MAX_CHARS} characters`;
	}
	const group = rule.group ?? 0;
	if (!Number.isInteger(group) || group < 0) {
		return `Rule "${label}": group must be a non-negative integer`;
	}

	let regex: RegExp;
	try {
		regex = buildCustomRuleRegex(rule.pattern);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Rule "${label}": invalid regex: ${message}`;
	}
	const captureCount = countCaptureGroups(regex);
	if (group > captureCount) {
		return `Rule "${label}": group ${group} does not exist (pattern has ${captureCount} capture group(s))`;
	}
	return null;
}

/** 校验整组规则：数量、单条合法性、id 唯一。 */
export function validateCustomRules(rules: PrivacyCustomRule[]): string | null {
	if (rules.length > CUSTOM_RULES_MAX) {
		return `At most ${CUSTOM_RULES_MAX} custom rules are allowed`;
	}
	const ids = new Set<string>();
	for (const rule of rules) {
		const error = validateCustomRule(rule);
		if (error) {
			return error;
		}
		if (ids.has(rule.id)) {
			return `Duplicate custom rule id: ${rule.id}`;
		}
		ids.add(rule.id);
	}
	return null;
}

let compiledCacheKey = '';
let compiledCache: CompiledCustomRule[] = [];

// ===== JSON 输入解析（session-command / 外部写入共用，语义与 snow-app 一致） =====

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(
	map: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = map[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new Error(`${key} must be a string`);
	}
	return value;
}

/** 解析单条规则；`base` 为已存在的规则，省略字段沿用其值，新规则默认启用。 */
export function parseCustomRuleInput(
	value: unknown,
	base?: PrivacyCustomRule,
): PrivacyCustomRule {
	if (!isPlainObject(value)) {
		throw new Error('each custom rule must be an object');
	}
	const rule: PrivacyCustomRule = base
		? {...base}
		: {id: '', name: '', pattern: '', enabled: true};

	const id = readOptionalString(value, 'id');
	if (id !== undefined) {
		rule.id = id.trim();
	}
	const name = readOptionalString(value, 'name');
	if (name !== undefined) {
		rule.name = name.trim();
	}
	const pattern = readOptionalString(value, 'pattern');
	if (pattern !== undefined) {
		rule.pattern = pattern;
	}
	const replacement = readOptionalString(value, 'replacement');
	if (replacement !== undefined) {
		if (replacement) {
			rule.replacement = replacement;
		} else {
			delete rule.replacement;
		}
	}
	if (value['group'] !== undefined && value['group'] !== null) {
		const group = value['group'];
		if (typeof group !== 'number' || !Number.isInteger(group) || group < 0) {
			throw new Error('group must be a non-negative integer');
		}
		if (group > 0) {
			rule.group = group;
		} else {
			delete rule.group;
		}
	}
	if (value['enabled'] !== undefined && value['enabled'] !== null) {
		if (typeof value['enabled'] !== 'boolean') {
			throw new Error('enabled must be a boolean');
		}
		rule.enabled = value['enabled'];
	}
	if (!rule.id) {
		rule.id = newCustomRuleId();
	}
	return rule;
}

function ruleItems(value: unknown): unknown[] {
	// 兼容 { rules: [...] } 包装
	const list =
		isPlainObject(value) && Array.isArray(value['rules'])
			? value['rules']
			: value;
	if (!Array.isArray(list)) {
		throw new Error('custom rules must be a JSON array of rule objects');
	}
	return list;
}

function assertValid(rules: PrivacyCustomRule[]): PrivacyCustomRule[] {
	const error = validateCustomRules(rules);
	if (error) {
		throw new Error(error);
	}
	return rules;
}

/** 整体替换：按 id 合并已有规则的省略字段。 */
export function replaceCustomRules(
	value: unknown,
	existing: PrivacyCustomRule[],
): PrivacyCustomRule[] {
	const rules = ruleItems(value).map(item => {
		const id = isPlainObject(item) ? item['id'] : undefined;
		const base =
			typeof id === 'string'
				? existing.find(rule => rule.id === id.trim())
				: undefined;
		return parseCustomRuleInput(item, base);
	});
	return assertValid(rules);
}

function findRuleIndex(rules: PrivacyCustomRule[], key: string): number {
	const byId = rules.findIndex(rule => rule.id === key);
	return byId >= 0 ? byId : rules.findIndex(rule => rule.name === key);
}

/** 增量写入：按 id（其次 name）命中则更新，否则新增；接受单个对象或数组。 */
export function upsertCustomRules(
	rules: PrivacyCustomRule[],
	value: unknown,
): PrivacyCustomRule[] {
	const items = Array.isArray(value) ? value : [value];
	const next = [...rules];
	for (const item of items) {
		const rawKey = isPlainObject(item)
			? typeof item['id'] === 'string'
				? item['id']
				: typeof item['name'] === 'string'
				? item['name']
				: ''
			: '';
		const key = rawKey.trim();
		const index = key ? findRuleIndex(next, key) : -1;
		if (index >= 0) {
			next[index] = parseCustomRuleInput(item, next[index]);
		} else {
			next.push(parseCustomRuleInput(item));
		}
	}
	return assertValid(next);
}

/** 按 id 或 name 删除；未知规则报错。 */
export function removeCustomRules(
	rules: PrivacyCustomRule[],
	keys: string[],
): PrivacyCustomRule[] {
	const next = [...rules];
	for (const rawKey of keys) {
		const key = rawKey.trim();
		const index = findRuleIndex(next, key);
		if (index < 0) {
			throw new Error(`Unknown custom rule: ${key}`);
		}
		next.splice(index, 1);
	}
	return next;
}

/** 只编译启用且合法的规则（非法规则静默跳过），结果按规则内容缓存。 */
export function compileCustomRules(
	rules: PrivacyCustomRule[] | undefined,
): CompiledCustomRule[] {
	if (!rules || rules.length === 0) {
		return [];
	}
	const cacheKey = JSON.stringify(rules);
	if (cacheKey === compiledCacheKey) {
		return compiledCache;
	}

	const compiled: CompiledCustomRule[] = [];
	for (const rule of rules) {
		if (!isCustomRuleEnabled(rule) || !rule.pattern) {
			continue;
		}
		try {
			const regex = buildCustomRuleRegex(rule.pattern);
			const group = rule.group ?? 0;
			if (
				!Number.isInteger(group) ||
				group < 0 ||
				group > countCaptureGroups(regex)
			) {
				continue;
			}
			compiled.push({
				regex,
				group,
				matchType: rule.replacement
					? `${CUSTOM_TEXT_PREFIX}${rule.replacement}`
					: CUSTOM_MATCH_TYPE,
			});
		} catch {
			// 非法规则跳过
		}
	}

	compiledCacheKey = cacheKey;
	compiledCache = compiled;
	return compiled;
}

export function collectCustomRuleMatches(
	text: string,
	rules: CompiledCustomRule[],
	matches: SensitiveMatch[],
): void {
	for (const rule of rules) {
		for (const match of text.matchAll(rule.regex)) {
			const span =
				rule.group === 0
					? ([match.index, match.index + match[0].length] as const)
					: match.indices?.[rule.group];
			if (span && span[1] > span[0]) {
				matches.push({
					start: span[0],
					end: span[1],
					type: rule.matchType,
					confidence: CONFIDENCE,
				});
			}
		}
	}
}

/** 自定义规则命中片段的遮罩结果；非自定义类型返回 null。 */
export function maskCustomRuleValue(
	type: string,
	value: string,
): string | null {
	if (type.startsWith(CUSTOM_TEXT_PREFIX)) {
		return type.slice(CUSTOM_TEXT_PREFIX.length);
	}
	if (type === CUSTOM_MATCH_TYPE) {
		return '*'.repeat(value.length);
	}
	return null;
}

/**
 * 仅用自定义规则遮罩文本（重叠片段合并为一段）。
 * 不依赖内置规则模块，供规则预览 / session-command 试跑使用。
 */
export function applyCustomRules(
	text: string,
	rules: CompiledCustomRule[],
): string {
	if (rules.length === 0) {
		return text;
	}
	const matches: SensitiveMatch[] = [];
	collectCustomRuleMatches(text, rules, matches);
	matches.sort((a, b) => a.start - b.start || b.end - a.end);

	const merged: SensitiveMatch[] = [];
	for (const match of matches) {
		const previous = merged.at(-1);
		if (!previous || match.start >= previous.end) {
			merged.push({...match});
		} else if (match.end > previous.end) {
			previous.end = match.end;
		}
	}

	let output = text;
	for (const match of merged.reverse()) {
		const value = output.slice(match.start, match.end);
		output = `${output.slice(0, match.start)}${
			maskCustomRuleValue(match.type, value) ?? value
		}${output.slice(match.end)}`;
	}
	return output;
}

/** 用给定规则对样例文本做脱敏预览（不含内置规则，忽略 enabled 以外的状态）。 */
export function previewCustomRules(
	text: string,
	rules: PrivacyCustomRule[],
): string {
	return applyCustomRules(text, compileCustomRules(rules));
}
