/**
 * 外部 MCP 服务器的 OAuth 2.1 授权支持（对齐 Snow App 的
 * native/crates/snow-tools/src/external/oauth.rs）。
 *
 * 远程 MCP 服务器按 MCP 授权规范在未授权时返回 401 与 `WWW-Authenticate`
 * 挑战，客户端需要完成：受保护资源元数据发现 -> 客户端身份（Client ID
 * Metadata Document 优先，动态客户端注册兜底）-> PKCE 授权码流程 -> 令牌交换，
 * 之后每条 MCP 请求都带 Bearer 令牌。
 *
 * - 登录：startMCPOAuthLogin 启动本地回调监听并返回浏览器授权地址，
 *   界面轮询 getMCPOAuthLoginStatus 获取结果；
 * - 连接：createMCPOAuthAuthProvider 为传输层提供令牌，401 时用 refresh_token
 *   静默刷新，刷新失败则抛出稳定前缀的需授权错误，由 /mcp 面板引导重新授权。
 */

import {createHash, randomBytes} from 'crypto';
import fs from 'fs';
import path from 'path';
import {createServer, type Server} from 'http';
import type {AddressInfo} from 'net';
import {
	auth,
	discoverOAuthServerInfo,
	extractWWWAuthenticateParams,
	UnauthorizedError,
	type AuthProvider,
	type FetchLike,
	type OAuthClientMetadata,
	type OAuthClientProvider,
	type OAuthDiscoveryState,
	type StoredOAuthClientInformation,
	type StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import {getGlobalSnowDir} from '../core/snowContext.js';
import {addProxyToFetchOptions} from '../core/proxyUtils.js';
import {logger} from '../core/logger.js';

const log = logger.child('execution:mcpOAuth');

/** 需要 OAuth 授权的稳定错误前缀：面板据此显示授权入口（与 Snow App 一致）。 */
export const MCP_AUTH_REQUIRED_PREFIX = 'mcp:auth_required';

/** 浏览器授权等待上限；超时后会话自动结束，避免监听端口长期残留。 */
const LOGIN_TIMEOUT_MS = 300_000;

/** 401 挑战探测超时。 */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Client ID Metadata Document（SEP-991）地址。文档随仓库发布在
 * `resources/mcp-oauth/client-metadata.json`，授权服务器按 URL 抓取它并把
 * URL 本身当作 client_id；没有 registration_endpoint 的授权服务器只能走这条
 * 路径完成客户端识别。
 *
 * 必须用 jsDelivr 而不是 raw.githubusercontent.com：后者的响应是
 * `text/plain`，授权服务器会以「must be served as JSON」拒绝。
 */
const CLIENT_METADATA_URL =
	'https://cdn.jsdelivr.net/gh/MayDay-wpf/snow-cli@main/resources/mcp-oauth/client-metadata.json';

/**
 * 固定回调端口。CIMD 文档里的 `redirect_uris` 是静态枚举，无法表达系统分配的
 * 随机端口，只能在这组端口里逐个尝试；修改这里必须同步
 * `resources/mcp-oauth/client-metadata.json`。与 Snow App（45871-45874）错开，
 * 两者同时授权时互不抢占端口。
 */
const FIXED_CALLBACK_PORTS = [45881, 45882, 45883, 45884];

const DEFAULT_REDIRECT_URI = `http://127.0.0.1:${FIXED_CALLBACK_PORTS[0]}/callback`;

const CLIENT_NAME = 'Snow CLI';
const CLIENT_URI = 'https://github.com/MayDay-wpf/snow-cli';

// ============================================================================
// 需授权错误
// ============================================================================

/** 服务器要求 OAuth 授权（连接阶段无法静默刷新令牌时抛出）。 */
export class MCPAuthRequiredError extends Error {
	constructor(detail?: string) {
		const trimmed = detail?.trim();
		super(
			trimmed && !trimmed.startsWith(MCP_AUTH_REQUIRED_PREFIX)
				? `${MCP_AUTH_REQUIRED_PREFIX}: ${trimmed}`
				: MCP_AUTH_REQUIRED_PREFIX,
		);
		this.name = 'MCPAuthRequiredError';
	}
}

/** 判定错误文本是否表示「服务器要求授权」。 */
export function isMCPAuthRequiredMessage(message: string | undefined): boolean {
	if (!message) {
		return false;
	}
	if (message.startsWith(MCP_AUTH_REQUIRED_PREFIX)) {
		return true;
	}
	const lower = message.toLowerCase();
	return (
		lower.includes('requires authorization') ||
		lower.includes('authorization required') ||
		lower.includes('insufficient scope') ||
		lower.includes('unauthorized') ||
		lower.includes('(http 401)') ||
		lower.includes('http 401')
	);
}

/** 沿 cause 链识别 401 / 需授权类错误。 */
export function isMCPAuthError(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; current && depth < 6; depth++) {
		if (current instanceof MCPAuthRequiredError) {
			return true;
		}
		if (current instanceof UnauthorizedError) {
			return true;
		}
		if (current instanceof Error) {
			if (current.name === 'UnauthorizedError') {
				return true;
			}
			const status = (current as {data?: {status?: unknown}}).data?.status;
			if (status === 401) {
				return true;
			}
			if (isMCPAuthRequiredMessage(current.message)) {
				return true;
			}
			current = (current as {cause?: unknown}).cause;
			continue;
		}
		return typeof current === 'string' && isMCPAuthRequiredMessage(current);
	}
	return false;
}

