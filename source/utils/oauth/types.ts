/**
 * OAuth 登录类型定义（对齐 Snow App 的 4 种订阅账号登录方式）。
 *
 * 四种登录方式：
 * - codex：ChatGPT（Codex CLI 同款 OAuth）
 * - anthropic：Anthropic（Claude，Claude Code 同款 OAuth）
 * - antigravity：Antigravity（Google，Cloud Code Assist）
 * - xai：xAI（Grok）
 */

export type OAuthProviderId = 'codex' | 'anthropic' | 'antigravity' | 'xai';

export interface OAuthPkceCodes {
	verifier: string;
	challenge: string;
}

/** 一次 OAuth 登录/刷新拿到的令牌集合 */
export interface OAuthTokenSet {
	accessToken: string;
	refreshToken: string;
	idToken: string;
	email: string;
	planType: string;
	projectId: string;
	/** access token 过期时间（epoch 秒） */
	expiresAt: number;
}

/** 从 id_token / 用户信息接口解析出的账号信息 */
export interface OAuthClaims {
	email: string;
	accountId: string;
	planType: string;
}

/**
 * 存储于 snowcfg.oauth 的档案元数据：
 * 用于 access token 过期后自动刷新，以及为请求注入 provider 专属请求头。
 */
export interface OAuthProfileMetadata {
	provider: OAuthProviderId;
	refreshToken: string;
	/** Codex 的 chatgpt-account-id / Antigravity 的 project id */
	accountId: string;
	email: string;
	planType: string;
	/** access token 过期时间（epoch 秒） */
	expiresAt: number;
	obtainedAt: number;
}

export type OAuthLoginStatus = 'pending' | 'success' | 'error' | 'cancelled';

/** 登录成功后生成的档案信息 */
export interface OAuthLoginOutcome {
	provider: OAuthProviderId;
	profileName: string;
	displayName: string;
	email: string;
	planType: string;
	accountId: string;
	availableModels: string[];
	expiresAt: number;
}

/** startOAuthLogin 的返回结果（面板据此展示授权链接） */
export interface OAuthLoginStartResult {
	sessionId: string;
	provider: OAuthProviderId;
	authUrl: string;
	port: number;
	/** true 表示本地回调端口不可用，需要用户手动粘贴回调地址/授权码 */
	manualMode: boolean;
	defaultModel: string;
}

/** 面板轮询的登录状态 */
export interface OAuthLoginStatusView {
	provider: OAuthProviderId;
	status: OAuthLoginStatus;
	error?: string;
	outcome?: OAuthLoginOutcome;
	authUrl: string;
	manualMode: boolean;
}

/** 写入 snowcfg 的档案配置（由 provider 定义生成） */
export interface OAuthProfileDraft {
	profileName: string;
	displayName: string;
	/** 与 snowcfg 同构的字段补丁 */
	patch: {
		baseUrl: string;
		baseUrlMode: 'auto' | 'base' | 'endpoint';
		apiKey: string;
		requestMethod: 'chat' | 'responses' | 'gemini' | 'anthropic';
		advancedModel: string;
		basicModel: string;
		supportsVision: boolean;
		maxContextTokens: number;
		oauth: OAuthProfileMetadata;
	};
}
