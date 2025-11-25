import {homedir} from 'os';
import {join} from 'path';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	readdirSync,
} from 'fs';

/**
 * Hook 类型
 */
export type HookType =
	| 'onUserMessage' // 用户发送消息时触发
	| 'beforeToolCall' // 在工具调用之前运行
	| 'afterToolCall' // 在工具调用完成后运行
	| 'onSubAgentComplete' // 当子代理任务完成时运行
	| 'beforeCompress' // 在即将运行压缩操作之前运行
	| 'onSessionStart' // 当启动新会话或恢复现有会话时运行
	| 'onStop'; // Stop AI流程结束前运行

/**
 * Hook 执行类型
 */
export type HookActionType = 'command' | 'prompt';

/**
 * Hook 执行动作
 */
export interface HookAction {
	type: HookActionType;
	command?: string; // type=command 时使用
	prompt?: string; // type=prompt 时使用
	timeout?: number; // 超时时间（毫秒）
	enabled?: boolean; // 是否启用（默认为 true）
}

/**
 * Hook 规则
 */
export interface HookRule {
	matcher?: string; // 匹配器（仅用于工具Hooks: beforeToolCall/afterToolCall，多个用逗号分隔）
	description: string;
	hooks: HookAction[];
}

/**
 * Hook 配置
 */
export interface HookConfig {
	[key: string]: HookRule[]; // key 为 HookType
}

/**
 * Hook 存储位置
 */
export type HookScope = 'global' | 'project';

/**
 * 获取全局 hooks 目录
 */
function getGlobalHooksDir(): string {
	return join(homedir(), '.snow', 'hooks');
}

/**
 * 获取项目 hooks 目录
 */
function getProjectHooksDir(): string {
	return join(process.cwd(), '.snow', 'hooks');
}

/**
 * 获取 hooks 目录
 */
export function getHooksDir(scope: HookScope): string {
	return scope === 'global' ? getGlobalHooksDir() : getProjectHooksDir();
}

/**
 * 确保 hooks 目录存在
 */
function ensureHooksDirectory(scope: HookScope): void {
	const hooksDir = getHooksDir(scope);
	if (!existsSync(hooksDir)) {
		mkdirSync(hooksDir, {recursive: true});
	}
}

/**
 * 获取 hook 配置文件路径
 */
function getHookFilePath(hookType: HookType, scope: HookScope): string {
	return join(getHooksDir(scope), `${hookType}.json`);
}

/**
 * 加载 hook 配置
 */
export function loadHookConfig(
	hookType: HookType,
	scope: HookScope,
): HookRule[] {
	ensureHooksDirectory(scope);
	const filePath = getHookFilePath(hookType, scope);

	if (!existsSync(filePath)) {
		return [];
	}

	try {
		const content = readFileSync(filePath, 'utf8');
		const data = JSON.parse(content);

		// 支持直接是数组的格式
		if (Array.isArray(data)) {
			return data;
		}

		// 支持对象格式（兼容用户描述的格式）
		if (data[hookType]) {
			return data[hookType];
		}

		return [];
	} catch (error) {
		console.error(`Failed to load hook config for ${hookType}:`, error);
		return [];
	}
}

/**
 * 保存 hook 配置
 */
export function saveHookConfig(
	hookType: HookType,
	scope: HookScope,
	rules: HookRule[],
): void {
	ensureHooksDirectory(scope);
	const filePath = getHookFilePath(hookType, scope);

	try {
		// 保存为对象格式（符合用户描述的格式）
		const config: HookConfig = {
			[hookType]: rules,
		};
		const content = JSON.stringify(config, null, 4);
		writeFileSync(filePath, content, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save hook config for ${hookType}: ${error}`);
	}
}

/**
 * 删除 hook 配置文件
 */
export function deleteHookConfig(hookType: HookType, scope: HookScope): void {
	const filePath = getHookFilePath(hookType, scope);
	if (existsSync(filePath)) {
		const fs = require('fs');
		fs.unlinkSync(filePath);
	}
}

/**
 * 列出所有已配置的 hooks
 */
export function listConfiguredHooks(scope: HookScope): HookType[] {
	ensureHooksDirectory(scope);
	const hooksDir = getHooksDir(scope);

	try {
		const files = readdirSync(hooksDir);
		return files
			.filter(file => file.endsWith('.json'))
			.map(file => file.replace('.json', '') as HookType);
	} catch (error) {
		return [];
	}
}

/**
 * 获取所有 hook 类型
 */
export function getAllHookTypes(): HookType[] {
	return [
		'onUserMessage',
		'beforeToolCall',
		'afterToolCall',
		'onSubAgentComplete',
		'beforeCompress',
		'onSessionStart',
		'onStop',
	];
}
