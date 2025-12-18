import {join} from 'path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';

const SNOW_DIR = '.snow';
const PERMISSIONS_FILE = 'permissions.json';

export interface PermissionsConfig {
	alwaysApprovedTools: string[];
}

const DEFAULT_CONFIG: PermissionsConfig = {
	alwaysApprovedTools: [],
};

/**
 * 获取项目的 .snow 目录路径
 */
function getSnowDirPath(workingDirectory: string): string {
	return join(workingDirectory, SNOW_DIR);
}

/**
 * 获取权限配置文件路径
 */
function getPermissionsFilePath(workingDirectory: string): string {
	return join(getSnowDirPath(workingDirectory), PERMISSIONS_FILE);
}

/**
 * 确保 .snow 目录存在
 */
function ensureConfigDirectory(workingDirectory: string): void {
	const snowDir = getSnowDirPath(workingDirectory);
	if (!existsSync(snowDir)) {
		mkdirSync(snowDir, {recursive: true});
	}
}

/**
 * 加载权限配置
 */
export function loadPermissionsConfig(
	workingDirectory: string,
): PermissionsConfig {
	ensureConfigDirectory(workingDirectory);
	const configPath = getPermissionsFilePath(workingDirectory);

	if (!existsSync(configPath)) {
		return {...DEFAULT_CONFIG};
	}

	try {
		const configData = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(configData);
		return {
			alwaysApprovedTools: Array.isArray(config.alwaysApprovedTools)
				? config.alwaysApprovedTools
				: [],
		};
	} catch (error) {
		console.error('Failed to load permissions config:', error);
		return {...DEFAULT_CONFIG};
	}
}

/**
 * 保存权限配置
 */
export function savePermissionsConfig(
	workingDirectory: string,
	config: PermissionsConfig,
): void {
	ensureConfigDirectory(workingDirectory);
	const configPath = getPermissionsFilePath(workingDirectory);

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(configPath, configData, 'utf-8');
	} catch (error) {
		console.error('Failed to save permissions config:', error);
		throw error;
	}
}

/**
 * 添加工具到始终批准列表
 */
export function addToolToPermissions(
	workingDirectory: string,
	toolName: string,
): void {
	const config = loadPermissionsConfig(workingDirectory);
	if (!config.alwaysApprovedTools.includes(toolName)) {
		config.alwaysApprovedTools.push(toolName);
		savePermissionsConfig(workingDirectory, config);
	}
}

/**
 * 批量添加工具到始终批准列表
 */
export function addMultipleToolsToPermissions(
	workingDirectory: string,
	toolNames: string[],
): void {
	const config = loadPermissionsConfig(workingDirectory);
	let modified = false;

	for (const toolName of toolNames) {
		if (!config.alwaysApprovedTools.includes(toolName)) {
			config.alwaysApprovedTools.push(toolName);
			modified = true;
		}
	}

	if (modified) {
		savePermissionsConfig(workingDirectory, config);
	}
}

/**
 * 从始终批准列表移除工具
 */
export function removeToolFromPermissions(
	workingDirectory: string,
	toolName: string,
): void {
	const config = loadPermissionsConfig(workingDirectory);
	const index = config.alwaysApprovedTools.indexOf(toolName);

	if (index !== -1) {
		config.alwaysApprovedTools.splice(index, 1);
		savePermissionsConfig(workingDirectory, config);
	}
}

/**
 * 清空所有始终批准的工具
 */
export function clearAllPermissions(workingDirectory: string): void {
	savePermissionsConfig(workingDirectory, {alwaysApprovedTools: []});
}

/**
 * 获取权限配置文件路径（用于调试）
 */
export function getPermissionsConfigFilePath(workingDirectory: string): string {
	return getPermissionsFilePath(workingDirectory);
}
