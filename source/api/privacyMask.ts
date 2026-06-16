import {Blindfold, EntityType} from '@blindfold/sdk';
import {readSettings} from '../utils/config/unifiedSettings.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';

const DEFAULT_TOOL_RESULT_TOOLS = [
	'filesystem-read',
	'ace-search',
	'terminal-execute',
];

const BLINDFOLD_LOCAL_ENTITIES = [
	'person',
	'china_id',
	'mobile_cn',
	'email',
	'ip',
	'api_key',
	EntityType.EMAIL_ADDRESS,
	EntityType.PHONE_NUMBER,
	EntityType.IP_ADDRESS,
	EntityType.URL,
	EntityType.CREDIT_CARD,
	EntityType.CVV,
	EntityType.IBAN,
	EntityType.MAC_ADDRESS,
	EntityType.DATE_OF_BIRTH,
	EntityType.SSN,
	EntityType.TAX_ID,
] as string[];

export type PrivacyMaskMode = 'api' | 'local';

export interface PrivacyMaskConfig {
	mode: PrivacyMaskMode;
	url?: string;
	apiKey?: string;
	model?: string;
}

interface PrivacyMaskResponse {
	model?: string;
	masked_text?: string;
	entities?: Array<{
		label?: string;
		score?: number;
		text?: string;
		start?: number | null;
		end?: number | null;
	}>;
}

interface BlindfoldMaskResponse {
	text?: string;
	output?: string;
}

interface PrivacyToolResultMaskConfig extends PrivacyMaskConfig {
	enabled: true;
	tools: string[];
}

let localBlindfold: Blindfold | null = null;

function getLocalBlindfold(): Blindfold {
	if (!localBlindfold) {
		try {
			localBlindfold = new Blindfold({mode: 'local'});
		} catch {
			localBlindfold = Object.assign(Object.create(Blindfold.prototype), {
				mode: 'local',
				locales: undefined,
				policies: {},
				maxRetries: 2,
				retryDelay: 0.5,
			}) as Blindfold;
		}
	}

	return localBlindfold;
}

interface SensitiveMatch {
	start: number;
	end: number;
	type: string;
	confidence: number;
}

