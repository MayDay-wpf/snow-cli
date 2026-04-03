import type {HookType} from '../config/hooksConfig.js';
import type {UnifiedHookExecutionResult} from './unifiedHooksExecutor.js';
import {
	type InterpretedHookResult,
	findFirstFailedCommand,
	buildErrorDetails,
} from './hookResultInterpreter.js';

export interface HookStrategy {
	interpret(
		hookResult: UnifiedHookExecutionResult,
		originalContent?: string,
	): InterpretedHookResult;
}

// ── onUserMessage ──
// exitCode 1: 用 stderr/stdout 替换用户消息，继续发送给 AI
// exitCode >=2: 阻止发送，显示错误

const onUserMessageStrategy: HookStrategy = {
	interpret(hookResult, _originalContent) {
		const error = findFirstFailedCommand(hookResult);
		if (!error) return {action: 'continue'};

		if (error.exitCode === 1) {
			return {
				action: 'replace',
				replacedContent:
					error.error ||
					error.output ||
					`[Hook Command Warning] Command: ${error.command} exited with code 1`,
			};
		}
		if (error.exitCode >= 2 || error.exitCode < 0) {
			return {
				action: 'block',
				errorDetails: buildErrorDetails(error),
			};
		}
		return {action: 'continue'};
	},
};

// ── beforeToolCall ──
// exitCode 1: 阻止工具执行，返回 stderr/stdout 作为工具结果
// exitCode >=2: 阻止工具执行，设置 hookFailed 标记

const beforeToolCallStrategy: HookStrategy = {
	interpret(hookResult) {
		const error = findFirstFailedCommand(hookResult);
		if (!error) return {action: 'continue'};

		if (error.exitCode === 1) {
			return {
				action: 'block',
				replacedContent:
					error.error ||
					error.output ||
					`[beforeToolCall Hook Warning] Command: ${error.command} exited with code 1`,
			};
		}
		if (error.exitCode >= 2 || error.exitCode < 0) {
			return {
				action: 'block',
				hookFailed: true,
				errorDetails: buildErrorDetails(error),
			};
		}
		return {action: 'continue'};
	},
};

// ── afterToolCall ──
// exitCode 1: 用 stderr/stdout 替换工具执行结果
// exitCode >=2: 设置 hookFailed 标记

const afterToolCallStrategy: HookStrategy = {
	interpret(hookResult) {
		const error = findFirstFailedCommand(hookResult);
		if (!error) return {action: 'continue'};

		if (error.exitCode === 1) {
			return {
				action: 'replace',
				replacedContent:
					error.error ||
					error.output ||
					`[afterToolCall Hook Warning] Command: ${error.command} exited with code 1`,
			};
		}
		if (error.exitCode >= 2 || error.exitCode < 0) {
			return {
				action: 'block',
				hookFailed: true,
				errorDetails: buildErrorDetails(error),
			};
		}
		return {action: 'continue'};
	},
};

// ── toolConfirmation ──
// exitCode 1: 打印警告
// exitCode >=2: 报错（由 UI 组件决定如何处理）

const toolConfirmationStrategy: HookStrategy = {
	interpret(hookResult) {
		const error = findFirstFailedCommand(hookResult);
		if (!error) return {action: 'continue'};

		if (error.exitCode === 1) {
			const combinedOutput =
				[error.output, error.error].filter(Boolean).join('\n\n') ||
				'(no output)';
			return {
				action: 'warn',
				warningMessage: `[Hook Warning] toolConfirmation Hook returned warning:\nCommand: ${error.command}\nOutput: ${combinedOutput}`,
			};
		}
		if (error.exitCode >= 2 || error.exitCode < 0) {
			return {
				action: 'block',
				errorDetails: buildErrorDetails(error),
			};
		}
		return {action: 'continue'};
	},
};

// ── beforeCompress ──
// exitCode 1: 打印警告，继续压缩
// exitCode >=2: 阻止压缩

const beforeCompressStrategy: HookStrategy = {
	interpret(hookResult) {
		const error = findFirstFailedCommand(hookResult);
		if (!error) return {action: 'continue'};

		if (error.exitCode === 1) {
			const combinedOutput =
				[error.output, error.error].filter(Boolean).join('\n\n') ||
				'(no output)';
			return {
				action: 'warn',
				warningMessage:
					`[WARN] beforeCompress hook warning (exitCode: ${error.exitCode}):\n` +
					`output: ${combinedOutput}`,
			};
		}
		if (error.exitCode >= 2 || error.exitCode < 0) {
			return {
				action: 'block',
				hookFailed: true,
				errorDetails: buildErrorDetails(error),
			};
		}
		return {action: 'continue'};
	},
};

