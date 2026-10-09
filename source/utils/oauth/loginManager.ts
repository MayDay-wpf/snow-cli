/**
 * OAuth 登录会话管理：启动登录、轮询状态、取消、手动提交回调。
 * 对齐 Snow App 的 native/src/api/oauth/sessions.rs。
 */

import {mkdir, readFile, writeFile} from 'fs/promises';
import {dirname, join} from 'path';
import {resolveSnowConfigDir} from '../config/apiConfig.js';
import {CHATGPT_HOST_ID_FILE_NAME, OAUTH_PROVIDERS} from './constants.js';
import {
	startCallbackServer,
	type CallbackServerHandle,
} from './callbackServer.js';
import {
	buildAuthorizeUrl,
	chatgptVerifyIdentity,
	exchangeCode,
	fetchModels,
	parseClaims,
} from './flows.js';
import {
	buildProfileDraft,
	pickModel,
	saveOAuthProfile,
} from './profileStore.js';
import type {
	OAuthLoginOutcome,
	OAuthLoginStartResult,
	OAuthLoginStatus,
	OAuthLoginStatusView,
	OAuthProviderId,
	OAuthTokenSet,
} from './types.js';
import {generatePkce, generateSessionId, generateState} from './utils.js';

const LOGIN_SESSION_TIMEOUT_MS = 15 * 60 * 1000;

interface OAuthLoginSession {
	sessionId: string;
	provider: OAuthProviderId;
	state: string;
	/** chatgpt 授权时写入并在 id_token 中回验的 nonce */
	nonce: string;
	/** chatgpt 的 ext_agent_host_id（本地持久化） */
	hostId: string;
	codeVerifier: string;
	redirectUri: string;
	authUrl: string;
	localPort: number;
	manualMode: boolean;
	advancedModel: string;
	basicModel: string;
}

interface OAuthLoginEntry {
	session: OAuthLoginSession;
	status: OAuthLoginStatus;
	error?: string;
	outcome?: OAuthLoginOutcome;
	server?: CallbackServerHandle;
	timeout: NodeJS.Timeout;
	completing: boolean;
}

const sessions = new Map<string, OAuthLoginEntry>();

function toStatusView(entry: OAuthLoginEntry): OAuthLoginStatusView {
	return {
		provider: entry.session.provider,
		status: entry.status,
		error: entry.error,
		outcome: entry.outcome,
		authUrl: entry.session.authUrl,
		manualMode: entry.session.manualMode,
	};
}

/**
 * 启动一次 OAuth 登录：生成 PKCE / state、监听本地回调端口、返回授权链接。
 */
