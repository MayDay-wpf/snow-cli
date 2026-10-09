/**
 * 四种 OAuth 登录方式的具体流程实现（授权链接、code 换 token、token 刷新、账号信息、模型列表）。
 *
 * 逻辑与 Snow App（native/src/api/oauth/*.rs）保持一致。
 */

import {addProxyToFetchOptions} from '../core/proxyUtils.js';
import {
	ANTHROPIC_OAUTH_BETA,
	ANTHROPIC_TOKEN_USER_AGENT,
	ANTHROPIC_VERSION_HEADER,
	ANTIGRAVITY_API_CLIENT,
	ANTIGRAVITY_CODE_ASSIST_HOSTS,
	ANTIGRAVITY_PREFERRED_MODELS,
	ANTIGRAVITY_USERINFO_URL,
	CHATGPT_AGENT_NAME_HINT,
	CHATGPT_PLAN_SCOPE,
	CHATGPT_RESOURCE,
	codexUserAgent,
	CODEX_CLIENT_VERSION,
	CODEX_ORIGINATOR,
	antigravityUserAgent,
	OAUTH_PROVIDERS,
} from './constants.js';
import type {
	OAuthClaims,
	OAuthPkceCodes,
	OAuthProfileMetadata,
	OAuthProviderId,
	OAuthTokenSet,
} from './types.js';
import {
	decodeJwtPayload,
	fetchWithTimeout,
	jwtExpiry,
	nowEpochSecs,
	readNumber,
	readString,
} from './utils.js';

const HTTP_TIMEOUT_SECS = 30;

function providerDef(provider: OAuthProviderId) {
	return OAUTH_PROVIDERS[provider];
}

async function fetchWithProxy(
	url: string,
	options: RequestInit,
): Promise<Response> {
	return fetchWithTimeout(
		url,
		addProxyToFetchOptions(url, options),
		HTTP_TIMEOUT_SECS,
	);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	try {
		const parsed = JSON.parse(text);
		return parsed && typeof parsed === 'object'
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function requireOk(
	response: Response,
	body: Record<string, unknown>,
	action: string,
): void {
	if (!response.ok) {
		const text = JSON.stringify(body).slice(0, 500);
		throw new Error(`${action} failed: ${response.status} ${text}`);
	}
}

function toFormBody(params: Record<string, string>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		search.append(key, value);
	}
	return search.toString();
}

// ---------------------------------------------------------------------------
// 授权链接
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(
	provider: OAuthProviderId,
	redirectUri: string,
	pkce: OAuthPkceCodes,
	state: string,
	nonce: string = '',
	hostId: string = '',
): string {
	const def = providerDef(provider);
	const url = new URL(def.authorizeUrl);
	const query = url.searchParams;

	if (provider === 'codex') {
		query.append('client_id', def.clientId);
		query.append('response_type', 'code');
		query.append('redirect_uri', redirectUri);
		query.append('scope', def.scope);
		query.append('state', state);
		query.append('code_challenge', pkce.challenge);
		query.append('code_challenge_method', 'S256');
		query.append('prompt', 'login');
		query.append('id_token_add_organizations', 'true');
		query.append('codex_cli_simplified_flow', 'true');
		query.append('originator', CODEX_ORIGINATOR);
		return url.toString();
	}

	if (provider === 'chatgpt') {
		query.append('client_id', def.clientId);
		query.append('response_type', 'code');
		query.append('redirect_uri', redirectUri);
		query.append('scope', def.scope);
		query.append('resource', CHATGPT_RESOURCE);
		query.append('state', state);
		query.append('nonce', nonce);
		query.append('code_challenge', pkce.challenge);
		query.append('code_challenge_method', 'S256');
		query.append('agent_name_hint', CHATGPT_AGENT_NAME_HINT);
		query.append('ext_agent_host_id', hostId);
		return url.toString();
	}

	if (provider === 'anthropic') {
		query.append('code', 'true');
		query.append('client_id', def.clientId);
		query.append('response_type', 'code');
		query.append('redirect_uri', redirectUri);
		query.append('scope', def.scope);
		query.append('code_challenge', pkce.challenge);
		query.append('code_challenge_method', 'S256');
		query.append('state', state);
		return url.toString();
	}

	if (provider === 'antigravity') {
		query.append('client_id', def.clientId);
		query.append('response_type', 'code');
		query.append('redirect_uri', redirectUri);
		query.append('scope', def.scope);
		query.append('code_challenge', pkce.challenge);
		query.append('code_challenge_method', 'S256');
		query.append('state', state);
		query.append('access_type', 'offline');
		query.append('prompt', 'consent');
		return url.toString();
	}

	// xai
	query.append('client_id', def.clientId);
	query.append('response_type', 'code');
	query.append('redirect_uri', redirectUri);
	query.append('scope', def.scope);
	query.append('code_challenge', pkce.challenge);
	query.append('code_challenge_method', 'S256');
	query.append('state', state);
	return url.toString();
}

// ---------------------------------------------------------------------------
// Codex（ChatGPT）
// ---------------------------------------------------------------------------

function parseCodexTokenResponse(body: Record<string, unknown>): OAuthTokenSet {
	const accessToken = readString(body, 'access_token');
	if (!accessToken) {
		throw new Error('Token response did not include an access token');
	}
	const expiresIn = readNumber(body, 'expires_in') ?? 3600;
	const expiresAt = jwtExpiry(accessToken) ?? nowEpochSecs() + expiresIn;
	return {
		accessToken,
		refreshToken: readString(body, 'refresh_token'),
		idToken: readString(body, 'id_token'),
		email: '',
		planType: '',
		projectId: '',
		clientId: '',
		expiresAt,
	};
}

async function codexExchangeCode(
	code: string,
	redirectUri: string,
	codeVerifier: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('codex');
	const response = await fetchWithProxy(def.tokenUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: toFormBody({
			grant_type: 'authorization_code',
			client_id: def.clientId,
			code,
			redirect_uri: redirectUri,
			code_verifier: codeVerifier,
		}),
	});
	const body = await readJson(response);
	requireOk(response, body, 'Token exchange');
	return parseCodexTokenResponse(body);
}

