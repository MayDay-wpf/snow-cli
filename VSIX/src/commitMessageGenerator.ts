import * as vscode from 'vscode';
import {execFile} from 'child_process';
import {existsSync, readFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

const GENERATING_CONTEXT_KEY = 'snow-cli.commitMessageGenerating';
const CONFIG_DIR = join(homedir(), '.snow');
const ACTIVE_PROFILE_FILE = join(CONFIG_DIR, 'active-profile.json');
const LEGACY_ACTIVE_PROFILE_FILE = join(CONFIG_DIR, 'active-profile.txt');
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const LEGACY_CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CUSTOM_HEADERS_FILE = join(CONFIG_DIR, 'custom-headers.json');
const MAX_DIFF_CHARS = 120_000;
const API_MAX_RETRIES = 5;
const API_RETRY_BASE_DELAY_MS = 1000;

let activeAbortController: AbortController | undefined;

interface GenerateCommitMessageOptions {
	additionalRequirements?: string;
}

type RequestMethod = 'chat' | 'responses' | 'gemini' | 'anthropic';

interface SnowApiConfig {
	baseUrl: string;
	apiKey: string;
	requestMethod: RequestMethod;
	advancedModel?: string;
	basicModel?: string;
	maxTokens?: number;
	streamIdleTimeoutSec?: number;
	customHeadersSchemeId?: string;
}

interface SnowAppConfig {
	snowcfg?: SnowApiConfig;
}

interface GitExtension {
	getAPI(version: 1): GitAPI;
}

interface GitAPI {
	repositories: GitRepository[];
}

interface GitRepository {
	rootUri: vscode.Uri;
	inputBox: {
		value: string;
	};
}

interface DiffPayload {
	diff: string;
	source: 'staged' | 'working-tree';
	truncated: boolean;
}

interface CustomHeadersConfig {
	active?: string;
	schemes?: Array<{
		id?: string;
		headers?: Record<string, string>;
	}>;
}

export function registerCommitMessageCommands(
	context: vscode.ExtensionContext,
): void {
	void vscode.commands.executeCommand(
		'setContext',
		GENERATING_CONTEXT_KEY,
		false,
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('snow-cli.generateCommitMessage', () =>
			generateCommitMessage(),
		),
		vscode.commands.registerCommand(
			'snow-cli.generateCommitMessageWithRequirements',
			generateCommitMessageWithRequirements,
		),
		vscode.commands.registerCommand(
			'snow-cli.cancelCommitMessageGeneration',
			cancelCommitMessageGeneration,
		),
	);
}

async function generateCommitMessageWithRequirements(): Promise<void> {
	if (activeAbortController) {
		cancelCommitMessageGeneration();
		return;
	}

	const additionalRequirements = await vscode.window.showInputBox({
		title: 'Snow CLI: Commit Message Requirements',
		prompt: 'Add optional requirements for the generated commit message.',
		placeHolder: 'For example: Use Chinese; follow Conventional Commits.',
		ignoreFocusOut: true,
	});

	if (additionalRequirements === undefined) {
		return;
	}

	await generateCommitMessage({
		additionalRequirements: additionalRequirements.trim() || undefined,
	});
}

async function generateCommitMessage(
	options: GenerateCommitMessageOptions = {},
): Promise<void> {
	if (activeAbortController) {
		cancelCommitMessageGeneration();
		return;
	}

	const repository = await getTargetRepository();
	if (!repository) {
		vscode.window.showWarningMessage('Snow CLI: No Git repository found.');
		return;
	}

	const abortController = new AbortController();
	activeAbortController = abortController;
	await vscode.commands.executeCommand(
		'setContext',
		GENERATING_CONTEXT_KEY,
		true,
	);

	try {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.SourceControl,
				title: 'Snow CLI: Generating commit message',
			},
			async () => {
				const payload = await collectDiffPayload(
					repository.rootUri.fsPath,
					abortController.signal,
				);

				if (!payload.diff.trim()) {
					vscode.window.showInformationMessage(
						'Snow CLI: No staged or working tree changes found.',
					);
					return;
				}

				const message = await requestCommitMessage(
					payload,
					abortController.signal,
					options.additionalRequirements,
				);
				repository.inputBox.value = normalizeCommitMessage(message);
			},
		);
	} catch (error) {
		if (isAbortError(error)) {
			vscode.window.showInformationMessage(
				'Snow CLI: Commit message generation stopped.',
			);
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(
			`Snow CLI: Failed to generate commit message. ${message}`,
		);
	} finally {
		if (activeAbortController === abortController) {
			activeAbortController = undefined;
			await vscode.commands.executeCommand(
				'setContext',
				GENERATING_CONTEXT_KEY,
				false,
			);
		}
	}
}