// ── onSessionStart ──
// exitCode 1: 打印警告，继续加载会话
// exitCode >=2: 阻止会话加载

const onSessionStartStrategy: HookStrategy = {
	interpret(hookResult) {
		const error = findFirstFailedCommand(hookResult);
		if (!error) return {action: 'continue'};

		const combinedOutput =
			[error.output, error.error].filter(Boolean).join('\n\n') ||
			'(no output)';

		if (error.exitCode === 1) {
			return {
				action: 'warn',
				warningMessage: `[WARN] onSessionStart hook warning:\nCommand: ${error.command}\nOutput: ${combinedOutput}`,
			};
		}
		if (error.exitCode >= 2 || error.exitCode < 0) {
			return {
				action: 'block',
				errorDetails: buildErrorDetails(error),
			};
		}
		return {action: 'continue'};
	},
};

// ── onSubAgentComplete ──
// 遍历所有结果：
// - command exitCode >=2: 注入用户消息，shouldContinue
// - prompt ask=ai: 注入用户消息，shouldContinue

const onSubAgentCompleteStrategy: HookStrategy = {
	interpret(hookResult) {
		if (!hookResult.results || hookResult.results.length === 0) {
			return {action: 'continue'};
		}

		const injectedMessages: Array<{
			role: 'user' | 'assistant';
			content: string;
		}> = [];
		let shouldContinue = false;

		for (const result of hookResult.results) {
			if (result.type === 'command' && !result.success) {
				if (result.exitCode >= 2) {
					injectedMessages.push({
						role: 'user',
						content: result.error || result.output || '未知错误',
					});
					shouldContinue = true;
				}
			} else if (result.type === 'prompt' && result.response) {
				if (result.response.ask === 'ai' && result.response.continue) {
					injectedMessages.push({
						role: 'user',
						content: result.response.message,
					});
					shouldContinue = true;
				}
			}
		}

		if (shouldContinue) {
			return {
				action: 'continue',
				shouldContinueConversation: true,
				injectedMessages,
			};
		}
		return {action: 'continue'};
	},
};

// ── onStop ──
// 遍历所有结果：
// - command exitCode 1: 警告
// - command exitCode >=2: 注入用户消息，shouldContinue
// - prompt ask=ai: 注入用户消息，shouldContinue
// - prompt ask=user: 注入 assistant 消息

const onStopStrategy: HookStrategy = {
	interpret(hookResult) {
		if (!hookResult.results || hookResult.results.length === 0) {
			return {action: 'continue'};
		}

		const injectedMessages: Array<{
			role: 'user' | 'assistant';
			content: string;
		}> = [];
		let shouldContinue = false;

		for (const result of hookResult.results) {
			if (result.type === 'command' && !result.success) {
				if (result.exitCode === 1) {
					console.log(
						'[WARN] onStop hook warning:',
						result.error || result.output || '',
					);
				} else if (result.exitCode >= 2) {
					injectedMessages.push({
						role: 'user',
						content: result.error || result.output || '未知错误',
					});
					shouldContinue = true;
				}
			} else if (result.type === 'prompt' && result.response) {
				if (result.response.ask === 'ai' && result.response.continue) {
					injectedMessages.push({
						role: 'user',
						content: result.response.message,
					});
					shouldContinue = true;
				} else if (
					result.response.ask === 'user' &&
					!result.response.continue
				) {
					injectedMessages.push({
						role: 'assistant',
						content: result.response.message,
					});
				}
			}
		}

		if (shouldContinue || injectedMessages.length > 0) {
			return {
				action: 'continue',
				shouldContinueConversation: shouldContinue,
				injectedMessages,
			};
		}
		return {action: 'continue'};
	},
};

export const hookStrategies: Record<HookType, HookStrategy> = {
	onUserMessage: onUserMessageStrategy,
	beforeToolCall: beforeToolCallStrategy,
	afterToolCall: afterToolCallStrategy,
	toolConfirmation: toolConfirmationStrategy,
	onSubAgentComplete: onSubAgentCompleteStrategy,
	beforeCompress: beforeCompressStrategy,
	onSessionStart: onSessionStartStrategy,
	onStop: onStopStrategy,
};