const DIRECT_SECRET_VALUE_PATTERNS: Array<{
	type: string;
	pattern: RegExp;
	confidence: number;
}> = [
	{
		type: 'private_key_block',
		pattern:
			/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
		confidence: 1,
	},
	{
		type: 'jwt',
		pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
		confidence: 0.95,
	},
	{type: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g, confidence: 0.95},
	{type: 'api_key', pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, confidence: 0.95},
	{
		type: 'api_key',
		pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
		confidence: 0.95,
	},
	{
		type: 'api_key',
		pattern: /\bgh[opsru]_[A-Za-z0-9]{20,}\b/g,
		confidence: 0.95,
	},
	{
		type: 'api_key',
		pattern: /\bxox[abprs]-[A-Za-z0-9-]{12,}\b/g,
		confidence: 0.95,
	},
	{
		type: 'api_key',
		pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
		confidence: 0.95,
	},
	{type: 'api_key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, confidence: 0.9},
	{type: 'api_key', pattern: /\bsnow-[A-Za-z0-9_-]{12,}\b/g, confidence: 0.95},
];

const SENSITIVE_KEY_NAME_PATTERN =
	'(?:api[_-]?key|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|gemini[_-]?api[_-]?key|google[_-]?api[_-]?key|x-api-key|x-api-token|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|client[_-]?secret|password|passwd|pwd|authorization|cookie|session[_-]?(?:id|token|key)?|access[_-]?key|secret[_-]?key|private[_-]?key|webhook[_-]?secret|signing[_-]?secret)';
const CONTEXT_SECRET_KEY_PATTERN =
	'[\'"]?(' + SENSITIVE_KEY_NAME_PATTERN + ')[\'"]?';

const QUOTED_CONTEXT_SECRET_PATTERN = new RegExp(
	CONTEXT_SECRET_KEY_PATTERN + '\\s*(?:=|:)\\s*([`\'"])([^`\'"\\r\\n]+)\\2',
	'gi',
);
const UNQUOTED_CONTEXT_SECRET_PATTERN = new RegExp(
	CONTEXT_SECRET_KEY_PATTERN + '\\s*(?:=|:)\\s*(?![`\'"])([^\\s,;#}\\]]+)',
	'gi',
);
const CLI_OPTION_SECRET_PATTERN =
	/(\B--(?:api-key|token|access-token|refresh-token|client-secret|secret|password)\s+)([`'"]?)([^`'"\s]+)\2/gi;
const AUTHORIZATION_SECRET_PATTERN =
	/(\b(?:Bearer|Basic)\s+)(?!\$\{)([A-Za-z0-9._~+/=-]{12,})\b/gi;
const URL_QUERY_SECRET_PATTERN =
	/([?&](api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|signature|x-amz-signature|sig)=)([^&#\s]+)/gi;
const CHINA_ID_PATTERN =
	/\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX]\b/gi;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

function maskSecretValue(
	value: string,
	visiblePrefixLength = 3,
	visibleSuffixLength = 0,
): string {
	const visibleLength = visiblePrefixLength + visibleSuffixLength;
	if (value.length <= visibleLength) {
		return '*'.repeat(value.length);
	}

	return `${value.slice(0, visiblePrefixLength)}${'*'.repeat(
		value.length - visibleLength,
	)}${visibleSuffixLength > 0 ? value.slice(-visibleSuffixLength) : ''}`;
}

function isPlaceholderSecret(value: string): boolean {
	const normalized = value.trim();
	return (
		!normalized ||
		/^(?:undefined|null|true|false)$/i.test(normalized) ||
		/^\*+$/.test(normalized) ||
		/^\[(?:redacted|masked|hidden|secret)[^\]]*\]$/i.test(normalized) ||
		/^\$\{[^}]+\}$/.test(normalized)
	);
}

function isStrongSensitiveKey(keyName: string): boolean {
	return /(?:password|passwd|pwd|token|secret|private|authorization|cookie|api[_-]?key|access[_-]?key|x-api-key|x-api-token)/i.test(
		keyName,
	);
}

function shouldMaskContextValue(value: string, keyName: string): boolean {
	const normalized = value.trim();
	if (isPlaceholderSecret(normalized)) {
		return false;
	}

	if (isStrongSensitiveKey(keyName)) {
		return true;
	}

	if (/^\d+$/.test(normalized) && normalized.length < 12) {
		return false;
	}

	return normalized.length >= 8;
}

function addSensitiveMatch(
	matches: SensitiveMatch[],
	start: number,
	end: number,
	type: string,
	confidence: number,
): void {
	if (start >= 0 && end > start) {
		matches.push({start, end, type, confidence});
	}
}

function addRegexMatches(
	text: string,
	matches: SensitiveMatch[],
	pattern: RegExp,
	type: string,
	confidence: number,
	valueGroupIndex = 0,
): void {
	pattern.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		const value = match[valueGroupIndex];
		if (!value || isPlaceholderSecret(value)) {
			continue;
		}

		const valueOffset = valueGroupIndex === 0 ? 0 : match[0].lastIndexOf(value);
		addSensitiveMatch(
			matches,
			match.index + valueOffset,
			match.index + valueOffset + value.length,
			type,
			confidence,
		);
	}
}

function collectContextSecretMatches(
	text: string,
	matches: SensitiveMatch[],
	pattern: RegExp,
	valueGroupIndex: number,
	keyGroupIndex: number,
	type: string,
	confidence: number,
): void {
	pattern.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		const keyName = match[keyGroupIndex] ?? '';
		const value = match[valueGroupIndex];
		if (!value || !shouldMaskContextValue(value, keyName)) {
			continue;
		}

		const valueOffset = match[0].lastIndexOf(value);
		addSensitiveMatch(
			matches,
			match.index + valueOffset,
			match.index + valueOffset + value.length,
			type,
			confidence,
		);
	}
}

function isValidChineseId(value: string): boolean {
	const normalized = value.toUpperCase();
	const year = Number(normalized.slice(6, 10));
	const month = Number(normalized.slice(10, 12));
	const day = Number(normalized.slice(12, 14));
	const birthDate = new Date(Date.UTC(year, month - 1, day));
	if (
		birthDate.getUTCFullYear() !== year ||
		birthDate.getUTCMonth() !== month - 1 ||
		birthDate.getUTCDate() !== day
	) {
		return false;
	}

	const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
	const checksums = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
	const sum = weights.reduce(
		(total, weight, index) => total + Number(normalized[index]) * weight,
		0,
	);
	return checksums[sum % 11] === normalized[17];
}

function isValidPaymentCard(value: string): boolean {
	const digits = value.replace(/\D/g, '');
	if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) {
		return false;
	}

	let sum = 0;
	let shouldDouble = false;
	for (let index = digits.length - 1; index >= 0; index--) {
		let digit = Number(digits[index]);
		if (shouldDouble) {
			digit *= 2;
			if (digit > 9) {
				digit -= 9;
			}
		}

		sum += digit;
		shouldDouble = !shouldDouble;
	}

	return sum % 10 === 0;
}