/**
 * 把连接阶段的需授权错误归一为稳定前缀。
 * 未开启 oauth 的服务器保留原始错误，并提示如何开启。
 */
export function normalizeMCPAuthError(
	error: unknown,
	oauthEnabled: boolean,
): unknown {
	if (!isMCPAuthError(error)) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	if (oauthEnabled) {
		return error instanceof MCPAuthRequiredError
			? error
			: new MCPAuthRequiredError(message);
	}
	return new Error(
		`${message} (the server requires authorization: add "oauth": true to this MCP server to sign in via OAuth, or configure an Authorization header)`,
	);
}

// ============================================================================
// 凭据持久化
// ============================================================================

interface StoredMCPOAuthCredentials {
	serverUrl?: string;
	redirectUri?: string;
	clientInformation?: StoredOAuthClientInformation;
	tokens?: StoredOAuthTokens;
	discoveryState?: OAuthDiscoveryState;
	updatedAt?: number;
}

/** 按服务器 URL 派生凭据文件（同一地址的全局 / 项目配置共享登录态）。 */
function credentialFilePath(serverUrl: string): string {
	const hash = createHash('sha256')
		.update(serverUrl.trim())
		.digest('hex')
		.slice(0, 32);
	return path.join(getGlobalSnowDir().native, 'mcp-oauth', `${hash}.json`);
}

class MCPOAuthCredentialStore {
	private readonly filePath: string;

	constructor(private readonly serverUrl: string) {
		this.filePath = credentialFilePath(serverUrl);
	}

	read(): StoredMCPOAuthCredentials {
		try {
			if (!fs.existsSync(this.filePath)) {
				return {};
			}
			const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
			return parsed && typeof parsed === 'object'
				? (parsed as StoredMCPOAuthCredentials)
				: {};
		} catch (error) {
			log.warn('Failed to read MCP OAuth credentials', {
				serverUrl: this.serverUrl,
				error: error instanceof Error ? error.message : String(error),
			});
			return {};
		}
	}

