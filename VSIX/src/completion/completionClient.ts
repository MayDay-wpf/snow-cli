import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {GoogleGenAI} from '@google/genai';
import {
	CompletionConfig,
	CompletionProvider,
	getDefaultBaseUrl,
} from './completionConfig';
import {log} from './logger';

export interface CompletionRequest {
	prefix: string;
	suffix: string;
	languageId: string;
	fileName: string;
	signal: AbortSignal;
}

export interface CompletionResult {
	text: string;
	raw?: string;
}

const SYSTEM_INSTRUCTION = [
	'You are a code completion engine inside an IDE.',
	'You will be given two segments: <PREFIX> (code before the cursor) and <SUFFIX> (code after the cursor).',
	'Your only task: output the code that fills the gap between PREFIX and SUFFIX so the file becomes syntactically and logically correct.',
	'Hard rules:',
	'1. Output raw code only. No prose, no explanations, no markdown fences.',
	'2. Do not repeat any character of PREFIX or SUFFIX.',
	'3. Continue exactly from where PREFIX ends. The first character you emit will be appended right after PREFIX.',
	'4. Preserve the existing language, indentation and style.',
	'5. Always produce code. If the cursor is at a blank/empty spot, generate the most likely next statement(s). Never refuse and never return an empty response.',
].join('\n');

function buildUserMessage(req: CompletionRequest): string {
	return [
		`Language: ${req.languageId}`,
		`File: ${req.fileName}`,
		'',
		'<PREFIX>',
		req.prefix,
		'</PREFIX>',
		'<SUFFIX>',
		req.suffix,
		'</SUFFIX>',
		'',
		'Write the code that goes at the cursor between PREFIX and SUFFIX. Output the code only.',
	].join('\n');
}

function stripCodeFences(text: string): string {
	if (!text) return '';
	let t = text;
	// Remove leading fence ```lang
	const fenceStart = t.match(/^\s*```[a-zA-Z0-9_+-]*\s*\n/);
	if (fenceStart) {
		t = t.slice(fenceStart[0].length);
		const fenceEnd = t.lastIndexOf('```');
		if (fenceEnd !== -1) {
			t = t.slice(0, fenceEnd);
		}
	}
	return t;
}

function trimCommonPrefixWithContext(
	completion: string,
	prefix: string,
): string {
	if (!completion) return completion;
	// Model sometimes echoes the trailing part of the PREFIX. Try progressively
	// shorter tails (longer first) to find the largest overlap.
	for (const len of [400, 200, 80, 30]) {
		const tail = prefix.slice(-len);
		if (tail && completion.startsWith(tail)) {
			return completion.slice(tail.length);
		}
	}
	return completion;
}

function trimSuffixOverlap(completion: string, suffix: string): string {
	if (!completion || !suffix) return completion;
	// If model accidentally appends the SUFFIX, drop it.
	for (const len of [400, 200, 80, 30]) {
		const head = suffix.slice(0, len);
		if (head && completion.endsWith(head)) {
			return completion.slice(0, completion.length - head.length);
		}
	}
	return completion;
}

function postProcess(text: string, prefix: string, suffix = ''): string {
	let out = stripCodeFences(text);
	out = trimCommonPrefixWithContext(out, prefix);
	out = trimSuffixOverlap(out, suffix);
	return out;
}

function resolveBaseUrl(config: CompletionConfig): string {
	return config.baseUrl || getDefaultBaseUrl(config.provider);
}

function buildOpenAIClient(config: CompletionConfig): OpenAI {
	return new OpenAI({
		apiKey: config.apiKey || 'missing',
		baseURL: resolveBaseUrl(config),
		dangerouslyAllowBrowser: false,
	});
}

async function requestChat(
	config: CompletionConfig,
	req: CompletionRequest,
): Promise<CompletionResult> {
	const client = buildOpenAIClient(config);
	const response = await client.chat.completions.create(
		{
			model: config.model,
			temperature: config.temperature,
			max_tokens: config.maxTokens,
			messages: [
				{role: 'system', content: SYSTEM_INSTRUCTION},
				{role: 'user', content: buildUserMessage(req)},
			],
		},
		{signal: req.signal},
	);
	const choice = response.choices?.[0];
	const content = choice?.message?.content ?? '';
	const raw = typeof content === 'string' ? content : '';
	log(
		`[chat] finish_reason=${choice?.finish_reason ?? 'n/a'}, raw_len=${
			raw.length
		}, raw_preview=${JSON.stringify(raw.slice(0, 120))}`,
	);
	return {text: postProcess(raw, req.prefix, req.suffix), raw};
}

