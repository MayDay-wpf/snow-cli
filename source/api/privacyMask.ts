import {readSettings} from '../utils/config/unifiedSettings.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';

const DEFAULT_TOOL_RESULT_TOOLS = [
	'filesystem-read',
	'ace-search',
	'terminal-execute',
];

export interface PrivacyMaskConfig {
	url: string;
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

interface PrivacyToolResultMaskConfig extends PrivacyMaskConfig {
	enabled: true;
	tools: string[];
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

	const url = pickProjectFirst(
		projectPrivacy?.api?.url,
		globalPrivacy?.api?.url,
	)?.trim();
	if (!url) {
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
		url,
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
