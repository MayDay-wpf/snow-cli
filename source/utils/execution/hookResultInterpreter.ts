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
	/** Model-visible prepend context from successful command JSON stdout */
	additionalContext?: string;
	/** Optional UI-only hint from JSON.display; never sent to the model */
	displayMessage?: string;
	/** beforeSubAgentStart: full prompt replacement (preferred over prepend) */
	promptOverride?: string;
}

/** Default max size for additionalContext (bytes / UTF-16 code units). */
export const DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES = 8192;

export type ExtractedAdditionalContext = {
	context?: string;
	display?: string;
	truncated: boolean;
};

/**
 * Truncate additionalContext to maxBytes. Uses string length as a simple bound.
 */
export function truncateAdditionalContext(
	text: string,
	maxBytes: number = DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES,
): {text: string; truncated: boolean} {
	if (text.length <= maxBytes) {
		return {text, truncated: false};
	}
	return {text: text.slice(0, maxBytes), truncated: true};
}

/**
 * Parse a single command stdout for additionalContext protocol.
 * Supports:
 *   { "additionalContext": "..." }
 *   { "hookSpecificOutput": { "additionalContext": "..." } }
 * Optional: display (UI only), prompt (full override for beforeSubAgentStart)
 * Non-JSON → null (do not inject logs as context).
 */
export function parseAdditionalContextOutput(rawOutput: string): {
	context?: string;
	display?: string;
	prompt?: string;
} | null {
	const trimmed = rawOutput.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}

		const record = parsed as Record<string, unknown>;
		let context: string | undefined;
		let display: string | undefined;
		let prompt: string | undefined;

		if (typeof record['additionalContext'] === 'string') {
			context = record['additionalContext'];
		} else if (
			record['hookSpecificOutput'] &&
			typeof record['hookSpecificOutput'] === 'object' &&
			!Array.isArray(record['hookSpecificOutput'])
		) {
			const nested = record['hookSpecificOutput'] as Record<string, unknown>;
			if (typeof nested['additionalContext'] === 'string') {
				context = nested['additionalContext'];
			}
		}

		if (typeof record['display'] === 'string') {
			display = record['display'];
		}
		if (typeof record['prompt'] === 'string') {
			prompt = record['prompt'];
		}

		if (
			context === undefined &&
			display === undefined &&
			prompt === undefined
		) {
			return null;
		}

		return {context, display, prompt};
	} catch {
		return null;
	}
}

/**
 * Collect additionalContext from successful command hook results.
 * Multiple actions are joined with "\n\n", then truncated once.
 */
export function extractAdditionalContext(
	hookResult: UnifiedHookExecutionResult,
	maxBytes: number = DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES,
): ExtractedAdditionalContext {
	const contexts: string[] = [];
	const displays: string[] = [];

	for (const result of hookResult.results) {
		// command (JSON stdout) or context (static inject) both contribute
		if (
			(result.type !== 'command' && result.type !== 'context') ||
			!result.success ||
			!result.output
		) {
			continue;
		}

		const parsed = parseAdditionalContextOutput(result.output);
		if (!parsed) {
			continue;
		}
		if (parsed.context) {
			contexts.push(parsed.context);
		}
		if (parsed.display) {
			displays.push(parsed.display);
		}
	}

	if (contexts.length === 0 && displays.length === 0) {
		return {truncated: false};
	}

	let truncated = false;
	let context: string | undefined;
	if (contexts.length > 0) {
		const joined = contexts.join('\n\n');
		const trunc = truncateAdditionalContext(joined, maxBytes);
		context = trunc.text;
		truncated = trunc.truncated;
	}

	const display = displays.length > 0 ? displays.join('\n\n') : undefined;

	return {
		...(context ? {context} : {}),
		...(display ? {display} : {}),
		truncated,
	};
}

/**
 * Extract full prompt override from successful command JSON (beforeSubAgentStart).
 * First successful action with `prompt` wins; also returns additionalContext for prepend.
 */
export function extractPromptOverride(
	hookResult: UnifiedHookExecutionResult,
	maxBytes: number = DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES,
): {
	promptOverride?: string;
	additionalContext?: string;
	display?: string;
	truncated: boolean;
} {
	let promptOverride: string | undefined;
	const contexts: string[] = [];
	const displays: string[] = [];
	let truncated = false;

	for (const result of hookResult.results) {
		if (
			(result.type !== 'command' && result.type !== 'context') ||
			!result.success ||
			!result.output
		) {
			continue;
		}
		const parsed = parseAdditionalContextOutput(result.output);
		if (!parsed) {
			continue;
		}
		if (parsed.prompt && promptOverride === undefined) {
			const trunc = truncateAdditionalContext(parsed.prompt, maxBytes);
			promptOverride = trunc.text;
			if (trunc.truncated) truncated = true;
		}
		if (parsed.context) {
			contexts.push(parsed.context);
		}
		if (parsed.display) {
			displays.push(parsed.display);
		}
	}

	let additionalContext: string | undefined;
	if (contexts.length > 0) {
		const trunc = truncateAdditionalContext(contexts.join('\n\n'), maxBytes);
		additionalContext = trunc.text;
		if (trunc.truncated) truncated = true;
	}

	return {
		...(promptOverride ? {promptOverride} : {}),
		...(additionalContext ? {additionalContext} : {}),
		...(displays.length > 0 ? {display: displays.join('\n\n')} : {}),
		truncated,
	};
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
	const interpreted = strategy.interpret(hookResult, originalContent);

	// P2 observability: record inject summaries when present
	if (
		interpreted.additionalContext ||
		interpreted.displayMessage ||
		interpreted.promptOverride
	) {
		void import('./hookInjectDebug.js')
			.then(({recordHookInjectDebug}) => {
				recordHookInjectDebug({
					hookType,
					additionalContext: interpreted.additionalContext,
					displayMessage: interpreted.displayMessage,
					promptOverride: interpreted.promptOverride,
				});
			})
			.catch(() => {});
	}

	return interpreted;
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
