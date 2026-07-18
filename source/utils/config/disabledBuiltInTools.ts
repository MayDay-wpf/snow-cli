import {readSettings, updateSettings} from './unifiedSettings.js';

/**
 * 管理系统内置 MCP 工具的禁用状态
 * 现已统一持久化到 `<cwd>/.snow/settings.json` 的 `disabledBuiltInServices` 字段
 * （历史上单独存放于 `disabled-builtin-tools.json`，已自动迁移）。
 * 优先级：项目配置 > 全局配置 > 默认配置
 */

// 默认禁用的内置服务列表
const DEFAULT_DISABLED_SERVICES: string[] = ['scheduler'];

/**
 * 读取被禁用的内置服务列表
 * 优先级：项目配置 > 全局配置 > 默认配置
 */
export function getDisabledBuiltInServices(): string[] {
	try {
		const project = readSettings('project');
		if (Array.isArray(project.disabledBuiltInServices)) {
			return project.disabledBuiltInServices;
		}

		const global = readSettings('global');
		if (Array.isArray(global.disabledBuiltInServices)) {
			return global.disabledBuiltInServices;
		}

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
 * 切换内置服务的启用/禁用状态（写入项目级 settings.json）
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

	updateSettings('project', settings => {
		settings.disabledBuiltInServices = disabled;
	});

	return newEnabled;
}