async function requestFim(
	config: CompletionConfig,
	req: CompletionRequest,
): Promise<CompletionResult> {
	const client = buildOpenAIClient(config);
	// OpenAI Completions API (legacy text completions) — used by DeepSeek FIM
	// (base_url ending with /beta), Mistral, etc.
	const response = await (client as any).completions.create(
		{
			model: config.model,
			prompt: req.prefix,
			suffix: req.suffix || undefined,
			max_tokens: config.maxTokens,
			temperature: config.temperature,
		},
		{signal: req.signal},
	);
	const choice = response?.choices?.[0];
	const raw: string = choice?.text ?? '';
	log(
		`[fim] finish_reason=${choice?.finish_reason ?? 'n/a'}, raw_len=${
			raw.length
		}, raw_preview=${JSON.stringify(raw.slice(0, 120))}`,
	);
	return {text: postProcess(raw, req.prefix, req.suffix), raw};
}

async function requestResponses(
	config: CompletionConfig,
	req: CompletionRequest,
): Promise<CompletionResult> {
	const client = buildOpenAIClient(config);
	const response = await client.responses.create(
		{
			model: config.model,
			max_output_tokens: config.maxTokens,
			temperature: config.temperature,
			input: [
				{
					role: 'system',
					content: [{type: 'input_text', text: SYSTEM_INSTRUCTION}],
				},
				{
					role: 'user',
					content: [{type: 'input_text', text: buildUserMessage(req)}],
				},
			],
		},
		{signal: req.signal},
	);
	let text = '';
	const anyResponse = response as any;
	if (typeof anyResponse.output_text === 'string') {
		text = anyResponse.output_text;
	} else if (Array.isArray(anyResponse.output)) {
		for (const item of anyResponse.output) {
			if (item?.type === 'message' && Array.isArray(item.content)) {
				for (const part of item.content) {
					if (typeof part?.text === 'string') text += part.text;
				}
			}
		}
	}
	return {text: postProcess(text, req.prefix, req.suffix)};
}

async function requestAnthropic(
	config: CompletionConfig,
	req: CompletionRequest,
): Promise<CompletionResult> {
	const client = new Anthropic({
		apiKey: config.apiKey || 'missing',
		baseURL: config.baseUrl || undefined,
	});
	const response = await client.messages.create(
		{
			model: config.model,
			max_tokens: config.maxTokens,
			temperature: config.temperature,
			system: SYSTEM_INSTRUCTION,
			messages: [
				{
					role: 'user',
					content: buildUserMessage(req),
				},
				{
					// Prefill: force Claude to start emitting code directly.
					role: 'assistant',
					content: '<COMPLETION>',
				},
			],
			stop_sequences: ['</COMPLETION>'],
		},
		{signal: req.signal},
	);
	let text = '';
	for (const block of response.content) {
		if ((block as any).type === 'text') {
			text += (block as any).text ?? '';
		}
	}
	// Strip the prefill tag if Claude echoes it back; also remove the closing tag.
	text = text.replace(/^<COMPLETION>/, '').replace(/<\/COMPLETION>\s*$/, '');
	log(
		`[anthropic] stop_reason=${
			(response as any).stop_reason ?? 'n/a'
		}, raw_len=${text.length}, raw_preview=${JSON.stringify(
			text.slice(0, 120),
		)}`,
	);
	return {text: postProcess(text, req.prefix, req.suffix), raw: text};
}

async function requestGemini(
	config: CompletionConfig,
	req: CompletionRequest,
): Promise<CompletionResult> {
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
	const response = await client.models.generateContent({
		model: config.model,
		contents: [
			{
				role: 'user',
				parts: [{text: buildUserMessage(req)}],
			},
		],
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			maxOutputTokens: config.maxTokens,
			temperature: config.temperature,
			abortSignal: req.signal,
		} as any,
	});
	let text = '';
	const anyResp = response as any;
	if (typeof anyResp.text === 'string') {
		text = anyResp.text;
	} else if (typeof anyResp.text === 'function') {
		try {
			text = anyResp.text();
		} catch {
			text = '';
		}
	} else if (Array.isArray(anyResp.candidates)) {
		for (const candidate of anyResp.candidates) {
			const parts = candidate?.content?.parts;
			if (Array.isArray(parts)) {
				for (const part of parts) {
					if (typeof part?.text === 'string') text += part.text;
				}
			}
		}
	}
	log(
		`[gemini] raw_len=${text.length}, raw_preview=${JSON.stringify(
			text.slice(0, 120),
		)}`,
	);
	return {text: postProcess(text, req.prefix, req.suffix), raw: text};
}

export async function requestCompletion(
	config: CompletionConfig,
	req: CompletionRequest,
): Promise<CompletionResult> {
	switch (config.provider as CompletionProvider) {
		case 'chat':
			return requestChat(config, req);
		case 'fim':
			return requestFim(config, req);
		case 'responses':
			return requestResponses(config, req);
		case 'anthropic':
			return requestAnthropic(config, req);
		case 'gemini':
			return requestGemini(config, req);
		default:
			throw new Error(`Unknown completion provider: ${config.provider}`);
	}
}
