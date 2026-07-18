import * as vscode from 'vscode';

export type TerminalProxyEnv = Record<string, string>;

function asOptionalNonEmptyString(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

/**
 * The literal string "null" (case-insensitive) is treated as an explicit
 * signal to disable the proxy entirely — no inheritance from VS Code and
 * no proxy environment variables injected.
 */
const DISABLE_KEYWORD = 'null';

function getRawConfiguredProxyUrl(): string {
	return vscode.workspace
		.getConfiguration('snow-cli.terminal')
		.get<string>('proxyUrl', '');
}

function isProxyExplicitlyDisabled(): boolean {
	return getRawConfiguredProxyUrl().trim().toLowerCase() === DISABLE_KEYWORD;
}

function getConfiguredSnowTerminalProxyUrl(): string | undefined {
	if (isProxyExplicitlyDisabled()) {
		return undefined;
	}
	return asOptionalNonEmptyString(getRawConfiguredProxyUrl());
}

function getVsCodeHttpProxyUrl(): string | undefined {
	const vscodeProxy = vscode.workspace.getConfiguration('http').get<string>('proxy', '');
	return asOptionalNonEmptyString(vscodeProxy);
}

/**
 * Returns true when the user has explicitly set `snow-cli.terminal.proxyUrl`
 * to any non-empty value — including the "null" disable keyword.
 * This is used to decide whether `http.proxy` changes should trigger a
 * terminal restart (only when the user is NOT explicitly configured).
 */
export function hasExplicitSnowTerminalProxyUrl(): boolean {
	return getRawConfiguredProxyUrl().trim().length > 0;
}

export function getSnowTerminalProxyUrl(): string | undefined {
	if (isProxyExplicitlyDisabled()) {
		return undefined;
	}
	return getConfiguredSnowTerminalProxyUrl() ?? getVsCodeHttpProxyUrl();
}

export function getSnowTerminalProxyEnv(): TerminalProxyEnv | undefined {
	const proxyUrl = getSnowTerminalProxyUrl();
	if (!proxyUrl) {
		return undefined;
	}

	return {
		HTTP_PROXY: proxyUrl,
		HTTPS_PROXY: proxyUrl,
		http_proxy: proxyUrl,
		https_proxy: proxyUrl,
	};
}
