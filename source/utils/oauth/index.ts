/**
 * OAuth 模块入口：订阅账号登录与 Snow AI Router 渠道接入。
 */

export {
	OAUTH_PROVIDERS,
	OAUTH_PROVIDER_ORDER,
	SNOW_ROUTER_DEFAULT_URL,
	parseOAuthProviderId,
	isOAuthProviderId,
	resolveSnowRouterServerUrl,
} from './constants.js';
export type {OAuthProviderDefinition} from './constants.js';
export type {
	OAuthClaims,
	OAuthLoginOutcome,
	OAuthLoginStartResult,
	OAuthLoginStatus,
	OAuthLoginStatusView,
	OAuthProfileDraft,
	OAuthProfileMetadata,
	OAuthProviderId,
	OAuthRouterChannel,
	OAuthTokenSet,
} from './types.js';
export {
	cancelOAuthLogin,
	disposeOAuthSessions,
	finalizeSnowRouterLogin,
	getActiveOAuthSessionCount,
	getOAuthLoginStatus,
	parseCallbackInput,
	startOAuthLogin,
	submitOAuthCallback,
} from './loginManager.js';
export {
	activateOAuthProfile,
	applyOAuthProviderHeaders,
	isOAuthConfig,
	refreshOAuthTokenIfNeeded,
	TOKEN_REFRESH_LEEWAY_SECS,
} from './profileStore.js';
export {openExternalUrl} from './openBrowser.js';
export {
	bindLegacyOAuthProfilesOnce,
	ensureProviderHeaderScheme,
	providerHeaderSchemeName,
	providerRequiredHeaders,
} from './headerSchemes.js';
