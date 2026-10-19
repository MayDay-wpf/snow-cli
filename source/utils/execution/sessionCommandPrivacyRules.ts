/**
 * session-command: privacy-rules
 * 让 Agent / CLI / SSE 以结构化 JSON 管理隐私脱敏的自定义正则规则。
 *
 * 用法（scope 缺省为 project）：
 *   privacy-rules list   [--scope=project|global]
 *   privacy-rules test   <json: {sample, pattern?, group?, replacement?, id?|name?, rule?, withBuiltinRules?}>
 *   privacy-rules upsert [--scope=project|global] <json: rule object | rule array>
 *   privacy-rules set    [--scope=project|global] <json: rule array | {rules: [...]}>
 *   privacy-rules remove [--scope=project|global] <idOrName ...> | <json string array>
 */

import {
	readSettings,
	updateSettings,
	type SettingsScope,
} from '../config/unifiedSettings.js';
import {configEvents} from '../config/configEvents.js';
import {
	collectCustomRuleMatches,
	compileCustomRules,
	parseCustomRuleInput,
	previewCustomRules,
	removeCustomRules,
	replaceCustomRules,
	upsertCustomRules,
	validateCustomRule,
	type PrivacyCustomRule,
} from '../../api/privacyMaskCustomRules.js';
import type {SensitiveMatch} from '../../api/privacyMask.js';
import {
	failResult,
	okResult,
	type SessionCommandMeta,
	type SessionCommandResult,
} from './sessionCommandTypes.js';

export const PRIVACY_RULE_FORMAT =
	'Rule object: {id?, name, pattern, group?, replacement?, enabled?}. ' +
	'pattern is a JavaScript regex (a leading (?i)/(?m)/(?s) flag and (?P<name>...) groups are accepted); ' +
	'group masks only that capture group (default 0 = whole match); ' +
	'replacement is literal text (empty = mask every character with *); ' +
	'new rules default enabled=true; upsert matches by id, then name, and keeps omitted fields.';

const SCOPE_OPTION = /^(?:--)?scope[=:\s]\s*(project|global)\b\s*/i;

function splitScope(args?: string): {scope: SettingsScope; rest: string} {
	let rest = (args ?? '').trim();
	let scope: SettingsScope = 'project';
	const match = SCOPE_OPTION.exec(rest);
	if (match) {
		scope = match[1]!.toLowerCase() as SettingsScope;
		rest = rest.slice(match[0].length).trim();
	}
	return {scope, rest};
}

function readRules(scope: SettingsScope): PrivacyCustomRule[] | undefined {
	return readSettings(scope).privacy?.customRules;
}

function effectiveScope(): SettingsScope | null {
	if (readRules('project') !== undefined) {
		return 'project';
	}
	if (readRules('global') !== undefined) {
		return 'global';
	}
	return null;
}

function writeRules(scope: SettingsScope, rules: PrivacyCustomRule[]): void {
	updateSettings(scope, settings => {
		settings.privacy = {
			...settings.privacy,
			customRules: rules,
		};
	});
	configEvents.emitConfigChange({
		type: 'privacy',
		value: {scope, customRules: rules.length},
	});
}

function parseJson(
	meta: SessionCommandMeta,
	raw: string,
	usage: string,
): {ok: true; value: unknown} | {ok: false; result: SessionCommandResult} {
	if (!raw) {
		return {
			ok: false,
			result: failResult(meta.id, 'INVALID_ARGS', usage, meta.risk, {
				ruleFormat: PRIVACY_RULE_FORMAT,
			}),
		};
	}
	try {
		return {ok: true, value: JSON.parse(raw)};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			result: failResult(
				meta.id,
				'INVALID_ARGS',
				`Invalid JSON: ${message}. ${usage}`,
				meta.risk,
				{ruleFormat: PRIVACY_RULE_FORMAT},
			),
		};
	}
}

function handleList(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const {scope} = splitScope(args);
	const rules = readRules(scope) ?? [];
	const effective = effectiveScope();
	return okResult(
		meta.id,
		{
			scope,
			rules,
			total: rules.length,
			effectiveScope: effective,
			note: 'Project customRules (when defined) override global ones; rules are applied in both local and API privacy modes.',
			ruleFormat: PRIVACY_RULE_FORMAT,
		},
		`Privacy custom rules(${scope}): ${rules.length}`,
		meta.risk,
	);
}

function resolveTestRule(
	input: Record<string, unknown>,
): PrivacyCustomRule | string {
	if (input['rule'] !== undefined) {
		return parseCustomRuleInput(input['rule']);
	}
	if (typeof input['pattern'] === 'string') {
		const fields: Record<string, unknown> = {name: 'test', ...input};
		delete fields['sample'];
		delete fields['withBuiltinRules'];
		return parseCustomRuleInput(fields);
	}
	const key =
		typeof input['id'] === 'string'
			? input['id']
			: typeof input['name'] === 'string'
			? input['name']
			: '';
	if (!key) {
		return 'Provide pattern (inline rule), rule object, or id/name of an existing rule.';
	}
	const scope = effectiveScope();
	const existing = scope ? readRules(scope) ?? [] : [];
	const found =
		existing.find(rule => rule.id === key) ??
		existing.find(rule => rule.name === key);
	return found ?? `Unknown custom rule: ${key}`;
}