async function codexRefreshTokens(
	refreshToken: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('codex');
	const response = await fetchWithProxy(def.tokenUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: toFormBody({
			client_id: def.clientId,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			scope: def.refreshScope,
		}),
	});
	const body = await readJson(response);
	requireOk(response, body, 'Token refresh');
	return parseCodexTokenResponse(body);
}

function codexParseClaims(idToken: string): OAuthClaims {
	const payload = decodeJwtPayload(idToken);
	if (!payload) {
		return {email: '', accountId: '', planType: ''};
	}
	const profile = payload['https://api.openai.com/profile'];
	const email =
		readString(payload, 'email') ||
		readString(
			profile && typeof profile === 'object'
				? (profile as Record<string, unknown>)
				: null,
			'email',
		);
	const auth = payload['https://api.openai.com/auth'];
	const authRecord =
		auth && typeof auth === 'object' ? (auth as Record<string, unknown>) : null;
	return {
		email,
		accountId: readString(authRecord, 'chatgpt_account_id'),
		planType: readString(authRecord, 'chatgpt_plan_type'),
	};
}

async function codexFetchModels(
	accessToken: string,
	accountId: string,
): Promise<string[]> {
	const def = providerDef('codex');
	const base = def.backendBaseUrl.replace(/\/+$/, '');
	const url = `${base}/models?client_version=${CODEX_CLIENT_VERSION}`;
	const headers: Record<string, string> = {
		Accept: 'application/json',
		Authorization: `Bearer ${accessToken}`,
		originator: CODEX_ORIGINATOR,
		'User-Agent': codexUserAgent(),
	};
	if (accountId.trim()) {
		headers['chatgpt-account-id'] = accountId.trim();
	}
	const response = await fetchWithProxy(url, {method: 'GET', headers});
	const body = await readJson(response);
	requireOk(response, body, 'Model list request');
	const items = Array.isArray(body['models'])
		? (body['models'] as unknown[])
		: [];
	const models: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const record = item as Record<string, unknown>;
		const id =
			readString(record, 'id') ||
			readString(record, 'slug') ||
			readString(record, 'model') ||
			readString(record, 'name');
		if (id && !models.includes(id)) {
			models.push(id);
		}
	}
	return models;
}

