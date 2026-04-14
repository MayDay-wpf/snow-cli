import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {MCPConfigScope} from './apiConfig.js';

/**
 * 管理单个 MCP 工具的禁用状态
 * 支持全局 (~/.snow/disabled-mcp-tools.json) 和项目 (<cwd>/.snow/disabled-mcp-tools.json) 两个作用域
 * 工具标识格式: "serviceName:toolName"
 */

const CONFIG_FILE = 'disabled-mcp-tools.json';
const OPT_IN_CONFIG_FILE = 'opt-in-mcp-tools.json';

interface DisabledMCPToolsConfig {
	disabledTools: string[];
}

interface OptInMCPConfig {
	enabledTools: string[];
}

/** Tools that are off until explicitly enabled (Tab in MCP tools list writes opt-in file). */
const DEFAULT_OPT_IN_DISABLED_KEYS = new Set<string>(['filesystem:edit']);

function getProjectConfigPath(): string {
	return path.join(process.cwd(), '.snow', CONFIG_FILE);
}

function getGlobalConfigPath(): string {
	return path.join(os.homedir(), '.snow', CONFIG_FILE);
}

function getProjectOptInPath(): string {
	return path.join(process.cwd(), '.snow', OPT_IN_CONFIG_FILE);
}

function getGlobalOptInPath(): string {
	return path.join(os.homedir(), '.snow', OPT_IN_CONFIG_FILE);
}

function readOptInEnabled(configPath: string): string[] {
	try {
		if (!fs.existsSync(configPath)) return [];
		const data = JSON.parse(
			fs.readFileSync(configPath, 'utf-8'),
		) as OptInMCPConfig;
		return Array.isArray(data.enabledTools) ? data.enabledTools : [];
	} catch {
		return [];
	}
}

function writeOptInEnabled(configPath: string, enabledTools: string[]): void {
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
	fs.writeFileSync(
		configPath,
		JSON.stringify({enabledTools} satisfies OptInMCPConfig, null, 2),
		'utf-8',
	);
}

function readConfig(configPath: string): string[] {
	try {
		if (!fs.existsSync(configPath)) return [];
		const data = JSON.parse(
			fs.readFileSync(configPath, 'utf-8'),
		) as DisabledMCPToolsConfig;
		return Array.isArray(data.disabledTools) ? data.disabledTools : [];
	} catch {
		return [];
	}
}

function writeConfig(configPath: string, disabledTools: string[]): void {
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
	fs.writeFileSync(
		configPath,
		JSON.stringify({disabledTools} satisfies DisabledMCPToolsConfig, null, 2),
		'utf-8',
	);
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
	const g = readOptInEnabled(getGlobalOptInPath());
	const p = readOptInEnabled(getProjectOptInPath());
	return [...new Set([...g, ...p])];
}

/**
 * 获取合并后的被禁用工具列表（project + global 去重合并）
 */
export function getDisabledMCPTools(): string[] {
	const globalDisabled = readConfig(getGlobalConfigPath());
	const projectDisabled = readConfig(getProjectConfigPath());
	return [...new Set([...globalDisabled, ...projectDisabled])];
}

/**
 * 获取指定作用域的被禁用工具列表
 */
export function getDisabledMCPToolsByScope(scope: MCPConfigScope): string[] {
	const configPath =
		scope === 'project' ? getProjectConfigPath() : getGlobalConfigPath();
	return readConfig(configPath);
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
		const configPath =
			scope === 'project' ? getProjectOptInPath() : getGlobalOptInPath();
		const enabled = [...readOptInEnabled(configPath)];
		const index = enabled.indexOf(key);
		let newEnabled: boolean;
		if (index >= 0) {
			enabled.splice(index, 1);
			newEnabled = false;
		} else {
			enabled.push(key);
			newEnabled = true;
		}
		writeOptInEnabled(configPath, enabled);
		return newEnabled;
	}

	const configPath =
		scope === 'project' ? getProjectConfigPath() : getGlobalConfigPath();
	const disabled = readConfig(configPath);
	const index = disabled.indexOf(key);
	let newEnabled: boolean;

	if (index >= 0) {
		disabled.splice(index, 1);
		newEnabled = true;
	} else {
		disabled.push(key);
		newEnabled = false;
	}

	writeConfig(configPath, disabled);
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