function collectValidatedMatches(
	text: string,
	matches: SensitiveMatch[],
): void {
	CHINA_ID_PATTERN.lastIndex = 0;
	let chinaIdMatch: RegExpExecArray | null;
	while ((chinaIdMatch = CHINA_ID_PATTERN.exec(text)) !== null) {
		const value = chinaIdMatch[0];
		if (isValidChineseId(value)) {
			addSensitiveMatch(
				matches,
				chinaIdMatch.index,
				chinaIdMatch.index + value.length,
				'china_id',
				0.95,
			);
		}
	}

	PAYMENT_CARD_PATTERN.lastIndex = 0;
	let cardMatch: RegExpExecArray | null;
	while ((cardMatch = PAYMENT_CARD_PATTERN.exec(text)) !== null) {
		const value = cardMatch[0];
		if (isValidPaymentCard(value)) {
			addSensitiveMatch(
				matches,
				cardMatch.index,
				cardMatch.index + value.length,
				'payment_card',
				0.9,
			);
		}
	}
}

function collectLocalSensitiveMatches(text: string): SensitiveMatch[] {
	const matches: SensitiveMatch[] = [];

	for (const {type, pattern, confidence} of DIRECT_SECRET_VALUE_PATTERNS) {
		addRegexMatches(text, matches, pattern, type, confidence);
	}

	collectContextSecretMatches(
		text,
		matches,
		QUOTED_CONTEXT_SECRET_PATTERN,
		3,
		1,
		'context_secret',
		0.9,
	);
	collectContextSecretMatches(
		text,
		matches,
		UNQUOTED_CONTEXT_SECRET_PATTERN,
		2,
		1,
		'context_secret',
		0.85,
	);
	addRegexMatches(
		text,
		matches,
		CLI_OPTION_SECRET_PATTERN,
		'context_secret',
		0.85,
		3,
	);
	addRegexMatches(
		text,
		matches,
		AUTHORIZATION_SECRET_PATTERN,
		'authorization',
		0.95,
		2,
	);
	addRegexMatches(
		text,
		matches,
		URL_QUERY_SECRET_PATTERN,
		'url_query_secret',
		0.85,
		3,
	);
	collectValidatedMatches(text, matches);

	return matches;
}

function mergeSensitiveMatches(matches: SensitiveMatch[]): SensitiveMatch[] {
	const sortedMatches = [...matches]
		.filter(match => match.end > match.start)
		.sort(
			(a, b) =>
				a.start - b.start || b.end - a.end || b.confidence - a.confidence,
		);
	const mergedMatches: SensitiveMatch[] = [];

	for (const match of sortedMatches) {
		const previousMatch = mergedMatches.at(-1);
		if (!previousMatch || match.start >= previousMatch.end) {
			mergedMatches.push({...match});
			continue;
		}

		const matchLength = match.end - match.start;
		const previousLength = previousMatch.end - previousMatch.start;
		if (
			match.end > previousMatch.end &&
			match.confidence >= previousMatch.confidence - 0.1
		) {
			previousMatch.end = match.end;
		}

		if (
			matchLength > previousLength &&
			match.confidence > previousMatch.confidence
		) {
			previousMatch.start = match.start;
			previousMatch.end = match.end;
			previousMatch.type = match.type;
			previousMatch.confidence = match.confidence;
		}
	}

	return mergedMatches;
}

function maskPaymentCard(value: string): string {
	const digitCount = value.replace(/\D/g, '').length;
	let digitIndex = 0;
	return value.replace(/\d/g, digit => {
		digitIndex++;
		return digitIndex <= digitCount - 4 ? '*' : digit;
	});
}

function maskSensitiveValueByType(type: string, value: string): string {
	if (type === 'private_key_block') {
		const lines = value.split(/\r?\n/);
		if (lines.length >= 2) {
			return `${lines[0]}\n[REDACTED PRIVATE KEY]\n${lines.at(-1)}`;
		}

		return '[REDACTED PRIVATE KEY]';
	}

	if (type === 'payment_card') {
		return maskPaymentCard(value);
	}

	if (type === 'china_id') {
		return `${value.slice(0, 6)}${'*'.repeat(value.length - 10)}${value.slice(
			-4,
		)}`;
	}

	if (type === 'jwt') {
		return maskSecretValue(value, 6, 4);
	}

	return maskSecretValue(value);
}

function applySensitiveMatches(
	text: string,
	matches: SensitiveMatch[],
): string {
	let maskedText = text;
	for (const match of mergeSensitiveMatches(matches).reverse()) {
		const value = maskedText.slice(match.start, match.end);
		maskedText = `${maskedText.slice(0, match.start)}${maskSensitiveValueByType(
			match.type,
			value,
		)}${maskedText.slice(match.end)}`;
	}

	return maskedText;
}

