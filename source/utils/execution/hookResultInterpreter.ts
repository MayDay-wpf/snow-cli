import type {HookType} from '../config/hooksConfig.js';
import type {
	UnifiedHookExecutionResult,
	HookActionResult,
	CommandHookResult,
} from './unifiedHooksExecutor.js';
import {hookStrategies} from './hookStrategies.js';

/**
 * Hook 错误详情（结构化数据，供 UI 组件渲染）
 */
export interface HookErrorDetails {
	type: 'warning' | 'error';
	exitCode: number;
	command: string;
	output?: string;
	error?: string;
}

/**
 * Hook 解释结果 —— 所有调用点基于此结构决定行为
 *
 * action 语义：
 * - continue:  Hook 通过，正常继续
 * - block:     阻止后续操作（工具执行/消息发送/压缩等）
 * - replace:   用 replacedContent 替换原始内容后继续
 * - warn:      打印警告后继续
 */
export interface InterpretedHookResult {
	action: 'continue' | 'block' | 'replace' | 'warn';
	replacedContent?: string;
	errorDetails?: HookErrorDetails;
	hookFailed?: boolean;
	warningMessage?: string;
	shouldContinueConversation?: boolean;
	injectedMessages?: Array<{role: 'user' | 'assistant'; content: string}>;
}

/**
 * 从 Hook 执行结果中找到第一个失败的 command 类型 action
 */
export function findFirstFailedCommand(
	hookResult: UnifiedHookExecutionResult,
): CommandHookResult | null {
	const found = hookResult.results.find(
		(r: HookActionResult) => r.type === 'command' && !r.success,
	);
	if (found && found.type === 'command') {
		return found;
	}
	return null;
}

/**
 * 从 CommandHookResult 构建 HookErrorDetails
 */
export function buildErrorDetails(
	error: CommandHookResult,
): HookErrorDetails {
	return {
		type: 'error',
		exitCode: error.exitCode,
		command: error.command,
		output: error.output,
		error: error.error,
	};
}

/**
 * 统一的 Hook 结果解释入口
 * 根据 hookType 选择对应的策略来解释执行结果
 */
export function interpretHookResult(
	hookType: HookType,
	hookResult: UnifiedHookExecutionResult,
	originalContent?: string,
): InterpretedHookResult {
	if (hookResult.success && hookResult.results.length === 0) {
		return {action: 'continue'};
	}

	const strategy = hookStrategies[hookType];
	return strategy.interpret(hookResult, originalContent);
}
