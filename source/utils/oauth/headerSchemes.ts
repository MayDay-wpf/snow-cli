/**
 * 订阅档案的固定身份请求头由「自定义请求头方案」承载，而不是写死在请求代码里。
 *
 * 与 Snow App（native/src/api/oauth/header_schemes.rs）保持一致：
 * 登录时按提供方约定的方案名（Codex / Claude / Antigravity）查找同名方案，
 * 已存在则逐个检查必需请求头 —— 缺失的补齐，已有的（含用户改过的值与额外添加的
 * 请求头）保持不动；不存在则新建。随后把档案绑定到该方案，应用提供默认值，
 * 用户也可在设置中自行调整。
 */

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {
	getActiveProfileName,
	getAllProfiles,
	saveProfile,
} from '../config/configManager.js';
import {
	getCustomHeadersConfig,
	resolveSnowConfigDir,
	saveConfig,
	saveCustomHeadersConfig,
	type CustomHeadersConfig,
	type CustomHeadersItem,
} from '../config/apiConfig.js';
import {
	ANTHROPIC_CLI_USER_AGENT,
	ANTHROPIC_MESSAGES_BETA,
	ANTHROPIC_VERSION_HEADER,
	ANTIGRAVITY_API_CLIENT,
	CODEX_ORIGINATOR,
	antigravityUserAgent,
	codexUserAgent,
} from './constants.js';
import type {OAuthProviderId} from './types.js';

/** 一次性迁移标记文件（位于 Snow 配置目录） */
const LEGACY_BINDING_MARKER_FILE = 'oauth-header-scheme-migration.json';

/** provider 专属方案名；返回 null 表示该 provider 没有固定身份请求头 */
export function providerHeaderSchemeName(
	provider: OAuthProviderId,
): string | null {
	switch (provider) {
		case 'codex':
			return 'Codex';
		case 'anthropic':
			return 'Claude';
		case 'antigravity':
			return 'Antigravity';
		case 'chatgpt':
		case 'xai':
			return null;
	}
}

/**
 * provider 会话请求必需的固定身份请求头，作为默认值写入该 provider 的请求头方案。
 * 账号级动态请求头（chatgpt-account-id、Authorization）不在这里，仍由请求时注入。
 */
export function providerRequiredHeaders(
	provider: OAuthProviderId,
): Array<[string, string]> {
	switch (provider) {
		case 'codex':
			return [
				['originator', CODEX_ORIGINATOR],
				['OpenAI-Beta', 'responses=experimental'],
				['User-Agent', codexUserAgent()],
			];
		case 'anthropic':
			// 订阅令牌按 Claude Code 客户端的形状请求：beta 串必须同时声明
			// claude-code-20250219，并携带 CLI 的 User-Agent、x-app 与直接浏览器
			// 访问声明，否则网关不把请求当作官方订阅客户端。
			return [
				['anthropic-version', ANTHROPIC_VERSION_HEADER],
				['anthropic-beta', ANTHROPIC_MESSAGES_BETA],
				['anthropic-dangerous-direct-browser-access', 'true'],
				['x-app', 'cli'],
				['User-Agent', ANTHROPIC_CLI_USER_AGENT],
			];
		case 'antigravity':
			return [
				['User-Agent', antigravityUserAgent()],
				['x-goog-api-client', ANTIGRAVITY_API_CLIENT],
			];
		case 'chatgpt':
		case 'xai':
			return [];
	}
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	return Object.keys(headers).some(
		existing => existing.trim().toLowerCase() === name.trim().toLowerCase(),
	);
}

function normalizeHeaders(
	headers: Record<string, string> | undefined,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers ?? {})) {
		const name = key.trim();
		if (name && typeof value === 'string') {
			result[name] = value;
		}
	}
	return result;
}

function nextSchemeId(config: CustomHeadersConfig | null): string {
	const used = new Set((config?.schemes ?? []).map(scheme => scheme.id));
	let candidate = Date.now();
	while (used.has(String(candidate))) {
		candidate += 1;
	}
	return String(candidate);
}

/**
 * 确保 provider 的请求头方案存在且包含全部必需请求头，返回方案 id。
 * provider 没有固定身份请求头时返回 null，档案保持原有绑定。
 */
export function ensureProviderHeaderScheme(
	provider: OAuthProviderId,
): string | null {
	const schemeName = providerHeaderSchemeName(provider);
	const required = providerRequiredHeaders(provider);
	if (!schemeName || required.length === 0) {
		return null;
	}

	const stored = getCustomHeadersConfig();
	const schemes = Array.isArray(stored?.schemes) ? [...stored.schemes] : [];
	const existingIndex = schemes.findIndex(
		scheme =>
			(scheme?.name ?? '').trim().toLowerCase() === schemeName.toLowerCase(),
	);
	const existing = existingIndex >= 0 ? schemes[existingIndex] : undefined;

	const headers = normalizeHeaders(existing?.headers);
	let changed = !existing;
	for (const [name, value] of required) {
		if (!hasHeader(headers, name)) {
			headers[name] = value;
			changed = true;
		}
	}

	const schemeId = existing?.id ?? nextSchemeId(stored);
	if (changed) {
		const scheme: CustomHeadersItem = {
			id: schemeId,
			name: existing?.name ?? schemeName,
			headers,
			createdAt: existing?.createdAt ?? new Date().toISOString(),
		};
		if (existingIndex >= 0) {
			schemes[existingIndex] = scheme;
		} else {
			schemes.push(scheme);
		}
		saveCustomHeadersConfig({active: stored?.active ?? '', schemes});
	}

	return schemeId;
}

let legacyBindingChecked = false;

/**
 * 旧版本的订阅档案未绑定请求头方案（身份请求头曾写死在请求代码中）。
 * 每个配置目录只迁移一次：为仍是空绑定（跟随全局方案 / 未设置）的订阅档案
 * 补建方案并绑定；迁移完成后用户再把档案改回空绑定也不会被覆盖。
 */
export function bindLegacyOAuthProfilesOnce(): void {
	if (legacyBindingChecked) {
		return;
	}
	legacyBindingChecked = true;

	const configDir = resolveSnowConfigDir();
	const markerPath = join(configDir, LEGACY_BINDING_MARKER_FILE);
	try {
		if (existsSync(markerPath)) {
			return;
		}
	} catch {
		// 读取失败按未迁移处理
	}

	try {
		const activeName = getActiveProfileName();
		for (const profile of getAllProfiles()) {
			const snowcfg = profile.config.snowcfg;
			const provider = snowcfg?.oauth?.provider;
			if (!provider) {
				continue;
			}
			const current = snowcfg.customHeadersSchemeId;
			if (typeof current === 'string' && current.trim() !== '') {
				continue;
			}

			const schemeId = ensureProviderHeaderScheme(provider);
			if (!schemeId) {
				continue;
			}

			const updatedConfig = {
				...profile.config,
				snowcfg: {...snowcfg, customHeadersSchemeId: schemeId},
			};
			saveProfile(profile.name, updatedConfig);
			if (profile.name === activeName) {
				// 迁移的是当前生效档案时同步 config.json，保证下一次请求立即带上方案头
				saveConfig(updatedConfig);
			}
		}

		mkdirSync(configDir, {recursive: true});
		writeFileSync(
			markerPath,
			JSON.stringify({migratedAt: new Date().toISOString()}, null, 2),
			'utf8',
		);
	} catch (error) {
		console.error(
			'[oauth] failed to bind custom header schemes to legacy profiles:',
			error instanceof Error ? error.message : error,
		);
	}
}