	update(patch: Partial<StoredMCPOAuthCredentials>): void {
		const next: StoredMCPOAuthCredentials = {
			...this.read(),
			...patch,
			serverUrl: this.serverUrl,
			updatedAt: Date.now(),
		};
		for (const key of Object.keys(next) as Array<
			keyof StoredMCPOAuthCredentials
		>) {
			if (next[key] === undefined) {
				delete next[key];
			}
		}
		fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
		fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2), {
			encoding: 'utf8',
			mode: 0o600,
		});
	}

	clear(): void {
		try {
			fs.rmSync(this.filePath, {force: true});
		} catch (error) {
			log.debug('Failed to remove MCP OAuth credentials', {
				serverUrl: this.serverUrl,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

// ============================================================================
// OAuthClientProvider 实现
// ============================================================================

interface ProviderOptions {
	redirectUrl: string;
	/** 交互模式（登录会话）才允许跳转浏览器；连接模式跳转即视为需授权 */
	interactive: boolean;
	onRedirect?: (authorizationUrl: URL) => void;
}

class SnowMCPOAuthProvider implements OAuthClientProvider {
	private verifier?: string;
	private stateValue?: string;

	constructor(
		private readonly store: MCPOAuthCredentialStore,
		private readonly options: ProviderOptions,
	) {}

	get redirectUrl(): string {
		return this.options.redirectUrl;
	}

	get clientMetadataUrl(): string {
		return CLIENT_METADATA_URL;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: CLIENT_NAME,
			client_uri: CLIENT_URI,
			redirect_uris: [this.options.redirectUrl],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			application_type: 'native',
		} as OAuthClientMetadata;
	}

	/** 本次授权请求的 state，回调时校验以防 CSRF。 */
	get expectedState(): string | undefined {
		return this.stateValue;
	}

	state(): string {
		this.stateValue = randomBytes(16).toString('base64url');
		return this.stateValue;
	}

	clientInformation(): StoredOAuthClientInformation | undefined {
		const info = this.store.read().clientInformation;
		if (!info) {
			return undefined;
		}
		// 动态注册得到的 client 绑定了注册时的 redirect_uris；回调端口变化时
		// 授权服务器会拒绝，返回 undefined 让 SDK 重新注册。CIMD 的 client_id
		// 是文档 URL，回调地址由文档枚举，不受影响。
		const redirectUris = (info as {redirect_uris?: unknown}).redirect_uris;
		if (
			Array.isArray(redirectUris) &&
			redirectUris.length > 0 &&
			!redirectUris.includes(this.options.redirectUrl)
		) {
			return undefined;
		}
		return info;
	}

	saveClientInformation(info: StoredOAuthClientInformation): void {
		this.store.update({clientInformation: info});
	}

	tokens(): StoredOAuthTokens | undefined {
		return this.store.read().tokens;
	}

	saveTokens(tokens: StoredOAuthTokens): void {
		this.store.update({tokens, redirectUri: this.options.redirectUrl});
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		if (!this.options.interactive || !this.options.onRedirect) {
			throw new MCPAuthRequiredError('OAuth authorization is required');
		}
		this.options.onRedirect(authorizationUrl);
	}

	saveCodeVerifier(codeVerifier: string): void {
		this.verifier = codeVerifier;
	}

	codeVerifier(): string {
		if (!this.verifier) {
			throw new Error('No PKCE code verifier is available for this session');
		}
		return this.verifier;
	}

	saveDiscoveryState(state: OAuthDiscoveryState): void {
		this.store.update({discoveryState: state});
	}

	discoveryState(): OAuthDiscoveryState | undefined {
		return this.store.read().discoveryState;
	}

	invalidateCredentials(
		scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
	): void {
		switch (scope) {
			case 'all':
				this.verifier = undefined;
				this.store.clear();
				return;
			case 'client':
				this.store.update({clientInformation: undefined});
				return;
			case 'tokens':
				this.store.update({tokens: undefined});
				return;
			case 'verifier':
				this.verifier = undefined;
				return;
			case 'discovery':
				this.store.update({discoveryState: undefined});
				return;
		}
	}
}

// ============================================================================
// 网络
// ============================================================================

/**
 * OAuth 端点使用的 fetch：走全局代理设置，且不携带 MCP 服务器的自定义请求头
 * （避免把 MCP 侧的 Authorization 等头发给授权服务器）。
 */
const oauthFetch: FetchLike = (url, init) =>
	fetch(url, addProxyToFetchOptions(String(url), init ?? {}));

/** 探测 MCP 端点的 401 挑战，提取 `resource_metadata` 与 scope。 */
async function probeAuthChallenge(
	serverUrl: string,
	headers: Record<string, string>,
): Promise<{resourceMetadataUrl?: URL; scope?: string}> {
	const requestHeaders: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() !== 'authorization') {
			requestHeaders[name] = value;
		}
	}
	requestHeaders['Content-Type'] = 'application/json';
	requestHeaders['Accept'] = 'application/json, text/event-stream';

	try {
		const response = await oauthFetch(serverUrl, {
			method: 'POST',
			headers: requestHeaders,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-11-25',
					capabilities: {},
					clientInfo: {name: CLIENT_NAME, version: '1.0.0'},
				},
			}),
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		await response.body?.cancel().catch(() => {});
		if (response.status !== 401 && response.status !== 403) {
			return {};
		}
		const {resourceMetadataUrl, scope} = extractWWWAuthenticateParams(response);
		return {resourceMetadataUrl, scope};
	} catch (error) {
		log.debug('MCP OAuth challenge probe failed', {
			serverUrl,
			error: error instanceof Error ? error.message : String(error),
		});
		return {};
	}
}

