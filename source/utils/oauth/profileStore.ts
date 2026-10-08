/**
 * OAuth 档案落盘与运行期凭据维护：
 * - 登录成功后生成/更新 snow-cli profile（含 oauth 元数据）
 * - 请求前按需刷新 access token，并回写 profile / config.json
 * - 为请求注入 provider 专属请求头
 */

import {
	clearConfigCache,
	loadConfig,
	saveConfig,
	type ApiConfig,
	type AppConfig,
} from '../config/apiConfig.js';
import {
	getActiveProfileName,
	getAllProfiles,
	loadProfile,
	saveProfile,
	switchProfile,
} from '../config/configManager.js';
import {OAUTH_PROVIDERS} from './constants.js';
import {applyProviderRequestHeaders, refreshTokens} from './flows.js';
import type {
	OAuthClaims,
	OAuthLoginOutcome,
	OAuthProfileDraft,
	OAuthProfileMetadata,
	OAuthProviderId,
	OAuthTokenSet,
} from './types.js';
import {nowEpochSecs} from './utils.js';

/** access token 提前刷新的安全余量（秒），与 Snow App 一致 */
export const TOKEN_REFRESH_LEEWAY_SECS = 120;

export function isOAuthConfig(config: ApiConfig | undefined | null): boolean {
	return !!config?.oauth?.provider;
}

/**
 * 选择默认模型：优先用户配置，其次上游返回的第一个模型，最后 provider 默认值。
 * 与 Snow App 的 pick_model 一致。
 */
export function pickModel(
	provider: OAuthProviderId,
	configured: string,
	available: string[],
): string {
	const trimmed = configured.trim();
	if (trimmed) {
		return trimmed;
	}
	if (available.length > 0 && available[0]) {
		return available[0];
	}
	return OAUTH_PROVIDERS[provider].defaultModel;
}

function sanitizeProfileSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, '')
		.slice(0, 48);
}

function buildProfileName(
	provider: OAuthProviderId,
	claims: OAuthClaims,
): string {
	const email = claims.email.trim();
	if (email) {
		const local = email.split('@')[0] ?? email;
		const sanitized = sanitizeProfileSegment(local);
		if (sanitized) {
			return `${provider}-${sanitized}`;
		}
	}
	const account = claims.accountId.trim();
	if (account) {
		const short = sanitizeProfileSegment(account.slice(0, 8));
		if (short) {
			return `${provider}-${short}`;
		}
	}
	return provider;
}

function buildDisplayName(
	provider: OAuthProviderId,
	claims: OAuthClaims,
): string {
	const email = claims.email.trim();
	if (email) {
		return `${OAUTH_PROVIDERS[provider].displayName} (${email})`;
	}
	const account = claims.accountId.trim();
	if (account) {
		return `${OAUTH_PROVIDERS[provider].displayName} (${account.slice(0, 8)})`;
	}
	return OAUTH_PROVIDERS[provider].displayName;
}

export function buildProfileDraft(
	provider: OAuthProviderId,
	claims: OAuthClaims,
	tokens: OAuthTokenSet,
	advancedModel: string,
	basicModel: string,
): OAuthProfileDraft {
	const def = OAUTH_PROVIDERS[provider];
	const metadata: OAuthProfileMetadata = {
		provider,
		refreshToken: tokens.refreshToken,
		accountId: claims.accountId,
		email: claims.email,
		planType: claims.planType,
		expiresAt: tokens.expiresAt,
		obtainedAt: nowEpochSecs(),
	};
	return {
		profileName: buildProfileName(provider, claims),
		displayName: buildDisplayName(provider, claims),
		patch: {
			baseUrl: def.backendBaseUrl,
			baseUrlMode: 'auto',
			apiKey: tokens.accessToken,
			requestMethod: def.requestMethod,
			advancedModel,
			basicModel,
			supportsVision: def.supportsVision,
			maxContextTokens: def.maxContextTokens,
			oauth: metadata,
		},
	};
}

/**
 * 保存 OAuth 档案：已存在则在其现有配置上合并，否则以当前配置为基线新建。
 * 不切换 active profile（由面板在用户确认后调用 activateOAuthProfile）。
 */
export function saveOAuthProfile(draft: OAuthProfileDraft): OAuthLoginOutcome {
	const existing = loadProfile(draft.profileName);
	const base: AppConfig = existing ?? loadConfig();
	const updated: AppConfig = {
		...base,
		snowcfg: {
			...base.snowcfg,
			...draft.patch,
		},
	};
	saveProfile(draft.profileName, updated);

	return {
		provider: draft.patch.oauth.provider,
		profileName: draft.profileName,
		displayName: draft.displayName,
		email: draft.patch.oauth.email,
		planType: draft.patch.oauth.planType,
		accountId: draft.patch.oauth.accountId,
		availableModels: [],
		expiresAt: draft.patch.oauth.expiresAt,
	};
}

