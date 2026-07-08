import type {HookType} from '../config/hooksConfig.js';
import type {
	UnifiedHookExecutionResult,
	HookActionResult,
	CommandHookResult,
} from './unifiedHooksExecutor.js';
import {hookStrategies} from './hookStrategies.js';
import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';

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
export function buildErrorDetails(error: CommandHookResult): HookErrorDetails {
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

/**
 * 从 toolConfirmation Hook 的执行结果中提取自动确认/拒绝结果。
 *
 * 当 Hook 命令以退出码 0 返回了 stdout 时，尝试将 stdout 解析为
 * 工具确认结果，从而跳过用户交互 UI，让 AI 流程自动继续。
 *
 * 支持的 stdout 格式：
 * 1. 纯文本关键词（不区分大小写）：
 *    - "approve" / "approve_always" -> 批准工具执行
 *    - "reject" -> 拒绝工具执行
 * 2. JSON 对象:
 *    {"result": "approve"}
 *    {"result": "approve_always"}
 *    {"result": "reject"}
 *    {"result": "reject_with_reply", "reason": "命令包含危险操作"}
 * 3. JSON 字符串数组（reject_with_reply 的简写）:
 *    {"result": "reject_with_reply", "reason": "..."}
 *
 * @param hookResult - Hook 执行结果
 * @returns 解析出的确认结果，如果无法解析则返回 null
 */
export function extractHookProvidedConfirmation(
	hookResult: UnifiedHookExecutionResult,
): ConfirmationResult | null {
	// 遍历所有 Hook 执行结果，查找第一个成功的 command 输出
	for (const result of hookResult.results) {
		if (result.type !== 'command' || !result.success || !result.output) {
			continue;
		}

		const rawOutput = result.output.trim();
		if (!rawOutput) {
			continue;
		}

		// 尝试解析为 JSON
		try {
			const parsed = JSON.parse(rawOutput);

			// JSON 对象格式: {result: "approve"|"reject"|"approve_always"|"reject_with_reply", reason?: string}
			if (
				parsed &&
				typeof parsed === 'object' &&
				!Array.isArray(parsed) &&
				typeof parsed.result === 'string'
			) {
				const hookResultValue = parsed.result.toLowerCase();
				if (hookResultValue === 'approve') {
					return 'approve';
				}
				if (hookResultValue === 'approve_always') {
					return 'approve_always';
				}
				if (hookResultValue === 'reject') {
					return 'reject';
				}
				if (hookResultValue === 'reject_with_reply') {
					return {
						type: 'reject_with_reply',
						reason:
							typeof parsed.reason === 'string'
								? parsed.reason
								: 'Rejected by toolConfirmation hook',
					};
				}
			}
		} catch {
			// 不是有效的 JSON，按纯文本关键词处理
			const lowerOutput = rawOutput.toLowerCase().trim();

			// 去除可能的尾随换行或空白后做精确匹配
			if (lowerOutput === 'approve' || lowerOutput === 'approve_once') {
				return 'approve';
			}
			if (lowerOutput === 'approve_always') {
				return 'approve_always';
			}
			if (lowerOutput === 'reject') {
				return 'reject';
			}
			if (lowerOutput === 'reject_with_reply') {
				return {
					type: 'reject_with_reply',
					reason: 'Rejected by toolConfirmation hook',
				};
			}
		}
	}

	return null;
}