// ============================================================================
// 连接用 AuthProvider
// ============================================================================

/** 同一服务器的并发刷新只跑一次。 */
const inFlightRefresh = new Map<string, Promise<void>>();

/**
 * 为 MCP 传输层构建 AuthProvider：
 * - 每次请求读取已保存的 access_token；
 * - 服务器返回 401 时用 refresh_token 静默刷新，无法刷新则抛出需授权错误。
 */
export function createMCPOAuthAuthProvider(serverUrl: string): AuthProvider {
	const store = new MCPOAuthCredentialStore(serverUrl);

	return {
		token: async () => store.read().tokens?.access_token,
		onUnauthorized: async ctx => {
			const existing = inFlightRefresh.get(serverUrl);
			if (existing) {
				await existing;
				return;
			}

			const refreshOnce = async () => {
				const stored = store.read();
				if (!stored.tokens?.refresh_token || !stored.clientInformation) {
					throw new MCPAuthRequiredError('OAuth authorization is required');
				}
				const provider = new SnowMCPOAuthProvider(store, {
					redirectUrl: stored.redirectUri || DEFAULT_REDIRECT_URI,
					interactive: false,
				});
				const {resourceMetadataUrl, scope} = extractWWWAuthenticateParams(
					ctx.response,
				);
				const result = await auth(provider, {
					serverUrl: ctx.serverUrl,
					resourceMetadataUrl,
					scope,
					fetchFn: oauthFetch,
				});
				if (result !== 'AUTHORIZED') {
					throw new MCPAuthRequiredError('OAuth authorization is required');
				}
			};

			const refresh = refreshOnce().catch(error => {
				throw error instanceof MCPAuthRequiredError
					? error
					: new MCPAuthRequiredError(
							error instanceof Error ? error.message : String(error),
					  );
			});
			inFlightRefresh.set(serverUrl, refresh);
			try {
				await refresh;
			} finally {
				inFlightRefresh.delete(serverUrl);
			}
		},
	};
}

/** 是否已保存该服务器的授权令牌。 */
export function hasMCPOAuthTokens(serverUrl: string): boolean {
	return Boolean(new MCPOAuthCredentialStore(serverUrl).read().tokens);
}

/** 清除该服务器的授权凭据（退出登录）。 */
export function clearMCPOAuthCredentials(serverUrl: string): void {
	new MCPOAuthCredentialStore(serverUrl).clear();
}

// ============================================================================
// 浏览器登录会话
// ============================================================================

export type MCPOAuthLoginStatus = 'pending' | 'success' | 'error' | 'cancelled';

export interface MCPOAuthLoginStart {
	sessionId: string;
	authUrl: string;
}

export interface MCPOAuthLoginSnapshot {
	status: MCPOAuthLoginStatus;
	error?: string;
}

interface LoginSession {
	serviceName: string;
	status: MCPOAuthLoginStatus;
	error?: string;
	server: Server;
	timer: NodeJS.Timeout;
}

const loginSessions = new Map<string, LoginSession>();

function finishSession(
	session: LoginSession,
	status: Exclude<MCPOAuthLoginStatus, 'pending'>,
	error?: string,
): void {
	if (session.status !== 'pending') {
		return;
	}
	session.status = status;
	session.error = error;
	clearTimeout(session.timer);
	try {
		session.server.close();
	} catch (closeError) {
		log.debug('Failed to close MCP OAuth callback server', {
			error: closeError instanceof Error ? closeError.message : String(closeError),
		});
	}
}

