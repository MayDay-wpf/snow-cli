/**
 * 五种 OAuth 登录方式的静态注册表。
 *
 * 常量与 Snow App（native/src/api/oauth/*.rs）保持一一对应，
 * 保证两种客户端登录到同一批上游账号。
 */

import type {OAuthProviderId} from './types.js';

export interface OAuthProviderDefinition {
	id: OAuthProviderId;
	/** 面板中的展示名 */
	displayName: string;
	/** 面板中的一句话描述（i18n 缺失时的兜底英文说明） */
	description: string;
	clientId: string;
	/** Google 系（antigravity）需要 client_secret；其它 provider 为空 */
	clientSecret: string;
	authorizeUrl: string;
	tokenUrl: string;
	/** 授权 scope（空格分隔） */
	scope: string;
	/** 刷新 token 时使用的 scope（部分 provider 与授权 scope 不同） */
	refreshScope: string;
	callbackPath: string;
	callbackPorts: number[];
	redirectHost: string;
	defaultModel: string;
	maxContextTokens: number;
	backendBaseUrl: string;
	requestMethod: 'chat' | 'responses' | 'gemini' | 'anthropic';
	supportsVision: boolean;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderDefinition> =
	{
		codex: {
			id: 'codex',
			displayName: 'ChatGPT Codex',
			description: 'Sign in with your ChatGPT subscription (Codex)',
			clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
			clientSecret: '',
			authorizeUrl: 'https://auth.openai.com/oauth/authorize',
			tokenUrl: 'https://auth.openai.com/oauth/token',
			scope: 'openid email profile offline_access',
			refreshScope: 'openid profile email',
			callbackPath: '/auth/callback',
			callbackPorts: [1455, 1457],
			redirectHost: '127.0.0.1',
			defaultModel: 'gpt-5.2-codex',
			maxContextTokens: 400000,
			backendBaseUrl: 'https://chatgpt.com/backend-api/codex',
			requestMethod: 'responses',
			supportsVision: true,
		},
		chatgpt: {
			id: 'chatgpt',
			displayName: 'ChatGPT',
			description: 'Sign in with your ChatGPT account (OpenAI API)',
			// 占位 client_id：真正的 client_id 由授权回调动态下发（见 CHATGPT_* 常量）
			clientId: 'dynamic_agent_client',
			clientSecret: '',
			authorizeUrl: 'https://auth.openai.com/api/accounts/authorize',
			tokenUrl: 'https://auth.openai.com/api/accounts/oauth/token',
			scope:
				'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
			// chatgpt 刷新 token 走 resource 参数而非 scope，这里留空
			refreshScope: '',
			callbackPath: '/auth/callback',
			callbackPorts: [1455, 1457],
			redirectHost: '127.0.0.1',
			defaultModel: 'gpt-5.2',
			maxContextTokens: 400000,
			backendBaseUrl: 'https://api.openai.com/v1',
			requestMethod: 'responses',
			supportsVision: true,
		},
		anthropic: {
			id: 'anthropic',
			displayName: 'Anthropic (Claude)',
			description: 'Sign in with your Claude subscription',
			clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
			clientSecret: '',
			authorizeUrl: 'https://claude.ai/oauth/authorize',
			tokenUrl: 'https://platform.claude.com/v1/oauth/token',
			scope:
				'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
			refreshScope:
				'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
			callbackPath: '/callback',
			callbackPorts: [54545],
			redirectHost: 'localhost',
			defaultModel: 'claude-sonnet-4-6',
			maxContextTokens: 200000,
			backendBaseUrl: 'https://api.anthropic.com/v1',
			requestMethod: 'anthropic',
			supportsVision: true,
		},
		antigravity: {
			id: 'antigravity',
			displayName: 'Antigravity (Google)',
			description: 'Sign in with your Google account (Cloud Code Assist)',
			clientId:
				'1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
			clientSecret: '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',
			authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
			tokenUrl: 'https://oauth2.googleapis.com/token',
			scope:
				'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs',
			refreshScope:
				'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs',
			callbackPath: '/oauth-callback',
			callbackPorts: [51121],
			redirectHost: 'localhost',
			defaultModel: 'gemini-3-pro-high',
			maxContextTokens: 1000000,
			backendBaseUrl: 'https://cloudcode-pa.googleapis.com',
			requestMethod: 'gemini',
			supportsVision: true,
		},
		xai: {
			id: 'xai',
			displayName: 'xAI (Grok)',
			description: 'Sign in with your xAI / Grok account',
			clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
			clientSecret: '',
			authorizeUrl: 'https://auth.x.ai/oauth2/authorize',
			tokenUrl: 'https://auth.x.ai/oauth2/token',
			scope: 'openid profile email offline_access grok-cli:access api:access',
			refreshScope:
				'openid profile email offline_access grok-cli:access api:access',
			callbackPath: '/callback',
			callbackPorts: [56121],
			redirectHost: '127.0.0.1',
			defaultModel: 'grok-4.5',
			maxContextTokens: 500000,
			backendBaseUrl: 'https://api.x.ai/v1',
			requestMethod: 'responses',
			supportsVision: true,
		},
	};

/** 面板展示顺序（与 Snow App 保持一致） */
export const OAUTH_PROVIDER_ORDER: OAuthProviderId[] = [
	'codex',
	'chatgpt',
	'anthropic',
	'antigravity',
	'xai',
];

export function isOAuthProviderId(value: unknown): value is OAuthProviderId {
	return (
		value === 'codex' ||
		value === 'chatgpt' ||
		value === 'anthropic' ||
		value === 'antigravity' ||
		value === 'xai'
	);
}

export function parseOAuthProviderId(value: string): OAuthProviderId | null {
	const normalized = value.trim().toLowerCase();
	return isOAuthProviderId(normalized) ? normalized : null;
}

// ---------------------------------------------------------------------------
// Codex 专属常量
// ---------------------------------------------------------------------------

export const CODEX_ORIGINATOR = 'codex_cli_rs';
export const CODEX_CLIENT_VERSION = '0.159.0';

export function codexUserAgent(): string {
	const os = process.platform === 'win32' ? 'windows' : process.platform;
	return `codex_cli_rs/${CODEX_CLIENT_VERSION} (${os}; ${process.arch})`;
}

// ---------------------------------------------------------------------------
// ChatGPT（OpenAI API，动态注册客户端）专属常量
// ---------------------------------------------------------------------------

/** 授权时声明的 agent 名称（上游据此登记动态客户端） */
export const CHATGPT_AGENT_NAME_HINT = 'Snow CLI';
/** 授权 / 换 token / 刷新 token 时必须携带的 resource */
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
/** 只有包含该 scope 才代表账号已授权 ChatGPT 套餐用量 */
export const CHATGPT_PLAN_SCOPE = 'chatgpt.tokens.use.direct';
/** 本地持久化 ext_agent_host_id 的文件名（位于 Snow 配置目录） */
export const CHATGPT_HOST_ID_FILE_NAME = 'chatgpt-host.json';

// ---------------------------------------------------------------------------
// Anthropic 专属常量
// ---------------------------------------------------------------------------

export const ANTHROPIC_VERSION_HEADER = '2023-06-01';
export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';
/** 与 Claude Code 客户端一致的 token 请求头 */
export const ANTHROPIC_TOKEN_USER_AGENT = 'axios/1.15.2';

// ---------------------------------------------------------------------------
// Antigravity 专属常量
// ---------------------------------------------------------------------------

export const ANTIGRAVITY_CLI_VERSION = '1.0.13';
export const ANTIGRAVITY_CLI_CLIENT_NAME = 'aidev_client';
export const ANTIGRAVITY_API_CLIENT =
	'google-cloud-sdk vscode_cloudshelleditor/0.1';
export const ANTIGRAVITY_USERINFO_URL =
	'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
export const ANTIGRAVITY_CODE_ASSIST_HOSTS: string[] = [
	'https://cloudcode-pa.googleapis.com',
	'https://daily-cloudcode-pa.googleapis.com',
	'https://daily-cloudcode-pa.sandbox.googleapis.com',
];
export const ANTIGRAVITY_PREFERRED_MODELS: string[] = [
	'gemini-3.1-pro-high',
	'gemini-3-pro-high',
	'gemini-3-pro-low',
	'gemini-3.1-pro-low',
	'gemini-3-flash',
	'gemini-2.5-flash',
	'gemini-2.5-flash-thinking',
	'claude-sonnet-4-6',
	'claude-opus-4-6-thinking',
];

export function antigravityUserAgent(): string {
	const os =
		process.platform === 'darwin'
			? 'darwin'
			: process.platform === 'win32'
			? 'windows'
			: process.platform;
	const arch =
		process.arch === 'arm64'
			? 'arm64'
			: process.arch === 'x64'
			? 'amd64'
			: process.arch;
	return `antigravity/cli/${ANTIGRAVITY_CLI_VERSION} (${ANTIGRAVITY_CLI_CLIENT_NAME}; os_type=${os}; arch=${arch})`;
}