// ---------------------------------------------------------------------------
// ChatGPT（OpenAI API，动态注册客户端）
// ---------------------------------------------------------------------------

interface ChatGptTokenResponse {
	tokens: OAuthTokenSet;
	scopes: string[];
}

function parseChatGptTokenResponse(
	body: Record<string, unknown>,
): ChatGptTokenResponse {
	const accessToken = readString(body, 'access_token');
	if (!accessToken) {
		throw new Error('Token response did not include an access token');
	}
	const expiresIn = readNumber(body, 'expires_in') ?? 3600;
	const scopes = readString(body, 'scope')
		.split(/\s+/)
		.filter(scope => scope.length > 0);
	return {
		tokens: {
			accessToken,
			refreshToken: readString(body, 'refresh_token'),
			idToken: readString(body, 'id_token'),
			email: '',
			planType: '',
			projectId: '',
			clientId: '',
			expiresAt: jwtExpiry(accessToken) ?? nowEpochSecs() + expiresIn,
		},
		scopes,
	};
}

async function chatgptTokenRequest(
	params: Record<string, string>,
	action: string,
): Promise<ChatGptTokenResponse> {
	const def = providerDef('chatgpt');
	const response = await fetchWithProxy(def.tokenUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: toFormBody(params),
	});
	const body = await readJson(response);
	requireOk(response, body, action);
	return parseChatGptTokenResponse(body);
}

async function chatgptExchangeCode(
	code: string,
	redirectUri: string,
	codeVerifier: string,
	issuedClientId: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('chatgpt');
	// 动态注册：真正的 client_id 由授权回调下发，占位 client_id 视为注册未完成
	const clientId = issuedClientId.trim();
	if (!clientId || clientId === def.clientId) {
		throw new Error(
			'ChatGPT app registration did not complete; please restart the sign-in',
		);
	}

	let response: ChatGptTokenResponse;
	try {
		response = await chatgptTokenRequest(
			{
				grant_type: 'authorization_code',
				client_id: clientId,
				code,
				redirect_uri: redirectUri,
				code_verifier: codeVerifier,
				resource: CHATGPT_RESOURCE,
			},
			'Token exchange',
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('invalid_grant')) {
			throw new Error(
				`${message}. Retry the sign-in; if it keeps failing, the account may not be eligible for ChatGPT plan usage (Plus or Pro plan required)`,
			);
		}
		throw error;
	}

	if (!response.scopes.includes(CHATGPT_PLAN_SCOPE)) {
		throw new Error(
			'ChatGPT plan usage was not authorized. Sign in again and allow plan usage; if the option is unavailable, the account may not be eligible (Plus or Pro plan required)',
		);
	}

	response.tokens.clientId = clientId;
	return response.tokens;
}

async function chatgptRefreshTokens(
	refreshToken: string,
	clientId: string,
): Promise<OAuthTokenSet> {
	const issuedClientId = clientId.trim();
	if (!issuedClientId) {
		throw new Error(
			'ChatGPT client registration is missing; please sign in again',
		);
	}
	const response = await chatgptTokenRequest(
		{
			grant_type: 'refresh_token',
			client_id: issuedClientId,
			refresh_token: refreshToken,
			resource: CHATGPT_RESOURCE,
		},
		'Token refresh',
	);
	response.tokens.clientId = issuedClientId;
	return response.tokens;
}

/** 校验 id_token 中的 nonce，防止授权响应被替换（对齐 Snow App 的 verify_identity） */
export function chatgptVerifyIdentity(idToken: string, nonce: string): void {
	const payload = decodeJwtPayload(idToken);
	if (!payload) {
		throw new Error(
			'ChatGPT identity could not be verified; please sign in again',
		);
	}
	if (readString(payload, 'nonce') !== nonce) {
		throw new Error(
			'ChatGPT identity could not be verified (nonce mismatch); please sign in again',
		);
	}
}

