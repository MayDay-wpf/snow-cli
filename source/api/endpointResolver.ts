import type {BaseUrlMode} from '../utils/config/apiConfig.js';

export type ApiEndpointKind =
	| 'chat'
	| 'responses'
	| 'models'
	| 'anthropicMessages'
	| 'geminiStreamGenerateContent';

type ResolveApiEndpointOptions = {
	anthropicBeta?: boolean;
	modelName?: string;
};

const ENDPOINT_SUFFIXES = {
	chat: '/chat/completions',
	responses: '/responses',
	models: '/models',
	anthropicMessages: '/messages',
} as const;

export function normalizeBaseUrlValue(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '');
}

export function resolveApiEndpoint(
	baseUrl: string,
	kind: ApiEndpointKind,
	mode: BaseUrlMode = 'auto',
	options: ResolveApiEndpointOptions = {},
): string {
	const normalizedBaseUrl = normalizeBaseUrlValue(baseUrl);

	if (mode === 'endpoint') {
		return normalizedBaseUrl;
	}

	if (mode === 'auto' && isFullEndpointForKind(normalizedBaseUrl, kind)) {
		return normalizedBaseUrl;
	}

	const baseForAppend =
		mode === 'auto'
			? stripKnownEndpointSuffix(normalizedBaseUrl) || normalizedBaseUrl
			: normalizedBaseUrl;

	return appendEndpointSuffix(baseForAppend, kind, options);
}

function appendEndpointSuffix(
	baseUrl: string,
	kind: ApiEndpointKind,
	options: ResolveApiEndpointOptions,
): string {
	const normalizedBaseUrl = normalizeBaseUrlValue(baseUrl);

	if (kind === 'geminiStreamGenerateContent') {
		const modelName = normalizeGeminiModelName(options.modelName || 'model-id');
		return `${normalizedBaseUrl}/${modelName}:streamGenerateContent?alt=sse`;
	}

	if (kind === 'anthropicMessages') {
		const betaQuery = options.anthropicBeta ? '?beta=true' : '';
		return `${normalizedBaseUrl}${ENDPOINT_SUFFIXES.anthropicMessages}${betaQuery}`;
	}

	return `${normalizedBaseUrl}${ENDPOINT_SUFFIXES[kind]}`;
}

function normalizeGeminiModelName(modelName: string): string {
	const trimmed = modelName.trim() || 'model-id';
	return trimmed.startsWith('models/') ? trimmed : `models/${trimmed}`;
}

function isFullEndpointForKind(baseUrl: string, kind: ApiEndpointKind): boolean {
	const pathname = getNormalizedPathname(baseUrl);

	if (!pathname) {
		return false;
	}

	if (kind === 'geminiStreamGenerateContent') {
		return pathname.endsWith(':streamGenerateContent');
	}

	return pathname.endsWith(ENDPOINT_SUFFIXES[kind]);
}

function stripKnownEndpointSuffix(baseUrl: string): string | undefined {
	try {
		const url = new URL(baseUrl);
		const pathname = normalizePathname(url.pathname);
		const knownSuffix = getKnownEndpointSuffix(pathname);

		if (!knownSuffix) {
			return undefined;
		}

		const nextPathname = pathname.slice(0, -knownSuffix.length) || '/';
		url.pathname = nextPathname;
		url.search = '';
		url.hash = '';

		return normalizeBaseUrlValue(url.toString());
	} catch {
		return undefined;
	}
}

function getKnownEndpointSuffix(pathname: string): string | undefined {
	if (pathname.endsWith(ENDPOINT_SUFFIXES.chat)) {
		return ENDPOINT_SUFFIXES.chat;
	}

	if (pathname.endsWith(ENDPOINT_SUFFIXES.responses)) {
		return ENDPOINT_SUFFIXES.responses;
	}

	if (pathname.endsWith(ENDPOINT_SUFFIXES.anthropicMessages)) {
		return ENDPOINT_SUFFIXES.anthropicMessages;
	}

	if (pathname.endsWith(ENDPOINT_SUFFIXES.models)) {
		return ENDPOINT_SUFFIXES.models;
	}

	const geminiEndpointMatch = pathname.match(/\/models\/[^/]+:streamGenerateContent$/);
	return geminiEndpointMatch?.[0];
}

function getNormalizedPathname(baseUrl: string): string | undefined {
	try {
		return normalizePathname(new URL(baseUrl).pathname);
	} catch {
		return undefined;
	}
}

function normalizePathname(pathname: string): string {
	return pathname.replace(/\/+$/, '') || '/';
}
