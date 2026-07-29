import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {GoogleGenAI} from '@google/genai';
import {
	type CompletionConfig,
	type CompletionProvider,
	getDefaultBaseUrl,
} from '../completion/completionConfig';
import {log} from './logger';

export type DiagnosticHint = {
	line: number; // 1-indexed
	column: number; // 1-indexed
	severity: 'error' | 'warning';
	message: string;
	source?: string; // E.g. 'ts', 'eslint'
	code?: string; // E.g. '2304'
};

export type NextEditAiRequest = {
	edit: {
		file: string;
		oldText: string;
		newText: string;
		line: number;
	};
	currentFile: {
		path: string;
		languageId: string;
		content: string;
		diagnostics: DiagnosticHint[];
	};
	workspaceFiles: Array<{
		path: string;
		content: string;
		diagnostics: DiagnosticHint[];
	}>;
	signal: AbortSignal;
};

export type NextEditAiCandidate = {
	file: string;
	oldText: string;
	newText: string;
	reason: string;
};

const SYSTEM_INSTRUCTION = [
	'You are a "Next Edit Prediction" engine inside an IDE.',
	'The user just made a small edit in their workspace (oldText -> newText).',
	'Your job: predict OTHER locations across the workspace that will need to change as a logical consequence of this edit.',
	'Typical cases: a renamed identifier, a changed function signature, an updated API contract, a parameter reorder, a renamed type, a tweaked constant, etc.',
	'',
	'Diagnostics:',
	'Each file in the prompt may include a [DIAGNOSTICS] block listing errors/warnings the IDE has detected (with line/column, source, code, and message).',
	'When diagnostics are present, PRIORITIZE predicting edits that fix them — for example: missing imports, mismatched types, undefined symbols, call sites not updated after a signature change, unused/renamed variables, etc.',
	'However, do NOT fabricate fixes just to address a diagnostic. Only return an edit when you are confident a concrete fix exists AND its oldText exists EXACTLY in the target file. If you cannot produce a precise fix, skip the diagnostic.',
	'A diagnostic block of "(none)" means the file currently has no error/warning diagnostics.',
	'',
	'Output rules (STRICT):',
	'1. Output a SINGLE JSON array, no prose, no markdown code fences, no commentary.',
	'2. Each element must be an object with exactly these string fields: "file", "oldText", "newText", "reason".',
	'   - "file": the workspace-relative or absolute path of the target file (use the path exactly as it appears in the prompt).',
	'   - "oldText": an EXACT substring currently present in that target file. Prefer a snippet that is unique enough to locate (one identifier alone is OK if it is rare in that file; otherwise include surrounding tokens).',
	'   - "newText": the replacement text. Keep it minimal — only the part that should change.',
	'   - "reason": one short sentence (<= 140 chars) explaining why this edit is needed.',
	'3. NEVER invent code that does not exist. If you are not sure a location truly needs a change, leave it out.',
	'4. Do NOT include the original edit location itself.',
	'5. If NO further edits are needed, return exactly: []',
	'6. Do NOT wrap the array in any other object. Do NOT add trailing text after the array.',
].join('\n');

function buildUserMessage(request: NextEditAiRequest): string {
	const parts: string[] = [];
	parts.push(
		'## Recent user edit',
		`File: ${request.edit.file}`,
		`Line: ${request.edit.line + 1}`,
		'Old text:',
		'```',
		request.edit.oldText,
		'```',
		'New text:',
		'```',
		request.edit.newText,
		'```',
		'',
		'## Current file (full content, line-numbered)',
		`[CURRENT FILE: ${request.currentFile.path}]`,
		`Language: ${request.currentFile.languageId}`,
		'```',
	);
	parts.push(numberLines(request.currentFile.content), '```', '[DIAGNOSTICS]');
	parts.push(formatDiagnostics(request.currentFile.diagnostics), '');
	if (request.workspaceFiles.length > 0) {
		parts.push('## Related workspace files (line-numbered)');
		for (const f of request.workspaceFiles) {
			parts.push(`[WORKSPACE FILE: ${f.path}]`, '```');
			parts.push(numberLines(f.content), '```', '[DIAGNOSTICS]');
			parts.push(formatDiagnostics(f.diagnostics), '');
		}
	} else {
		parts.push('## Related workspace files', '(none)');
	}

	parts.push(
		'',
		'Now produce the JSON array of follow-up edits, or [] if none.',
	);
	return parts.join('\n');
}