function cancelCommitMessageGeneration(): void {
	activeAbortController?.abort();
}

async function getTargetRepository(): Promise<GitRepository | undefined> {
	const gitExtension =
		vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!gitExtension) {
		return undefined;
	}

	const git = gitExtension.isActive
		? gitExtension.exports
		: await gitExtension.activate();
	const api = git.getAPI(1);
	const repositories = api.repositories;

	if (repositories.length === 0) {
		return undefined;
	}

	const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
	if (!activePath) {
		return repositories[0];
	}

	return (
		repositories
			.filter(repository => activePath.startsWith(repository.rootUri.fsPath))
			.sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0] ??
		repositories[0]
	);
}

async function collectDiffPayload(
	repositoryRoot: string,
	signal: AbortSignal,
): Promise<DiffPayload> {
	const stagedDiff = await execGit(
		['diff', '--cached', '--no-ext-diff'],
		repositoryRoot,
		signal,
	);

	const source: DiffPayload['source'] = stagedDiff.trim()
		? 'staged'
		: 'working-tree';
	const fullDiff = stagedDiff.trim()
		? stagedDiff
		: await execGit(['diff', '--no-ext-diff'], repositoryRoot, signal);
	const truncated = fullDiff.length > MAX_DIFF_CHARS;

	return {
		diff: truncated ? fullDiff.slice(0, MAX_DIFF_CHARS) : fullDiff,
		source,
		truncated,
	};
}

function execGit(
	args: string[],
	cwd: string,
	signal: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(createAbortError());
			return;
		}

		const child = execFile(
			'git',
			args,
			{cwd, maxBuffer: MAX_DIFF_CHARS * 4},
			(error, stdout, stderr) => {
				signal.removeEventListener('abort', abortListener);

				if (signal.aborted) {
					reject(createAbortError());
					return;
				}

				if (error) {
					reject(new Error(stderr.trim() || error.message));
					return;
				}

				resolve(stdout);
			},
		);

		const abortListener = () => {
			child.kill();
			reject(createAbortError());
		};

		signal.addEventListener('abort', abortListener, {once: true});
	});
}

async function requestCommitMessage(
	payload: DiffPayload,
	signal: AbortSignal,
	additionalRequirements?: string,
): Promise<string> {
	const config = loadActiveSnowConfig();
	const model = config.basicModel?.trim();

	if (!model) {
		throw new Error('Basic model is not configured.');
	}

	const requestMethod = config.requestMethod || 'chat';
	const messages = buildPrompt(payload, additionalRequirements);

	return withApiRetry(() => {
		switch (requestMethod) {
			case 'responses':
				return requestResponsesCommitMessage(config, model, messages, signal);
			case 'gemini':
				return requestGeminiCommitMessage(config, model, messages, signal);
			case 'anthropic':
				return requestAnthropicCommitMessage(config, model, messages, signal);
			case 'chat':
			default:
				return requestChatCommitMessage(config, model, messages, signal);
		}
	}, signal);
}

function loadActiveSnowConfig(): SnowApiConfig {
	const profileName = getActiveProfileName();
	const profilePath = join(PROFILES_DIR, `${profileName}.json`);
	const config =
		readJsonFile<SnowAppConfig>(profilePath) ??
		readJsonFile<SnowAppConfig>(LEGACY_CONFIG_FILE);
	const snowcfg = config?.snowcfg;

	if (!snowcfg) {
		throw new Error('Snow configuration not found.');
	}

	return snowcfg;
}