function maskApiKeyLikeSecrets(text: string): string {
	return applySensitiveMatches(text, collectLocalSensitiveMatches(text));
}

async function maskWithBlindfoldLocalRules(text: string): Promise<string> {
	const client = getLocalBlindfold();
	const result = (await client.mask(text, {
		entities: BLINDFOLD_LOCAL_ENTITIES,
		masking_char: '*',
	})) as BlindfoldMaskResponse;

	const maskedText =
		typeof result.output === 'string'
			? result.output
			: typeof result.text === 'string'
			? result.text
			: text;

	return maskApiKeyLikeSecrets(maskedText);
}

async function maskWithLocalFallback(text: string): Promise<string> {
	try {
		return await maskWithBlindfoldLocalRules(text);
	} catch {
		return maskApiKeyLikeSecrets(text);
	}
}

function pickProjectFirst<T>(
	projectValue: T | undefined,
	globalValue: T | undefined,
): T | undefined {
	return projectValue !== undefined ? projectValue : globalValue;
}

function resolvePrivacyToolResultMaskConfig(
	workingDirectory?: string,
): PrivacyToolResultMaskConfig | null {
	const globalSettings = readSettings('global');
	const projectSettings = readSettings('project', workingDirectory);
	const globalPrivacy = globalSettings.privacy;
	const projectPrivacy = projectSettings.privacy;

	const enabled = pickProjectFirst(
		projectPrivacy?.enabled,
		globalPrivacy?.enabled,
	);
	if (enabled !== true) {
		return null;
	}

	const mode =
		pickProjectFirst(projectPrivacy?.mode, globalPrivacy?.mode) ?? 'api';
	const url = pickProjectFirst(
		projectPrivacy?.api?.url,
		globalPrivacy?.api?.url,
	)?.trim();

	const apiKey = pickProjectFirst(
		projectPrivacy?.api?.apiKey,
		globalPrivacy?.api?.apiKey,
	)?.trim();
	const model = pickProjectFirst(
		projectPrivacy?.api?.model,
		globalPrivacy?.api?.model,
	)?.trim();
	const tools =
		pickProjectFirst(
			projectPrivacy?.toolResults?.tools,
			globalPrivacy?.toolResults?.tools,
		) ?? DEFAULT_TOOL_RESULT_TOOLS;

	return {
		enabled: true,
		mode,
		url: mode === 'api' ? url || undefined : undefined,
		apiKey: apiKey || undefined,
		model: model || undefined,
		tools,
	};
}

export async function maskPrivacyText(
	text: string,
	config: PrivacyMaskConfig,
	abortSignal?: AbortSignal,
): Promise<string> {
	if (abortSignal?.aborted) {
		return text;
	}

	try {
		if (config.mode === 'local') {
			return maskWithLocalFallback(text);
		}

		if (!config.url) {
			return maskWithLocalFallback(text);
		}

		const headers: Record<string, string> = {
			accept: '*/*',
			'Content-Type': 'application/json',
		};
		const apiKey = config.apiKey?.trim();
		if (apiKey) {
			headers['x-api-key'] = apiKey;
			headers['Authorization'] = `Bearer ${apiKey}`;
		}

		const fetchOptions = addProxyToFetchOptions(config.url, {
			method: 'POST',
			headers,
			signal: abortSignal,
			body: JSON.stringify({
				text,
				aggregation_strategy: 'simple',
				mask_token: '[{label}]',
			}),
		});

		const response = await fetch(config.url, fetchOptions);
		if (abortSignal?.aborted) {
			return text;
		}

		if (!response.ok) {
			return maskWithLocalFallback(text);
		}

		const data = (await response.json()) as PrivacyMaskResponse;
		if (abortSignal?.aborted) {
			return text;
		}

		const maskedText =
			typeof data.masked_text === 'string' ? data.masked_text : text;

		return maskWithLocalFallback(maskedText);
	} catch (error) {
		const errorName = error instanceof Error ? error.name : undefined;
		if (abortSignal?.aborted || errorName === 'AbortError') {
			return text;
		}

		return maskWithLocalFallback(text);
	}
}

export async function maskToolResultContentIfNeeded(
	toolName: string,
	content: string,
	workingDirectory?: string,
	abortSignal?: AbortSignal,
): Promise<string> {
	if (!content || abortSignal?.aborted) {
		return content;
	}

	const config = resolvePrivacyToolResultMaskConfig(workingDirectory);
	if (!config || !config.tools.includes(toolName)) {
		return content;
	}

	return maskPrivacyText(content, config, abortSignal);
}
