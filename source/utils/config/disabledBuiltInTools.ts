import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 管理系统内置 MCP 工具的禁用状态
 * 持久化到项目根目录 .snow/disabled-builtin-tools.json
 * 优先级：项目配置 > 全局配置 > 默认配置
 */

const CONFIG_FILE = 'disabled-builtin-tools.json';

// 默认禁用的内置服务列表
const DEFAULT_DISABLED_SERVICES: string[] = ['scheduler'];

function getProjectConfigPath(): string {
	return path.join(process.cwd(), '.snow', CONFIG_FILE);
}

function getGlobalConfigPath(): string {
	return path.join(os.homedir(), '.snow', CONFIG_FILE);
}

function getConfigPath(): string {
	return getProjectConfigPath();
}

/**
 * 读取被禁用的内置服务列表
 * 优先级：项目配置 > 全局配置 > 默认配置
 */
export function getDisabledBuiltInServices(): string[] {
	try {
		const projectConfigPath = getProjectConfigPath();
		const globalConfigPath = getGlobalConfigPath();

		// 优先读取项目配置
		if (fs.existsSync(projectConfigPath)) {
			const data = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'));
			return Array.isArray(data.disabledServices) ? data.disabledServices : [];
		}

		// 如果项目配置不存在，读取全局配置
		if (fs.existsSync(globalConfigPath)) {
			const data = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
			return Array.isArray(data.disabledServices) ? data.disabledServices : [];
		}

		// 返回默认禁用列表
		return [...DEFAULT_DISABLED_SERVICES];
	} catch {
		return [...DEFAULT_DISABLED_SERVICES];
	}
}

/**
 * 检查某个内置服务是否启用
 */
export function isBuiltInServiceEnabled(serviceName: string): boolean {
	return !getDisabledBuiltInServices().includes(serviceName);
}

/**
 * 切换内置服务的启用/禁用状态
 */
export function toggleBuiltInService(serviceName: string): boolean {
	const disabled = getDisabledBuiltInServices();
	const index = disabled.indexOf(serviceName);
	let newEnabled: boolean;

	if (index >= 0) {
		disabled.splice(index, 1);
		newEnabled = true;
	} else {
		disabled.push(serviceName);
		newEnabled = false;
	}

	const configPath = getConfigPath();
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
	fs.writeFileSync(
		configPath,
		JSON.stringify({disabledServices: disabled}, null, 2),
		'utf-8',
	);

	return newEnabled;
}
