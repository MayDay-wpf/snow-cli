import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {GoogleGenAI} from '@google/genai';
import {
	CompletionConfig,
	CompletionProvider,
	getDefaultBaseUrl,
} from './completionConfig';

export interface ModelEntry {
	id: string;
	label?: string;
	description?: string;
}

function resolveBaseUrl(config: CompletionConfig): string {
	return config.baseUrl || getDefaultBaseUrl(config.provider);
}

async function fetchOpenAIModels(
	config: CompletionConfig,
): Promise<ModelEntry[]> {
	const client = new OpenAI({
		apiKey: config.apiKey || 'missing',
		baseURL: resolveBaseUrl(config),
		dangerouslyAllowBrowser: false,
	});
	const result: ModelEntry[] = [];
	const list = await client.models.list();
	for await (const model of list) {
		const id = (model as any).id;
		if (typeof id === 'string') {
			result.push({id});
		}
	}
	return result;
}

async function fetchAnthropicModels(
	config: CompletionConfig,
): Promise<ModelEntry[]> {
	const client = new Anthropic({
		apiKey: config.apiKey || 'missing',
		baseURL: config.baseUrl || undefined,
	});
	const result: ModelEntry[] = [];
	try {
		// SDK exposes models.list() in recent versions.
		const list = await (client as any).models.list();
		const data = (list?.data ?? list) as Array<{
			id?: string;
			display_name?: string;
		}>;
		if (Array.isArray(data)) {
			for (const m of data) {
				if (m?.id) {
					result.push({id: m.id, label: m.display_name});
				}
			}
		}
	} catch {
		// Fallback: hardcoded common Anthropic models.
		const fallback = [
			'claude-opus-4-5',
			'claude-opus-4-1',
			'claude-sonnet-4-5',
			'claude-sonnet-4',
			'claude-3-7-sonnet-latest',
			'claude-3-5-sonnet-latest',
			'claude-3-5-haiku-latest',
		];
		for (const id of fallback) result.push({id});
	}
	return result;
}

async function fetchGeminiModels(
	config: CompletionConfig,
): Promise<ModelEntry[]> {
	const httpOptions: Record<string, unknown> = {};
	if (config.baseUrl) {
		httpOptions['baseUrl'] = config.baseUrl;
	}
	const client = new GoogleGenAI({
		apiKey: config.apiKey || 'missing',
		httpOptions: Object.keys(httpOptions).length
			? (httpOptions as any)
			: undefined,
	});
	const result: ModelEntry[] = [];
	try {
		const pager = await (client as any).models.list();
		// pager could be async iterable or have .page
		if (pager && typeof pager[Symbol.asyncIterator] === 'function') {
			for await (const model of pager) {
				const name: string | undefined = model?.name;
				if (typeof name === 'string') {
					const id = name.startsWith('models/')
						? name.slice('models/'.length)
						: name;
					result.push({
						id,
						label: model?.displayName,
						description: model?.description,
					});
				}
			}
		} else if (Array.isArray(pager?.page)) {
			for (const model of pager.page) {
				const name: string | undefined = model?.name;
				if (typeof name === 'string') {
					const id = name.startsWith('models/')
						? name.slice('models/'.length)
						: name;
					result.push({
						id,
						label: model?.displayName,
						description: model?.description,
					});
				}
			}
		}
	} catch (err) {
		throw err;
	}
	return result;
}

export async function fetchModelList(
	config: CompletionConfig,
): Promise<ModelEntry[]> {
	const provider = config.provider as CompletionProvider;
	if (provider === 'chat' || provider === 'fim' || provider === 'responses') {
		return fetchOpenAIModels(config);
	}
	if (provider === 'anthropic') {
		return fetchAnthropicModels(config);
	}
	if (provider === 'gemini') {
		return fetchGeminiModels(config);
	}
	throw new Error(`Unknown provider: ${config.provider}`);
}