function formatDiagnostics(diags: DiagnosticHint[] | undefined): string {
	if (!diags || diags.length === 0) return '  (none)';
	const lines: string[] = [];
	for (const d of diags) {
		const tagParts: string[] = [];
		if (d.source) tagParts.push(d.source);
		if (d.code) tagParts.push(d.code);
		const tag = tagParts.length > 0 ? ` (${tagParts.join(' ')})` : '';
		lines.push(`  [${d.severity}] L${d.line}:${d.column}${tag} ${d.message}`);
	}

	return lines.join('\n');
}

function numberLines(text: string): string {
	const lines = text.split('\n');
	const width = String(lines.length).length;
	return lines
		.map((line, i) => `${String(i + 1).padStart(width, ' ')}  ${line}`)
		.join('\n');
}

function stripCodeFences(text: string): string {
	if (!text) return '';
	let t = text.trim();
	const fenceStart = /^```[\w+-]*\s*\n/.exec(t);
	if (fenceStart) {
		t = t.slice(fenceStart[0].length);
		const fenceEnd = t.lastIndexOf('```');
		if (fenceEnd !== -1) {
			t = t.slice(0, fenceEnd);
		}
	}

	return t.trim();
}

function extractJsonArray(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed.startsWith('[')) return trimmed;
	// Find the first balanced [...] block.
	const start = trimmed.indexOf('[');
	if (start === -1) return undefined;
	let depth = 0;
	for (let i = start; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (ch === '[') depth++;
		else if (ch === ']') {
			depth--;
			if (depth === 0) {
				return trimmed.slice(start, i + 1);
			}
		}
	}

	return undefined;
}

function parseCandidates(raw: string): NextEditAiCandidate[] {
	const stripped = stripCodeFences(raw);
	if (!stripped) return [];
	const tryParse = (s: string): unknown | undefined => {
		try {
			return JSON.parse(s);
		} catch {
			return undefined;
		}
	};

	let parsed = tryParse(stripped);
	if (parsed === undefined) {
		const block = extractJsonArray(stripped);
		if (block) parsed = tryParse(block);
	}

	if (!Array.isArray(parsed)) return [];
	const out: NextEditAiCandidate[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== 'object') continue;
		const object = item as Record<string, unknown>;
		const file = object.file;
		const oldText = object.oldText;
		const newText = object.newText;
		const reason = object.reason;
		if (
			typeof file !== 'string' ||
			typeof oldText !== 'string' ||
			typeof newText !== 'string'
		) {
			continue;
		}

		if (!file.trim() || !oldText) continue;
		out.push({
			file: file.trim(),
			oldText,
			newText,
			reason: typeof reason === 'string' ? reason : '',
		});
	}

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

/**
 * Next Edit needs enough tokens to emit a JSON array of structured candidates
 * (each with `oldText` + `newText` + `reason`). The shared completion config
 * defaults to 256 tokens which is fine for inline single-line completion but
 * causes the API to return an empty `content` here (especially for reasoning
 * models that burn tokens on hidden thinking). Always allow at least 2048.
 */
function nextEditMaxTokens(config: CompletionConfig): number {
	return Math.max(config.maxTokens, 2048);
}

