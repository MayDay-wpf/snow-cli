import * as vscode from 'vscode';

export type TerminalProxyEnv = Record<string, string>;

function asOptionalNonEmptyString(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function getConfiguredSnowTerminalProxyUrl(): string | undefined {
	const configuredProxy = vscode.workspace
		.getConfiguration('snow-cli.terminal')
		.get<string>('proxyUrl', '');

	return asOptionalNonEmptyString(configuredProxy);
}

function getVsCodeHttpProxyUrl(): string | undefined {
	const vscodeProxy = vscode.workspace.getConfiguration('http').get<string>('proxy', '');
	return asOptionalNonEmptyString(vscodeProxy);
}

export function hasExplicitSnowTerminalProxyUrl(): boolean {
	return typeof getConfiguredSnowTerminalProxyUrl() !== 'undefined';
}

export function getSnowTerminalProxyUrl(): string | undefined {
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