function getActiveProfileName(): string {
	const activeProfile = readJsonFile<{activeProfile?: string}>(
		ACTIVE_PROFILE_FILE,
	);
	if (activeProfile?.activeProfile) {
		return activeProfile.activeProfile;
	}

	if (existsSync(LEGACY_ACTIVE_PROFILE_FILE)) {
		const profileName = readFileSync(LEGACY_ACTIVE_PROFILE_FILE, 'utf8').trim();
		return profileName || 'default';
	}

	return 'default';
}

function readJsonFile<T>(filePath: string): T | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as T;
	} catch {
		return undefined;
	}
}

function buildPrompt(
	payload: DiffPayload,
	additionalRequirements?: string,
): {system: string; user: string} {
	const sourceLabel = payload.source === 'staged' ? 'staged' : 'working tree';
	const truncatedNotice = payload.truncated
		? '\n\nNote: The diff was truncated because it is large.'
		: '';
	const requirementNotice = additionalRequirements?.trim()
		? `\n\nAdditional requirements from the user:\n${additionalRequirements.trim()}`
		: '';

	return {
		system: [
			'You generate clear Git commit messages.',
			'Return only the final commit message, with no markdown, no quotes, and no explanation.',
			'Use an appropriate level of detail for the changes; include a body when it helps explain important context.',
			'Prefer Conventional Commit style when it fits, for example: feat: add login validation.',
		].join(' '),
		user: `Generate one commit message for the ${sourceLabel} changes below.${truncatedNotice}${requirementNotice}\n\n${payload.diff}`,
	};
}

async function requestChatCommitMessage(
	config: SnowApiConfig,
	model: string,
	messages: {system: string; user: string},
	signal: AbortSignal,
): Promise<string> {
	const url = `${trimTrailingSlash(config.baseUrl)}/chat/completions`;
	const response = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config),
		body: JSON.stringify({
			model,
			messages: [
				{role: 'system', content: messages.system},
				{role: 'user', content: messages.user},
			],
			stream: false,
			temperature: 0.2,
		}),
		signal,
	});
	const data = await readResponseJson(response, 'OpenAI Chat API');
	return data.choices?.[0]?.message?.content ?? '';
}

async function requestResponsesCommitMessage(
	config: SnowApiConfig,
	model: string,
	messages: {system: string; user: string},
	signal: AbortSignal,
): Promise<string> {
	const url = `${trimTrailingSlash(config.baseUrl)}/responses`;
	const response = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config),
		body: JSON.stringify({
			model,
			instructions: messages.system,
			input: [{role: 'user', content: messages.user}],
			store: false,
		}),
		signal,
	});
	const data = await readResponseJson(response, 'OpenAI Responses API');
	return extractResponsesText(data);
}

async function requestGeminiCommitMessage(
	config: SnowApiConfig,
	model: string,
	messages: {system: string; user: string},
	signal: AbortSignal,
): Promise<string> {
	const baseUrl =
		config.baseUrl && config.baseUrl !== 'https://api.openai.com/v1'
			? trimTrailingSlash(config.baseUrl)
			: 'https://generativelanguage.googleapis.com/v1beta';
	const modelName = model.startsWith('models/') ? model : `models/${model}`;
	const url = `${baseUrl}/${modelName}:generateContent`;
	const response = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config, 'gemini'),
		body: JSON.stringify({
			contents: [
				{
					role: 'user',
					parts: [{text: `${messages.system}\n\n${messages.user}`}],
				},
			],
			generationConfig: {
				temperature: 0.2,
			},
		}),
		signal,
	});
	const data = await readResponseJson(response, 'Gemini API');
	return (
		data.candidates?.[0]?.content?.parts
			?.map((part: {text?: string}) => part.text ?? '')
			.join('') ?? ''
	);
}

