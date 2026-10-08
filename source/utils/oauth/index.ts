/**
 * OAuth 模块入口：对外暴露 4 种订阅账号登录能力。
 */

export {
	OAUTH_PROVIDERS,
	OAUTH_PROVIDER_ORDER,
	parseOAuthProviderId,
	isOAuthProviderId,
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
	OAuthTokenSet,
} from './types.js';
export {
	cancelOAuthLogin,
	disposeOAuthSessions,
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