/** 同一服务重新发起授权：取消仍在等待的旧会话并清理已结束记录。 */
function resetSessionsForService(serviceName: string): void {
	for (const [id, session] of loginSessions) {
		if (session.serviceName !== serviceName) {
			continue;
		}
		finishSession(session, 'cancelled');
		loginSessions.delete(id);
	}
}

function tryListen(server: Server, port: number): Promise<number | null> {
	return new Promise(resolve => {
		const onError = () => {
			server.removeListener('listening', onListening);
			resolve(null);
		};
		const onListening = () => {
			server.removeListener('error', onError);
			const address = server.address() as AddressInfo | null;
			resolve(address?.port ?? port);
		};
		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(port, '127.0.0.1');
	});
}

/**
 * 绑定本地回调监听。走 CIMD 时只能使用文档里预置的固定端口；动态注册时
 * 先尝试固定端口（回调地址稳定可复用已注册的 client），全部占用再退回随机端口。
 */
async function bindCallbackServer(
	server: Server,
	fixedPortsRequired: boolean,
): Promise<number> {
	for (const port of FIXED_CALLBACK_PORTS) {
		const bound = await tryListen(server, port);
		if (bound !== null) {
			return bound;
		}
	}
	if (!fixedPortsRequired) {
		const bound = await tryListen(server, 0);
		if (bound !== null) {
			return bound;
		}
	}
	throw new Error(
		`Failed to start the MCP OAuth callback listener: ports ${FIXED_CALLBACK_PORTS.join(
			', ',
		)} are all in use`,
	);
}

export interface StartMCPOAuthLoginOptions {
	serviceName: string;
	/** 已完成环境变量插值的 MCP 端点地址 */
	serverUrl: URL;
	/** MCP 服务器自定义请求头（仅用于 401 挑战探测，不含 Authorization） */
	headers?: Record<string, string>;
}