async function requestAnthropicCommitMessage(
	config: SnowApiConfig,
	model: string,
	messages: {system: string; user: string},
	signal: AbortSignal,
): Promise<string> {
	const baseUrl =
		config.baseUrl && config.baseUrl !== 'https://api.openai.com/v1'
			? trimTrailingSlash(config.baseUrl)
			: 'https://api.anthropic.com/v1';
	const response = await fetch(`${baseUrl}/messages`, {
		method: 'POST',
		headers: buildHeaders(config, 'anthropic'),
		body: JSON.stringify({
			model,
			max_tokens: 4096,
			temperature: 0.2,
			system: messages.system,
			messages: [{role: 'user', content: messages.user}],
		}),
		signal,
	});
	const data = await readResponseJson(response, 'Anthropic API');
	return (
		data.content
			?.map((part: {type?: string; text?: string}) =>
				part.type === 'text' ? part.text ?? '' : '',
			)
			.join('') ?? ''
	);
}

function buildHeaders(
	config: SnowApiConfig,
	provider?: 'gemini' | 'anthropic',
): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...loadCustomHeaders(config),
	};

	if (config.apiKey) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	}

	if (provider === 'gemini' && config.apiKey) {
		headers['x-goog-api-key'] = config.apiKey;
	}

	if (provider === 'anthropic' && config.apiKey) {
		headers['x-api-key'] = config.apiKey;
	}

	return headers;
}

function loadCustomHeaders(config: SnowApiConfig): Record<string, string> {
	const customHeadersConfig =
		readJsonFile<CustomHeadersConfig>(CUSTOM_HEADERS_FILE);
	const schemeId =
		config.customHeadersSchemeId === undefined
			? customHeadersConfig?.active
			: config.customHeadersSchemeId;

	if (!schemeId) {
		return {};
	}

	return (
		customHeadersConfig?.schemes?.find(scheme => scheme.id === schemeId)
			?.headers ?? {}
	);
}

async function readResponseJson(
	response: Response,
	apiName: string,
): Promise<any> {
	if (!response.ok) {
		const errorText = await response.text();
		throw new ApiRequestError(
			`${apiName} error: ${response.status} ${response.statusText} - ${errorText}`,
			response.status,
			response.statusText,
			errorText,
		);
	}

	return response.json();
}

class ApiRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly statusText: string,
		readonly responseText: string,
	) {
		super(message);
		this.name = 'ApiRequestError';
	}
}

async function withApiRetry<T>(
	fn: () => Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
		if (signal.aborted) {
			throw createAbortError();
		}

		try {
			return await fn();
		} catch (error) {
			lastError = error;

			if (isAbortError(error) || !isRetriableApiError(error)) {
				throw error;
			}

			if (attempt >= API_MAX_RETRIES) {
				throw error;
			}

			await delay(API_RETRY_BASE_DELAY_MS * Math.pow(2, attempt), signal);
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetriableApiError(error: unknown): boolean {
	if (error instanceof ApiRequestError) {
		return error.status === 429 || error.status >= 500;
	}

	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();
	return (
		message.includes('network') ||
		message.includes('econnrefused') ||
		message.includes('econnreset') ||
		message.includes('etimedout') ||
		message.includes('timeout') ||
		message.includes('rate limit') ||
		message.includes('too many requests') ||
		message.includes('service unavailable') ||
		message.includes('temporarily unavailable') ||
		message.includes('bad gateway') ||
		message.includes('gateway timeout') ||
		message.includes('internal server error')
	);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(createAbortError());
			return;
		}

		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		const abortListener = () => {
			cleanup();
			reject(createAbortError());
		};

		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', abortListener);
		};

		signal.addEventListener('abort', abortListener, {once: true});
	});
}

function extractResponsesText(data: any): string {
	if (typeof data.output_text === 'string') {
		return data.output_text;
	}

	return (
		data.output
			?.flatMap((item: any) => item.content ?? [])
			.map((content: any) => content.text ?? '')
			.join('') ?? ''
	);
}

function normalizeCommitMessage(message: string): string {
	const normalized = message
		.trim()
		.replace(/^```(?:[\w-]+)?\s*/u, '')
		.replace(/```$/u, '')
		.trim()
		.replace(/^['"]|['"]$/gu, '')
		.replace(/^commit message:\s*/iu, '')
		.trim();

	if (!normalized) {
		throw new Error('The model returned an empty commit message.');
	}

	return normalized;
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/u, '');
}

function createAbortError(): Error {
	const error = new Error('Commit message generation cancelled.');
	error.name = 'AbortError';
	return error;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}