async function chatgptFetchModels(accessToken: string): Promise<string[]> {
	const def = providerDef('chatgpt');
	const base = def.backendBaseUrl.replace(/\/+$/, '');
	const response = await fetchWithProxy(`${base}/models`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${accessToken}`,
		},
	});
	const body = await readJson(response);
	requireOk(response, body, 'Model list request');
	const items = Array.isArray(body['models'])
		? (body['models'] as unknown[])
		: [];
	const models: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const record = item as Record<string, unknown>;
		// 仅保留对外可见（visibility=list）的模型，与 Snow App 一致
		if (readString(record, 'visibility') !== 'list') {
			continue;
		}
		const slug = readString(record, 'slug');
		if (slug && !models.includes(slug)) {
			models.push(slug);
		}
	}
	return models;
}

// ---------------------------------------------------------------------------
// Anthropic（Claude）
// ---------------------------------------------------------------------------

/** 回调 code 可能形如 `<code>#<state>`（Claude Code 手动流程） */
function splitAnthropicCodeAndState(raw: string): {
	code: string;
	state: string;
} {
	const trimmed = raw.trim();
	const hashIndex = trimmed.indexOf('#');
	if (hashIndex === -1) {
		return {code: trimmed, state: ''};
	}
	return {
		code: trimmed.slice(0, hashIndex).trim(),
		state: trimmed.slice(hashIndex + 1).trim(),
	};
}

function parseAnthropicTokenResponse(
	body: Record<string, unknown>,
): OAuthTokenSet {
	const accessToken = readString(body, 'access_token');
	if (!accessToken) {
		throw new Error('Token response did not include an access token');
	}
	const expiresIn = readNumber(body, 'expires_in') ?? 3600;
	const account = body['account'];
	const email = readString(
		account && typeof account === 'object'
			? (account as Record<string, unknown>)
			: null,
		'email_address',
	);
	return {
		accessToken,
		refreshToken: readString(body, 'refresh_token'),
		idToken: '',
		email,
		planType: '',
		projectId: '',
		clientId: '',
		expiresAt: nowEpochSecs() + expiresIn,
	};
}

async function anthropicTokenRequest(
	body: Record<string, string>,
	action: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('anthropic');
	const response = await fetchWithProxy(def.tokenUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json, text/plain, */*',
			'Content-Type': 'application/json',
			'User-Agent': ANTHROPIC_TOKEN_USER_AGENT,
			Connection: 'close',
		},
		body: JSON.stringify(body),
	});
	const parsed = await readJson(response);
	requireOk(response, parsed, action);
	return parseAnthropicTokenResponse(parsed);
}

async function anthropicExchangeCode(
	code: string,
	redirectUri: string,
	codeVerifier: string,
	state: string,
): Promise<OAuthTokenSet> {
	const {code: cleanCode, state: embeddedState} =
		splitAnthropicCodeAndState(code);
	if (!cleanCode) {
		throw new Error('Authorization code is empty');
	}
	const def = providerDef('anthropic');
	const body: Record<string, string> = {
		grant_type: 'authorization_code',
		code: cleanCode,
		redirect_uri: redirectUri,
		client_id: def.clientId,
		code_verifier: codeVerifier,
		state: embeddedState || state.trim(),
	};
	return anthropicTokenRequest(body, 'Token exchange');
}

async function anthropicRefreshTokens(
	refreshToken: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('anthropic');
	return anthropicTokenRequest(
		{
			client_id: def.clientId,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			scope: def.refreshScope,
		},
		'Token refresh',
	);
}

async function anthropicFetchModels(accessToken: string): Promise<string[]> {
	const def = providerDef('anthropic');
	const url = `${def.backendBaseUrl.replace(/\/+$/, '')}/v1/models?limit=1000`;
	const response = await fetchWithProxy(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${accessToken}`,
			'anthropic-version': ANTHROPIC_VERSION_HEADER,
			'anthropic-beta': ANTHROPIC_OAUTH_BETA,
		},
	});
	const body = await readJson(response);
	requireOk(response, body, 'Model list request');
	const items = Array.isArray(body['data']) ? (body['data'] as unknown[]) : [];
	const models: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const id = readString(item as Record<string, unknown>, 'id');
		if (id && !models.includes(id)) {
			models.push(id);
		}
	}
	return models;
}

// ---------------------------------------------------------------------------
// Antigravity（Google Cloud Code Assist）
// ---------------------------------------------------------------------------

function parseAntigravityTokenResponse(
	body: Record<string, unknown>,
): OAuthTokenSet {
	const accessToken = readString(body, 'access_token');
	if (!accessToken) {
		throw new Error('Token response did not include an access token');
	}
	const expiresIn = readNumber(body, 'expires_in') ?? 3600;
	return {
		accessToken,
		refreshToken: readString(body, 'refresh_token'),
		idToken: readString(body, 'id_token'),
		email: '',
		planType: '',
		projectId: '',
		clientId: '',
		expiresAt: nowEpochSecs() + expiresIn,
	};
}

async function antigravityTokenRequest(
	params: Record<string, string>,
	action: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('antigravity');
	const response = await fetchWithProxy(def.tokenUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: toFormBody(params),
	});
	const body = await readJson(response);
	requireOk(response, body, action);
	return parseAntigravityTokenResponse(body);
}

async function antigravityFetchUserEmail(accessToken: string): Promise<string> {
	try {
		const response = await fetchWithProxy(ANTIGRAVITY_USERINFO_URL, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
		});
		if (!response.ok) {
			return '';
		}
		const body = await readJson(response);
		return readString(body, 'email');
	} catch {
		return '';
	}
}

function antigravityTierLabel(value: unknown): string {
	if (!value || typeof value !== 'object') {
		return '';
	}
	const tier = value as Record<string, unknown>;
	const id = readString(tier, 'id');
	const name = readString(tier, 'name');
	switch (id) {
		case 'free-tier':
			return 'Free';
		case 'g1-pro-tier':
			return 'Pro';
		case 'g1-ultra-tier':
			return 'Ultra';
		case 'g1-ultra-lite-tier':
			return 'Ultra Lite';
		default:
			return name || id;
	}
}

function parseCodeAssistStatus(payload: Record<string, unknown>): {
	projectId: string;
	planType: string;
} {
	const projectValue = payload['cloudaicompanionProject'];
	let projectId = '';
	if (typeof projectValue === 'string') {
		projectId = projectValue.trim();
	} else if (projectValue && typeof projectValue === 'object') {
		projectId = readString(projectValue as Record<string, unknown>, 'id');
	}
	const paid = antigravityTierLabel(payload['paidTier']);
	const planType = paid || antigravityTierLabel(payload['currentTier']);
	return {projectId, planType};
}

async function postCodeAssist(
	method: string,
	accessToken: string,
	requestBody: Record<string, unknown>,
	action: string,
): Promise<Record<string, unknown>> {
	let lastError = '';
	for (const host of ANTIGRAVITY_CODE_ASSIST_HOSTS) {
		const url = `${host}/v1internal:${method}`;
		try {
			const response = await fetchWithProxy(url, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
					'User-Agent': antigravityUserAgent(),
					'x-goog-api-client': ANTIGRAVITY_API_CLIENT,
				},
				body: JSON.stringify(requestBody),
			});
			const body = await readJson(response);
			if (response.ok) {
				return body;
			}
			lastError = `${response.status} ${JSON.stringify(body).slice(0, 300)}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
	}
	throw new Error(`${action} failed: ${lastError}`);
}

async function antigravityFetchCodeAssistStatus(
	accessToken: string,
): Promise<{projectId: string; planType: string}> {
	try {
		const payload = await postCodeAssist(
			'loadCodeAssist',
			accessToken,
			{metadata: {ideType: 'ANTIGRAVITY'}},
			'Code Assist request',
		);
		return parseCodeAssistStatus(payload);
	} catch {
		return {projectId: '', planType: ''};
	}
}

async function antigravityExchangeCode(
	code: string,
	redirectUri: string,
	codeVerifier: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('antigravity');
	const tokens = await antigravityTokenRequest(
		{
			grant_type: 'authorization_code',
			client_id: def.clientId,
			client_secret: def.clientSecret,
			code,
			redirect_uri: redirectUri,
			code_verifier: codeVerifier,
		},
		'Token exchange',
	);
	tokens.email = await antigravityFetchUserEmail(tokens.accessToken);
	const status = await antigravityFetchCodeAssistStatus(tokens.accessToken);
	tokens.projectId = status.projectId;
	tokens.planType = status.planType;
	return tokens;
}

async function antigravityRefreshTokens(
	refreshToken: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('antigravity');
	return antigravityTokenRequest(
		{
			grant_type: 'refresh_token',
			client_id: def.clientId,
			client_secret: def.clientSecret,
			refresh_token: refreshToken,
		},
		'Token refresh',
	);
}

function antigravityModelRank(id: string): number {
	const index = ANTIGRAVITY_PREFERRED_MODELS.indexOf(id);
	return index === -1 ? ANTIGRAVITY_PREFERRED_MODELS.length : index;
}

function parseAntigravityModels(payload: Record<string, unknown>): string[] {
	const models: string[] = [];
	const push = (id: string) => {
		const trimmed = id.trim();
		if (trimmed && !models.includes(trimmed)) {
			models.push(trimmed);
		}
	};
	const list = payload['models'];
	if (list && typeof list === 'object' && !Array.isArray(list)) {
		for (const key of Object.keys(list as Record<string, unknown>)) {
			push(key);
		}
	} else if (Array.isArray(list)) {
		for (const item of list) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const record = item as Record<string, unknown>;
			push(
				readString(record, 'id') ||
					readString(record, 'name') ||
					readString(record, 'model'),
			);
		}
	}
	models.sort((a, b) => antigravityModelRank(a) - antigravityModelRank(b));
	return models;
}

async function antigravityFetchModels(
	accessToken: string,
	projectId: string,
): Promise<string[]> {
	const requestBody: Record<string, unknown> = {};
	if (projectId.trim()) {
		requestBody['project'] = projectId.trim();
	}
	const payload = await postCodeAssist(
		'fetchAvailableModels',
		accessToken,
		requestBody,
		'Model list request',
	);
	return parseAntigravityModels(payload);
}

// ---------------------------------------------------------------------------
// xAI（Grok）
// ---------------------------------------------------------------------------

function xaiParseClaims(idToken: string): OAuthClaims {
	const payload = decodeJwtPayload(idToken);
	if (!payload) {
		return {email: '', accountId: '', planType: ''};
	}
	return {
		email: readString(payload, 'email'),
		accountId: readString(payload, 'sub'),
		planType: '',
	};
}

function parseXaiTokenResponse(body: Record<string, unknown>): OAuthTokenSet {
	const accessToken = readString(body, 'access_token');
	if (!accessToken) {
		throw new Error('Token response did not include an access token');
	}
	const idToken = readString(body, 'id_token');
	const claims = xaiParseClaims(idToken);
	const expiresIn = readNumber(body, 'expires_in') ?? 3600;
	return {
		accessToken,
		refreshToken: readString(body, 'refresh_token'),
		idToken,
		email: claims.email,
		planType: claims.planType,
		projectId: '',
		clientId: '',
		expiresAt: nowEpochSecs() + expiresIn,
	};
}

async function xaiTokenRequest(
	params: Record<string, string>,
	action: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('xai');
	const response = await fetchWithProxy(def.tokenUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: toFormBody(params),
	});
	const body = await readJson(response);
	requireOk(response, body, action);
	return parseXaiTokenResponse(body);
}

async function xaiExchangeCode(
	code: string,
	redirectUri: string,
	codeVerifier: string,
): Promise<OAuthTokenSet> {
	const def = providerDef('xai');
	return xaiTokenRequest(
		{
			grant_type: 'authorization_code',
			client_id: def.clientId,
			code,
			redirect_uri: redirectUri,
			code_verifier: codeVerifier,
		},
		'Token exchange',
	);
}

async function xaiRefreshTokens(refreshToken: string): Promise<OAuthTokenSet> {
	const def = providerDef('xai');
	return xaiTokenRequest(
		{
			grant_type: 'refresh_token',
			client_id: def.clientId,
			refresh_token: refreshToken,
		},
		'Token refresh',
	);
}

async function xaiFetchModels(accessToken: string): Promise<string[]> {
	const def = providerDef('xai');
	const url = `${def.backendBaseUrl.replace(/\/+$/, '')}/models`;
	const response = await fetchWithProxy(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${accessToken}`,
		},
	});
	const body = await readJson(response);
	requireOk(response, body, 'Model list request');
	const items = Array.isArray(body['data']) ? (body['data'] as unknown[]) : [];
	const models: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const id = readString(item as Record<string, unknown>, 'id');
		if (id && !models.includes(id)) {
			models.push(id);
		}
	}
	return models;
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

export async function exchangeCode(
	provider: OAuthProviderId,
	code: string,
	redirectUri: string,
	codeVerifier: string,
	state: string,
	issuedClientId: string = '',
): Promise<OAuthTokenSet> {
	switch (provider) {
		case 'codex':
			return codexExchangeCode(code, redirectUri, codeVerifier);
		case 'chatgpt':
			return chatgptExchangeCode(code, redirectUri, codeVerifier, issuedClientId);
		case 'anthropic':
			return anthropicExchangeCode(code, redirectUri, codeVerifier, state);
		case 'antigravity':
			return antigravityExchangeCode(code, redirectUri, codeVerifier);
		case 'xai':
			return xaiExchangeCode(code, redirectUri, codeVerifier);
	}
}

export async function refreshTokens(
	provider: OAuthProviderId,
	refreshToken: string,
	clientId: string = '',
): Promise<OAuthTokenSet> {
	switch (provider) {
		case 'codex':
			return codexRefreshTokens(refreshToken);
		case 'chatgpt':
			return chatgptRefreshTokens(refreshToken, clientId);
		case 'anthropic':
			return anthropicRefreshTokens(refreshToken);
		case 'antigravity':
			return antigravityRefreshTokens(refreshToken);
		case 'xai':
			return xaiRefreshTokens(refreshToken);
	}
}

export function parseClaims(
	provider: OAuthProviderId,
	tokens: OAuthTokenSet,
): OAuthClaims {
	switch (provider) {
		case 'codex':
			return codexParseClaims(tokens.idToken);
		case 'chatgpt':
			return codexParseClaims(tokens.idToken);
		case 'anthropic':
			return {email: tokens.email.trim(), accountId: '', planType: ''};
		case 'antigravity':
			return {
				email: tokens.email.trim(),
				accountId: tokens.projectId.trim(),
				planType: tokens.planType.trim(),
			};
		case 'xai':
			return xaiParseClaims(tokens.idToken);
	}
}

export async function fetchModels(
	provider: OAuthProviderId,
	accessToken: string,
	accountId: string,
): Promise<string[]> {
	switch (provider) {
		case 'codex':
			return codexFetchModels(accessToken, accountId);
		case 'chatgpt':
			return chatgptFetchModels(accessToken);
		case 'anthropic':
			return anthropicFetchModels(accessToken);
		case 'antigravity':
			return antigravityFetchModels(accessToken, accountId);
		case 'xai':
			return xaiFetchModels(accessToken);
	}
}

/**
 * 为 API 请求注入 provider 专属请求头（对齐 Snow App 的 apply_request_headers）。
 * 注意：只处理附加头，Authorization 由调用方基于最终 apiKey 统一设置。
 */
export function applyProviderRequestHeaders(
	metadata: OAuthProfileMetadata,
	headers: Record<string, string>,
): void {
	switch (metadata.provider) {
		case 'codex': {
			headers['originator'] = CODEX_ORIGINATOR;
			headers['OpenAI-Beta'] = 'responses=experimental';
			headers['User-Agent'] = codexUserAgent();
			if (metadata.accountId.trim()) {
				headers['chatgpt-account-id'] = metadata.accountId.trim();
			}
			return;
		}
		case 'anthropic': {
			headers['anthropic-version'] = ANTHROPIC_VERSION_HEADER;
			headers['anthropic-beta'] = ANTHROPIC_OAUTH_BETA;
			// OAuth token 走 Authorization，不再使用 x-api-key
			delete headers['x-api-key'];
			return;
		}
		case 'antigravity': {
			headers['User-Agent'] = antigravityUserAgent();
			headers['x-goog-api-client'] = ANTIGRAVITY_API_CLIENT;
			// Cloud Code Assist 使用 Authorization，不使用 x-goog-api-key
			delete headers['x-goog-api-key'];
			return;
		}
		case 'chatgpt':
			// ChatGPT API 直接使用标准 Authorization 头，无额外请求头
			return;
		case 'xai':
			return;
	}
}

export {antigravityUserAgent, codexUserAgent};
