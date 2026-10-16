import type {UnifiedHookExecutionResult, HookActionResult, CommandHookResult} from './unifiedHooksExecutor.js';
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

		// Direct: { "additionalContext": "..." }
		let context: string | undefined;
		if (typeof parsed.additionalContext === 'string') {
			context = parsed.additionalContext;
		}

		// Nested: { "hookSpecificOutput": { "additionalContext": "..." } }
		if (
			!context &&
			parsed.hookSpecificOutput &&
			typeof parsed.hookSpecificOutput === 'object' &&
			typeof parsed.hookSpecificOutput.additionalContext === 'string'
		) {
			context = parsed.hookSpecificOutput.additionalContext;
		}

		// Optional display hint: { "display": "..." }
		const display =
			typeof parsed.display === 'string' ? parsed.display : undefined;

		// Optional prompt override (beforeSubAgentStart)
		const prompt =
			typeof parsed.prompt === 'string' ? parsed.prompt : undefined;

		if (!context && !display && !prompt) {
			return null;
		}

		return {
			...(context ? {context} : {}),
			...(display ? {display} : {}),
			...(prompt ? {prompt} : {}),
		};
	} catch {
		// Non-JSON output — do not treat stdout as context
		return null;
	}
}

/**
 * Extract aggregated additionalContext, display hints, and prompt override
 * across all successful results of a hook run.
 */
export function extractAdditionalContext(
	hookResult: UnifiedHookExecutionResult,
	maxBytes: number = DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES,
): ExtractedAdditionalContext {
	const contexts: string[] = [];
	const displays: string[] = [];

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
 * Extract prompt override for beforeSubAgentStart from command outputs.
 * Last non-empty prompt wins.
 */
export function extractPromptOverride(
	hookResult: UnifiedHookExecutionResult,
): string | undefined {
	let prompt: string | undefined;
	for (const result of hookResult.results) {
		if (result.type !== 'command' || !result.success || !result.output) {
			continue;
		}
		const parsed = parseAdditionalContextOutput(result.output);
		if (parsed?.prompt) {
			prompt = parsed.prompt;
		}
	}
	return prompt;
}

/**
 * Helper: Find the first failed command result in a hook run.
 */
export function findFirstFailedCommand(
	results: HookActionResult[],
): CommandHookResult | undefined {
	return results.find(
		(r): r is CommandHookResult => r.type === 'command' && !r.success,
	);
}

/**
 * Helper: Build HookErrorDetails from a failed CommandHookResult.
 */
export function buildErrorDetails(
	failed: CommandHookResult,
	type: 'warning' | 'error',
): HookErrorDetails {
	return {
		type,
		exitCode: failed.exitCode ?? 1,
		command: failed.command,
		output: failed.output,
		error: failed.error,
	};
}
