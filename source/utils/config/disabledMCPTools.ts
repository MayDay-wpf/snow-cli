import {readSettings, updateSettings} from './unifiedSettings.js';
import type {MCPConfigScope} from './apiConfig.js';

/**
 * 管理单个 MCP 工具的禁用状态
 *
 * Storage:
 *   - 全局: `~/.snow/settings.json` 的 `disabledMCPTools` / `optInMCPTools` 字段
 *   - 项目: `<cwd>/.snow/settings.json` 同名字段
 *
 * （历史上分别存于 `disabled-mcp-tools.json` / `opt-in-mcp-tools.json`，
 *   已自动迁移到 settings.json。）
 *
 * 工具标识格式: "serviceName:toolName"
 */

/** Tools that are off until explicitly enabled (Tab in MCP tools list writes opt-in file). */
const DEFAULT_OPT_IN_DISABLED_KEYS = new Set<string>(['filesystem:edit']);

function readOptInEnabledByScope(scope: MCPConfigScope): string[] {
	try {
		const settings = readSettings(scope);
		return Array.isArray(settings.optInMCPTools) ? settings.optInMCPTools : [];
	} catch {
		return [];
	}
}

function writeOptInEnabledByScope(
	scope: MCPConfigScope,
	enabledTools: string[],
): void {
	updateSettings(scope, settings => {
		settings.optInMCPTools = enabledTools;
	});
}

function readDisabledByScope(scope: MCPConfigScope): string[] {
	try {
		const settings = readSettings(scope);
		return Array.isArray(settings.disabledMCPTools)
			? settings.disabledMCPTools
			: [];
	} catch {
		return [];
	}
}

function writeDisabledByScope(
	scope: MCPConfigScope,
	disabledTools: string[],
): void {
	updateSettings(scope, settings => {
		settings.disabledMCPTools = disabledTools;
	});
}

function makeToolKey(serviceName: string, toolName: string): string {
	return `${serviceName}:${toolName}`;
}

function isDefaultOptInDisabledKey(key: string): boolean {
	return DEFAULT_OPT_IN_DISABLED_KEYS.has(key);
}

/**
 * Merged opt-in enabled tool keys (project ∪ global). Used for cache invalidation.
 */
export function getOptInEnabledMCPKeysMerged(): string[] {
	const g = readOptInEnabledByScope('global');
	const p = readOptInEnabledByScope('project');
	return [...new Set([...g, ...p])];
}

/**
 * 获取合并后的被禁用工具列表（project + global 去重合并）
 */
export function getDisabledMCPTools(): string[] {
	const globalDisabled = readDisabledByScope('global');
	const projectDisabled = readDisabledByScope('project');
	return [...new Set([...globalDisabled, ...projectDisabled])];
}

/**
 * 获取指定作用域的被禁用工具列表
 */
export function getDisabledMCPToolsByScope(scope: MCPConfigScope): string[] {
	return readDisabledByScope(scope);
}

/**
 * 检查某个工具是否启用（不在任何作用域的禁用列表中）
 */
export function isMCPToolEnabled(
	serviceName: string,
	toolName: string,
): boolean {
	const key = makeToolKey(serviceName, toolName);
	if (isDefaultOptInDisabledKey(key)) {
		return getOptInEnabledMCPKeysMerged().includes(key);
	}
	return !getDisabledMCPTools().includes(key);
}

/**
 * 切换工具的启用/禁用状态（在指定作用域中操作）
 */
export function toggleMCPTool(
	serviceName: string,
	toolName: string,
	scope: MCPConfigScope,
): boolean {
	const key = makeToolKey(serviceName, toolName);

	if (isDefaultOptInDisabledKey(key)) {
		const enabled = [...readOptInEnabledByScope(scope)];
		const index = enabled.indexOf(key);
		let newEnabled: boolean;
		if (index >= 0) {
			enabled.splice(index, 1);
			newEnabled = false;
		} else {
			enabled.push(key);
			newEnabled = true;
		}
		writeOptInEnabledByScope(scope, enabled);
		return newEnabled;
	}

	const disabled = readDisabledByScope(scope);
	const index = disabled.indexOf(key);
	let newEnabled: boolean;

	if (index >= 0) {
		disabled.splice(index, 1);
		newEnabled = true;
	} else {
		disabled.push(key);
		newEnabled = false;
	}

	writeDisabledByScope(scope, disabled);
	return newEnabled;
}

/**
 * 获取工具在某个作用域中的禁用状态
 */
export function isMCPToolDisabledInScope(
	serviceName: string,
	toolName: string,
	scope: MCPConfigScope,
): boolean {
	const key = makeToolKey(serviceName, toolName);
	return getDisabledMCPToolsByScope(scope).includes(key);
}