/** 启动浏览器授权：完成元数据发现、登记会话并监听本地回调。 */
export async function startMCPOAuthLogin(
	options: StartMCPOAuthLoginOptions,
): Promise<MCPOAuthLoginStart> {
	const serverUrl = options.serverUrl.toString();
	const store = new MCPOAuthCredentialStore(serverUrl);

	const challenge = await probeAuthChallenge(serverUrl, options.headers ?? {});

	let serverInfo: Awaited<ReturnType<typeof discoverOAuthServerInfo>>;
	try {
		serverInfo = await discoverOAuthServerInfo(serverUrl, {
			resourceMetadataUrl: challenge.resourceMetadataUrl,
			fetchFn: oauthFetch,
		});
	} catch (error) {
		throw new Error(
			`MCP OAuth metadata discovery failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const metadata = serverInfo.authorizationServerMetadata;
	if (!metadata) {
		throw new Error(
			'MCP OAuth metadata discovery failed: the authorization server metadata is unavailable',
		);
	}
	const supportsClientMetadata =
		(metadata as {client_id_metadata_document_supported?: unknown})
			.client_id_metadata_document_supported === true;
	const supportsDynamicRegistration = Boolean(metadata.registration_endpoint);
	if (
		!supportsClientMetadata &&
		!supportsDynamicRegistration &&
		!store.read().clientInformation
	) {
		throw new Error(
			`MCP OAuth failed: the authorization server of ${options.serviceName} supports neither client ID metadata documents nor dynamic client registration`,
		);
	}

	resetSessionsForService(options.serviceName);

	const sessionId = randomBytes(12).toString('hex');
	let session: LoginSession | undefined;
	let provider: SnowMCPOAuthProvider | undefined;

	const server = createServer((req, res) => {
		void handleCallback(req.url ?? '/').then(({status, body}) => {
			res.statusCode = status;
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.setHeader('Connection', 'close');
			res.end(renderPage(body));
		});
	});

	const handleCallback = async (
		target: string,
	): Promise<{status: number; body: string}> => {
		const url = new URL(target, 'http://127.0.0.1');
		if (url.pathname !== '/callback') {
			return {status: 404, body: failureBody()};
		}
		if (!session || !provider || session.status !== 'pending') {
			return {status: 400, body: failureBody()};
		}

		const params = url.searchParams;
		const errorCode = params.get('error');
		if (errorCode) {
			const description = params.get('error_description')?.trim();
			finishSession(
				session,
				'error',
				`Authorization failed: ${description || errorCode}`,
			);
			return {status: 400, body: failureBody()};
		}

		const expectedState = provider.expectedState;
		if (expectedState && params.get('state') !== expectedState) {
			finishSession(session, 'error', 'Authorization failed: state mismatch');
			return {status: 400, body: failureBody()};
		}

		const code = params.get('code');
		if (!code) {
			finishSession(
				session,
				'error',
				'Authorization failed: the callback contained no authorization code',
			);
			return {status: 400, body: failureBody()};
		}

		try {
			const result = await auth(provider, {
				serverUrl,
				authorizationCode: code,
				iss: params.get('iss') ?? undefined,
				resourceMetadataUrl: challenge.resourceMetadataUrl,
				scope: challenge.scope,
				fetchFn: oauthFetch,
			});
			if (result !== 'AUTHORIZED') {
				throw new Error(`unexpected authorization result: ${result}`);
			}
			finishSession(session, 'success');
			log.info(`MCP OAuth authorization completed for ${serverUrl}`);
			return {status: 200, body: successBody()};
		} catch (error) {
			finishSession(
				session,
				'error',
				error instanceof Error ? error.message : String(error),
			);
			return {status: 400, body: failureBody()};
		}
	};

	const port = await bindCallbackServer(server, supportsClientMetadata);
	const redirectUrl = `http://127.0.0.1:${port}/callback`;

	let authorizationUrl: URL | undefined;
	provider = new SnowMCPOAuthProvider(store, {
		redirectUrl,
		interactive: true,
		onRedirect: url => {
			authorizationUrl = url;
		},
	});
	// 复用本次的发现结果，SDK 在回调阶段据此校验授权服务器未被替换。
	provider.saveDiscoveryState({
		...serverInfo,
		resourceMetadataUrl: challenge.resourceMetadataUrl?.toString(),
	});

	try {
		await auth(provider, {
			serverUrl,
			resourceMetadataUrl: challenge.resourceMetadataUrl,
			scope: challenge.scope,
			fetchFn: oauthFetch,
			forceReauthorization: true,
		});
	} catch (error) {
		server.close();
		throw new Error(
			`MCP OAuth client registration failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (!authorizationUrl) {
		server.close();
		throw new Error('MCP OAuth failed: no authorization URL was produced');
	}

	session = {
		serviceName: options.serviceName,
		status: 'pending',
		server,
		timer: setTimeout(() => {
			if (session) {
				finishSession(session, 'error', 'OAuth authorization timed out');
			}
		}, LOGIN_TIMEOUT_MS),
	};
	session.timer.unref?.();
	loginSessions.set(sessionId, session);

	return {sessionId, authUrl: authorizationUrl.toString()};
}

/** 读取登录会话状态；会话不存在时返回 null。 */
export function getMCPOAuthLoginStatus(
	sessionId: string,
): MCPOAuthLoginSnapshot | null {
	const session = loginSessions.get(sessionId);
	if (!session) {
		return null;
	}
	return {status: session.status, error: session.error};
}

/** 取消仍在等待的登录会话；已结束的会话返回 false。 */
export function cancelMCPOAuthLogin(sessionId: string): boolean {
	const session = loginSessions.get(sessionId);
	if (!session || session.status !== 'pending') {
		return false;
	}
	finishSession(session, 'cancelled');
	return true;
}

// ============================================================================
// 回调页面
// ============================================================================

function renderPage(body: string): string {
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snow CLI</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0f1115; color: #e8eaed; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
main { max-width: 420px; padding: 40px 32px; text-align: center; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
p { font-size: 13px; line-height: 1.7; color: #9aa0a6; margin: 6px 0; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function successBody(): string {
	return `<h1>Authorization complete</h1>
<p>You can close this window and return to Snow CLI.</p>
<p>授权已完成，可以关闭此窗口并返回 Snow CLI。</p>`;
}

function failureBody(): string {
	return `<h1>Authorization failed</h1>
<p>Return to Snow CLI and start the sign-in again.</p>
<p>授权失败，请返回 Snow CLI 重新发起授权。</p>`;
}