export async function startOAuthLogin(
	provider: OAuthProviderId,
	advancedModel?: string,
	basicModel?: string,
): Promise<OAuthLoginStartResult> {
	const def = OAUTH_PROVIDERS[provider];
	const pkce = generatePkce();
	const state = generateState();
	const nonce = generateState();
	const sessionId = generateSessionId();

	const server = await startCallbackServer({
		provider,
		ports: def.callbackPorts,
		onCallback: async params => {
			try {
				await handleCallbackRequest(sessionId, params);
				return {ok: true};
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
	});

	const manualMode = server === null;
	const port = server?.port ?? def.callbackPorts[0] ?? 0;
	const redirectUri = `http://${def.redirectHost}:${port}${def.callbackPath}`;
	// chatgpt 走动态客户端注册：授权链接需要 nonce 与本地持久化的 ext_agent_host_id
	const hostId = provider === 'chatgpt' ? await ensureChatGptHostId() : '';
	const authUrl = buildAuthorizeUrl(
		provider,
		redirectUri,
		pkce,
		state,
		nonce,
		hostId,
	);

	const session: OAuthLoginSession = {
		sessionId,
		provider,
		state,
		nonce,
		hostId,
		codeVerifier: pkce.verifier,
		redirectUri,
		authUrl,
		localPort: manualMode ? 0 : port,
		manualMode,
		advancedModel: (advancedModel ?? '').trim(),
		basicModel: (basicModel ?? '').trim(),
	};

	const timeout = setTimeout(() => {
		const entry = sessions.get(sessionId);
		if (entry && entry.status === 'pending') {
			cancelOAuthLogin(sessionId);
		}
	}, LOGIN_SESSION_TIMEOUT_MS);
	timeout.unref?.();

	sessions.set(sessionId, {
		session,
		status: 'pending',
		server: server ?? undefined,
		timeout,
		completing: false,
	});

	return {
		sessionId,
		provider,
		authUrl,
		port,
		manualMode,
		defaultModel: def.defaultModel,
	};
}

export function getOAuthLoginStatus(
	sessionId: string,
): OAuthLoginStatusView | null {
	const entry = sessions.get(sessionId);
	return entry ? toStatusView(entry) : null;
}

export function cancelOAuthLogin(sessionId: string): boolean {
	const entry = sessions.get(sessionId);
	if (!entry || entry.status !== 'pending') {
		return false;
	}
	entry.status = 'cancelled';
	closeEntry(entry);
	return true;
}

function closeEntry(entry: OAuthLoginEntry): void {
	clearTimeout(entry.timeout);
	if (entry.server) {
		entry.server.close();
		entry.server = undefined;
	}
}

/**
 * 读取/生成 ChatGPT 的 ext_agent_host_id（持久化在 Snow 配置目录）。
 * 文件缺失或内容无效时重新生成；写入失败不阻断登录，仅使用本次生成的值。
 */
async function ensureChatGptHostId(): Promise<string> {
	const path = join(resolveSnowConfigDir(), CHATGPT_HOST_ID_FILE_NAME);
	try {
		const existing = await readFile(path, 'utf8');
		const parsed = JSON.parse(existing) as {ext_agent_host_id?: unknown};
		const hostId =
			typeof parsed?.ext_agent_host_id === 'string'
				? parsed.ext_agent_host_id.trim()
				: '';
		if (hostId) {
			return hostId;
		}
	} catch {
		// 文件缺失或内容损坏：走下面的重新生成分支
	}

	const hostId = `urn:uuid:${generateSessionId()}`;
	try {
		await mkdir(dirname(path), {recursive: true});
		await writeFile(path, JSON.stringify({ext_agent_host_id: hostId}), 'utf8');
	} catch (error) {
		console.error(
			'[oauth] failed to persist the ChatGPT host id:',
			error instanceof Error ? error.message : error,
		);
	}
	return hostId;
}

/**
 * 手动提交回调地址 / 授权码（回调端口不可用时的兜底流程）。
 * 返回提交后的状态视图；解析或换 token 失败时错误写入 status.error。
 */
export async function submitOAuthCallback(
	sessionId: string,
	rawInput: string,
): Promise<OAuthLoginStatusView | null> {
	const entry = sessions.get(sessionId);
	if (!entry) {
		return null;
	}
	const params = parseCallbackInput(rawInput);
	try {
		await handleCallbackRequest(sessionId, params);
	} catch (error) {
		// 具体错误已写入 session（handleCallbackRequest 内部处理）
		void error;
	}
	return toStatusView(entry);
}

/**
 * 解析用户粘贴的回调输入，兼容：
 * - 完整回调 URL：http://localhost:54545/callback?code=...&state=...
 * - `code#state` 形式（Claude 手动流程）
 * - 纯授权码
 */
export function parseCallbackInput(raw: string): URLSearchParams {
	const trimmed = raw.trim();
	const params = new URLSearchParams();
	if (!trimmed) {
		return params;
	}

	const questionIndex = trimmed.indexOf('?');
	const afterQuestion =
		questionIndex === -1 ? trimmed : trimmed.slice(questionIndex + 1);
	const hashIndex = afterQuestion.indexOf('#');
	const query =
		hashIndex === -1 ? afterQuestion : afterQuestion.slice(0, hashIndex);

	if (query.includes('=')) {
		const search = new URLSearchParams(query);
		for (const [key, value] of search.entries()) {
			if (key) {
				params.set(key, value);
			}
		}
		return params;
	}

	// 无 `key=value` 结构：当作裸授权码，`#` 后视为 state
	const stateIndex = trimmed.indexOf('#');
	if (stateIndex === -1) {
		if (query) {
			params.set('raw_code', query);
		}
		return params;
	}
	const code = trimmed.slice(0, stateIndex).trim();
	const state = trimmed.slice(stateIndex + 1).trim();
	if (code) {
		params.set('raw_code', code);
	}
	if (state) {
		params.set('state', state);
	}
	return params;
}

async function handleCallbackRequest(
	sessionId: string,
	params: URLSearchParams,
): Promise<void> {
	const entry = sessions.get(sessionId);
	if (!entry) {
		throw new Error('Login session not found or expired');
	}
	const {session} = entry;

	const errorParam = params.get('error')?.trim();
	if (errorParam) {
		const description = params.get('error_description')?.trim() ?? '';
		const message = description
			? `Authorization failed: ${description}`
			: `Authorization failed: ${errorParam}`;
		setSessionError(entry, message);
		throw new Error(message);
	}

	const state = params.get('state')?.trim() ?? '';
	if (state && state !== session.state) {
		const message = 'Authorization state mismatch; please restart the login';
		setSessionError(entry, message);
		throw new Error(message);
	}

	const code =
		params.get('code')?.trim() || params.get('raw_code')?.trim() || '';
	if (!code) {
		const message = 'Missing authorization code';
		setSessionError(entry, message);
		throw new Error(message);
	}

	// chatgpt 动态注册：授权回调会带回上游下发的 client_id，换 token 与后续刷新都需要它
	const issuedClientId = params.get('client_id')?.trim() ?? '';

	await completeLogin(entry, code, issuedClientId);
}

function setSessionError(entry: OAuthLoginEntry, message: string): void {
	if (entry.status === 'pending') {
		entry.status = 'error';
		entry.error = message;
	}
	closeEntry(entry);
}

async function completeLogin(
	entry: OAuthLoginEntry,
	code: string,
	issuedClientId: string,
): Promise<void> {
	if (entry.status === 'success' && entry.outcome) {
		return;
	}
	if (entry.status !== 'pending') {
		throw new Error('Login is no longer pending');
	}
	if (entry.completing) {
		throw new Error('Login is already being completed');
	}
	entry.completing = true;

	try {
		const outcome = await performLogin(entry.session, code, issuedClientId);
		entry.status = 'success';
		entry.outcome = outcome;
		entry.error = undefined;
	} catch (error) {
		if (entry.status === 'pending') {
			entry.status = 'error';
			entry.error = error instanceof Error ? error.message : String(error);
		}
		throw error;
	} finally {
		entry.completing = false;
		closeEntry(entry);
	}
}

async function performLogin(
	session: OAuthLoginSession,
	code: string,
	issuedClientId: string,
): Promise<OAuthLoginOutcome> {
	const provider = session.provider;
	const tokens = await exchangeCode(
		provider,
		code,
		session.redirectUri,
		session.codeVerifier,
		session.state,
		issuedClientId,
	);
	if (provider === 'chatgpt') {
		chatgptVerifyIdentity(tokens.idToken, session.nonce);
	}
	const claims = parseClaims(provider, tokens);

	let availableModels: string[] = [];
	try {
		availableModels = await fetchModels(
			provider,
			tokens.accessToken,
			claims.accountId,
		);
	} catch {
		availableModels = [];
	}

	const advancedModel = pickModel(
		provider,
		session.advancedModel,
		availableModels,
	);
	const basicModel = pickModel(provider, session.basicModel, availableModels);

	const draft = buildProfileDraft(
		provider,
		claims,
		tokens,
		advancedModel,
		basicModel,
		issuedClientId,
	);
	const outcome = saveOAuthProfile(draft);
	return {
		...outcome,
		availableModels,
	};
}

/** 供测试与诊断：当前进行中的登录会话数 */
export function getActiveOAuthSessionCount(): number {
	return sessions.size;
}

/** 关闭所有会话（进程退出/清理用） */
export function disposeOAuthSessions(): void {
	for (const entry of sessions.values()) {
		closeEntry(entry);
	}
	sessions.clear();
}

export type {OAuthTokenSet};