async function requestChat(
	config: CompletionConfig,
	request: NextEditAiRequest,
): Promise<string> {
	const client = buildOpenAIClient(config);
	const response = await client.chat.completions.create(
		{
			model: config.model,
			temperature: config.temperature,
			max_tokens: nextEditMaxTokens(config),
			messages: [
				{role: 'system', content: SYSTEM_INSTRUCTION},
				{role: 'user', content: buildUserMessage(request)},
			],
		},
		{signal: request.signal},
	);
	const choice = response.choices?.[0];
	const content = choice?.message?.content ?? '';
	const finish = choice?.finish_reason ?? 'n/a';
	log(`AI next-edit [chat] finish_reason=${finish}`);
	return typeof content === 'string' ? content : '';
}

async function requestResponses(
	config: CompletionConfig,
	request: NextEditAiRequest,
): Promise<string> {
	const client = buildOpenAIClient(config);
	const response = await client.responses.create(
		{
			model: config.model,
			max_output_tokens: nextEditMaxTokens(config),
			temperature: config.temperature,
			input: [
				{
					role: 'system',
					content: [{type: 'input_text', text: SYSTEM_INSTRUCTION}],
				},
				{
					role: 'user',
					content: [{type: 'input_text', text: buildUserMessage(request)}],
				},
			],
		},
		{signal: request.signal},
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

	return text;
}

async function requestAnthropic(
	config: CompletionConfig,
	request: NextEditAiRequest,
): Promise<string> {
	const client = new Anthropic({
		apiKey: config.apiKey || 'missing',
		baseURL: config.baseUrl || undefined,
	});
	const response = await client.messages.create(
		{
			model: config.model,
			max_tokens: nextEditMaxTokens(config),
			temperature: config.temperature,
			system: SYSTEM_INSTRUCTION,
			messages: [
				{
					role: 'user',
					content: buildUserMessage(request),
				},
			],
		},
		{signal: request.signal},
	);
	let text = '';
	for (const block of response.content) {
		if ((block as any).type === 'text') {
			text += (block as any).text ?? '';
		}
	}

	const stop = (response as any).stop_reason ?? 'n/a';
	log(`AI next-edit [anthropic] stop_reason=${stop}`);
	return text;
}

async function requestGemini(
	config: CompletionConfig,
	request: NextEditAiRequest,
): Promise<string> {
	const httpOptions: Record<string, unknown> = {};
	if (config.baseUrl) {
		httpOptions.baseUrl = config.baseUrl;
	}

	const client = new GoogleGenAI({
		apiKey: config.apiKey || 'missing',
		httpOptions:
			Object.keys(httpOptions).length > 0 ? (httpOptions as any) : undefined,
	});
	const response = await client.models.generateContent({
		model: config.model,
		contents: [
			{
				role: 'user',
				parts: [{text: buildUserMessage(request)}],
			},
		],
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			maxOutputTokens: nextEditMaxTokens(config),
			temperature: config.temperature,
			abortSignal: request.signal,
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

	return text;
}

export async function requestNextEditCandidates(
	config: CompletionConfig,
	request: NextEditAiRequest,
): Promise<NextEditAiCandidate[]> {
	let raw = '';
	try {
		switch (config.provider) {
			case 'chat':
			case 'fim': {
				// Fim uses chat-mode here: a raw FIM completions endpoint cannot
				// reliably emit a structured JSON instruction following message.
				raw = await requestChat(config, request);
				break;
			}

			case 'responses': {
				raw = await requestResponses(config, request);
				break;
			}

			case 'anthropic': {
				raw = await requestAnthropic(config, request);
				break;
			}

			case 'gemini': {
				raw = await requestGemini(config, request);
				break;
			}

			default: {
				throw new Error(`Unknown completion provider: ${config.provider}`);
			}
		}
	} catch (error) {
		log(`AI next-edit request failed: ${(error as Error)?.message ?? error}`);
		return [];
	}

	log(
		`AI next-edit raw_len=${raw.length}, raw_preview=${JSON.stringify(
			raw.slice(0, 200),
		)}`,
	);
	const candidates = parseCandidates(raw);
	log(`AI next-edit parsed ${candidates.length} candidate(s)`);
	return candidates;
}