async function handleTest(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const usage =
		'Usage: privacy-rules test {"sample":"...","pattern":"...","group":0,"replacement":""} (or {"sample":"...","id":"<ruleId>"})';
	const parsed = parseJson(meta, (args ?? '').trim(), usage);
	if (!parsed.ok) {
		return parsed.result;
	}
	const input = parsed.value;
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return failResult(meta.id, 'INVALID_ARGS', usage, meta.risk);
	}
	const fields = input as Record<string, unknown>;
	const sample = fields['sample'];
	if (typeof sample !== 'string' || !sample) {
		return failResult(
			meta.id,
			'INVALID_ARGS',
			`sample must be a non-empty string. ${usage}`,
			meta.risk,
		);
	}

	let rule: PrivacyCustomRule;
	try {
		const resolved = resolveTestRule(fields);
		if (typeof resolved === 'string') {
			return failResult(meta.id, 'INVALID_ARGS', resolved, meta.risk);
		}
		rule = {...resolved, name: resolved.name || 'test', enabled: true};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return failResult(meta.id, 'INVALID_ARGS', message, meta.risk);
	}

	const validationError = validateCustomRule(rule);
	if (validationError) {
		return failResult(meta.id, 'INVALID_ARGS', validationError, meta.risk, {
			rule,
			ruleFormat: PRIVACY_RULE_FORMAT,
		});
	}

	const matches: SensitiveMatch[] = [];
	collectCustomRuleMatches(sample, compileCustomRules([rule]), matches);
	const masked = previewCustomRules(sample, [rule]);
	let withBuiltin: string | undefined;
	let withBuiltinError: string | undefined;
	if (fields['withBuiltinRules'] === true) {
		try {
			const {maskPrivacyText} = await import('../../api/privacyMask.js');
			withBuiltin = await maskPrivacyText(sample, {
				mode: 'local',
				customRules: [rule],
			});
		} catch (error) {
			withBuiltinError = error instanceof Error ? error.message : String(error);
		}
	}

	return okResult(
		meta.id,
		{
			rule,
			matched: matches.length > 0,
			matchCount: matches.length,
			matches: matches.map(match => ({
				start: match.start,
				end: match.end,
				text: sample.slice(match.start, match.end),
			})),
			masked,
			...(withBuiltin === undefined
				? {}
				: {maskedWithBuiltinRules: withBuiltin}),
			...(withBuiltinError ? {builtinRulesError: withBuiltinError} : {}),
		},
		matches.length > 0
			? `Rule matched ${matches.length} segment(s)`
			: 'Rule did not match the sample',
		meta.risk,
	);
}

function handleWrite(
	meta: SessionCommandMeta,
	action: 'upsert' | 'set' | 'remove',
	args?: string,
): SessionCommandResult {
	const {scope, rest} = splitScope(args);
	const current = readRules(scope) ?? [];

	let next: PrivacyCustomRule[];
	try {
		if (action === 'remove') {
			if (!rest) {
				return failResult(
					meta.id,
					'INVALID_ARGS',
					'Usage: privacy-rules remove [--scope=project|global] <idOrName ...> | ["idOrName", ...]',
					meta.risk,
				);
			}
			let keys: string[];
			if (rest.startsWith('[')) {
				const parsed = parseJson(meta, rest, 'Expected a JSON string array');
				if (!parsed.ok) {
					return parsed.result;
				}
				if (
					!Array.isArray(parsed.value) ||
					parsed.value.some(item => typeof item !== 'string')
				) {
					return failResult(
						meta.id,
						'INVALID_ARGS',
						'remove expects a JSON array of rule ids or names',
						meta.risk,
					);
				}
				keys = parsed.value as string[];
			} else {
				// 整段文本恰好是某条规则的 id/name（名称可含空格）时按单条处理
				const whole = current.some(
					rule => rule.id === rest || rule.name === rest,
				);
				keys = whole ? [rest] : rest.split(/\s+/).filter(Boolean);
			}
			next = removeCustomRules(current, keys);
		} else {
			const usage =
				action === 'set'
					? 'Usage: privacy-rules set [--scope=project|global] [{"name":"...","pattern":"..."}]'
					: 'Usage: privacy-rules upsert [--scope=project|global] {"name":"...","pattern":"...","group":0,"replacement":""}';
			const parsed = parseJson(meta, rest, usage);
			if (!parsed.ok) {
				return parsed.result;
			}
			next =
				action === 'set'
					? replaceCustomRules(parsed.value, current)
					: upsertCustomRules(current, parsed.value);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = message.startsWith('Unknown custom rule')
			? 'NOT_FOUND'
			: 'INVALID_ARGS';
		return failResult(meta.id, code, message, meta.risk, {
			ruleFormat: PRIVACY_RULE_FORMAT,
		});
	}

	writeRules(scope, next);
	return okResult(
		meta.id,
		{
			scope,
			rules: next,
			total: next.length,
			previousTotal: current.length,
			effectiveScope: effectiveScope(),
		},
		`Privacy custom rules(${scope}) ${action}: ${next.length} rule(s)`,
		meta.risk,
	);
}

export async function handlePrivacyRules(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	switch (meta.subcommand) {
		case 'test':
			return handleTest(meta, args);
		case 'upsert':
		case 'set':
		case 'remove':
			return handleWrite(meta, meta.subcommand, args);
		default:
			return handleList(meta, args);
	}
}
