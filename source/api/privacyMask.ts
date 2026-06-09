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

const API_KEY_VALUE_PATTERNS = [
	/\bsk-[A-Za-z0-9_-]{8,}\b/g,
	/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
	/\bAIzaSy[A-Za-z0-9_-]{16,}\b/g,
	/\bsnow-[A-Za-z0-9_-]{8,}\b/g,
];

function maskSecretValue(value: string, visiblePrefixLength = 3): string {
	if (value.length <= visiblePrefixLength) {
		return '*'.repeat(value.length);
	}

	return `${value.slice(0, visiblePrefixLength)}${'*'.repeat(
		value.length - visiblePrefixLength,
	)}`;
}

function maskApiKeyLikeSecrets(text: string): string {
	let maskedText = text;

	for (const pattern of API_KEY_VALUE_PATTERNS) {
		maskedText = maskedText.replace(pattern, match => maskSecretValue(match));
	}

	return maskedText
		.replace(
			/(\b(?:API[_-]?KEY|OPENAI[_-]?API[_-]?KEY|ANTHROPIC[_-]?API[_-]?KEY|GEMINI[_-]?API[_-]?KEY|GOOGLE[_-]?API[_-]?KEY|TOKEN|SECRET|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)\b\s*(?:=|:)\s*[`'"])([^`'"]+)([`'"])/gi,
			(_match, prefix: string, secret: string, suffix: string) =>
				`${prefix}${maskSecretValue(secret)}${suffix}`,
		)
		.replace(
			/(\bBearer\s+)(?!\$\{)([A-Za-z0-9._~+/=-]{16,})\b/g,
			(_match, prefix: string, token: string) =>
				`${prefix}${maskSecretValue(token)}`,
		);
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
	if (mode === 'api' && !url) {
		return null;
	}

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
		url: mode === 'api' ? url : undefined,
		apiKey: apiKey || undefined,
		model: model || undefined,
		tools,
	};
}

export async function maskPrivacyText(
	text: string,
	config: PrivacyMaskConfig,
): Promise<string> {
	try {
		if (config.mode === 'local') {
			return maskWithBlindfoldLocalRules(text);
		}

		if (!config.url) {
			return text;
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
			body: JSON.stringify({
				text,
				aggregation_strategy: 'simple',
				mask_token: '[{label}]',
			}),
		});

		const response = await fetch(config.url, fetchOptions);
		if (!response.ok) {
			return text;
		}

		const data = (await response.json()) as PrivacyMaskResponse;
		return typeof data.masked_text === 'string' ? data.masked_text : text;
	} catch {
		return text;
	}
}

export async function maskToolResultContentIfNeeded(
	toolName: string,
	content: string,
	workingDirectory?: string,
): Promise<string> {
	if (!content) {
		return content;
	}

	const config = resolvePrivacyToolResultMaskConfig(workingDirectory);
	if (!config || !config.tools.includes(toolName)) {
		return content;
	}

	return maskPrivacyText(content, config);
}