/**
 * 切换到指定档案：
 * 1) switchProfile 落盘（config.json + active-profile.json）并清理 agent 缓存
 * 2) 清空运行期配置缓存并重新加载，确保当前进程立即使用新配置（无需重启）
 * 3) 校验切换结果与 config.json 同步，避免静默使用旧配置
 */
export function activateOAuthProfile(profileName: string): void {
	switchProfile(profileName);

	// switchProfile 内部通过 saveConfig 落盘并清空缓存；这里再显式清空并重载，
	// 保证后续 getSnowConfig()/loadConfig() 读到的是新档案（运行期即时生效）。
	clearConfigCache();
	const runtimeConfig = loadConfig();

	const activeName = getActiveProfileName();
	if (activeName !== profileName) {
		throw new Error(
			`Profile switch did not take effect: active profile is "${activeName}" (expected "${profileName}")`,
		);
	}

	const profileConfig = loadProfile(profileName);
	if (
		profileConfig &&
		runtimeConfig.snowcfg.apiKey !== profileConfig.snowcfg.apiKey
	) {
		throw new Error(
			'Profile switched but config.json is out of sync; please retry or restart Snow CLI',
		);
	}
}

/**
 * 请求前按需刷新 access token：
 * - 未配置 oauth 或未临近过期时直接返回
 * - 刷新成功后就地更新 config.apiKey / config.oauth，并回写 profile / config.json
 * - 刷新失败不抛出，保持旧 token（与 Snow App 行为一致，交由上游报错）
 */
export async function refreshOAuthTokenIfNeeded(
	config: ApiConfig,
): Promise<void> {
	const metadata = config.oauth;
	if (!metadata || !metadata.refreshToken.trim()) {
		return;
	}
	if (metadata.expiresAt > nowEpochSecs() + TOKEN_REFRESH_LEEWAY_SECS) {
		return;
	}

	let tokens: OAuthTokenSet;
	try {
		tokens = await refreshTokens(metadata.provider, metadata.refreshToken);
	} catch (error) {
		// 保留旧 token，让上游请求自行返回 401，避免静默失败难以排查
		console.error(
			`[oauth] token refresh failed for ${metadata.provider}:`,
			error instanceof Error ? error.message : error,
		);
		return;
	}

	const updatedMetadata: OAuthProfileMetadata = {
		provider: metadata.provider,
		refreshToken: tokens.refreshToken.trim() || metadata.refreshToken,
		accountId: tokens.projectId.trim() || metadata.accountId,
		email: tokens.email.trim() || metadata.email,
		planType: tokens.planType.trim() || metadata.planType,
		expiresAt: tokens.expiresAt,
		obtainedAt: metadata.obtainedAt,
	};

	// 就地更新运行期配置，后续请求使用新 token
	config.apiKey = tokens.accessToken;
	config.oauth = updatedMetadata;
	persistRefreshedOAuth(config, updatedMetadata, metadata.refreshToken);
}

/**
 * 把刷新后的 token 回写到对应 profile：
 * 以 refreshToken + provider 匹配档案（refresh token 具备唯一性），
 * 匹配到 active profile 时同时同步 config.json。
 */
function persistRefreshedOAuth(
	config: ApiConfig,
	metadata: OAuthProfileMetadata,
	previousRefreshToken: string,
): void {
	try {
		const activeName = getActiveProfileName();
		const profiles = getAllProfiles();
		let matched: AppConfig | undefined;
		let matchedName: string | undefined;
		for (const profile of profiles) {
			const oauth = profile.config.snowcfg?.oauth;
			if (
				oauth &&
				oauth.provider === metadata.provider &&
				oauth.refreshToken === previousRefreshToken
			) {
				matched = profile.config;
				matchedName = profile.name;
				break;
			}
		}

		if (!matched || !matchedName) {
			return;
		}

		const updatedConfig: AppConfig = {
			...matched,
			snowcfg: {
				...matched.snowcfg,
				apiKey: config.apiKey,
				oauth: metadata,
			},
		};
		saveProfile(matchedName, updatedConfig);

		if (matchedName === activeName) {
			saveConfig(updatedConfig);
		}
	} catch (error) {
		console.error(
			'[oauth] failed to persist refreshed token:',
			error instanceof Error ? error.message : error,
		);
	}
}

/**
 * 为请求注入 OAuth 专属请求头（同步；请在设置 Authorization 之后调用）。
 */
export function applyOAuthProviderHeaders(
	config: ApiConfig,
	headers: Record<string, string>,
): void {
	const metadata = config.oauth;
	if (!metadata) {
		return;
	}
	applyProviderRequestHeaders(metadata, headers);
}
