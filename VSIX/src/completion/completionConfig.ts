import * as vscode from 'vscode';

export type CompletionProvider =
	| 'chat'
	| 'fim'
	| 'responses'
	| 'gemini'
	| 'anthropic';

export interface CompletionConfig {
	enabled: boolean;
	provider: CompletionProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
	maxTokens: number;
	temperature: number;
	debounceMs: number;
	contextPrefixLines: number;
	contextSuffixLines: number;
	languages: string[];
	proxy: string;
}

const SECTION = 'snow-cli';

function get<T>(key: string, fallback: T): T {
	return vscode.workspace.getConfiguration(SECTION).get<T>(key, fallback) as T;
}

export function readCompletionConfig(): CompletionConfig {
	return {
		enabled: get<boolean>('completion.enabled', false),
		provider: get<CompletionProvider>('completion.provider', 'chat'),
		baseUrl: (get<string>('completion.baseUrl', '') || '').trim(),
		apiKey: (get<string>('completion.apiKey', '') || '').trim(),
		model: (get<string>('completion.model', '') || '').trim(),
		maxTokens: get<number>('completion.maxTokens', 256),
		temperature: get<number>('completion.temperature', 0.2),
		debounceMs: get<number>('completion.debounceMs', 400),
		contextPrefixLines: get<number>('completion.contextPrefixLines', 120),
		contextSuffixLines: get<number>('completion.contextSuffixLines', 40),
		languages: get<string[]>('completion.languages', ['*']),
		proxy: (get<string>('completion.proxy', '') || '').trim(),
	};
}

export async function updateCompletionConfig<K extends keyof CompletionConfig>(
	key: K,
	value: CompletionConfig[K],
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
	const settingKey = `completion.${key}`;
	await vscode.workspace
		.getConfiguration(SECTION)
		.update(settingKey, value, target);
}

export function affectsCompletion(e: vscode.ConfigurationChangeEvent): boolean {
	return e.affectsConfiguration(`${SECTION}.completion`);
}

export function isLanguageEnabled(
	config: CompletionConfig,
	languageId: string,
): boolean {
	if (!config.languages || config.languages.length === 0) {
		return true;
	}
	if (config.languages.includes('*')) {
		return true;
	}
	return config.languages.includes(languageId);
}

export function getDefaultBaseUrl(provider: CompletionProvider): string {
	switch (provider) {
		case 'chat':
			return 'https://api.openai.com/v1';
		case 'fim':
			return 'https://api.deepseek.com/beta';
		case 'responses':
			return 'https://api.openai.com/v1';
		case 'gemini':
			return 'https://generativelanguage.googleapis.com';
		case 'anthropic':
			return 'https://api.anthropic.com';
		default:
			return '';
	}
}
