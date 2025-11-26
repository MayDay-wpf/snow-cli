import type {
	UnifiedHookExecutionResult,
	HookActionResult,
} from './unifiedHooksExecutor.js';

/**
 * Hook 错误详情 (结构化数据)
 */
export interface HookErrorDetails {
	type: 'warning' | 'error'; // 警告或错误
	exitCode: number; // 退出码
	command: string; // 执行的命令
	output?: string; // stdout输出
	error?: string; // stderr输出
}

/**
 * Hook 结果处理返回
 */
export interface HookHandlerResult {
	shouldContinue: boolean; // 是否继续发送消息给AI
	modifiedMessage?: string; // 修改后的消息(仅当shouldContinue=true时)
	errorDetails?: HookErrorDetails; // 错误详情(由UI组件渲染)
}

/**
 * 处理 Hook 执行结果,根据退出码决定后续行为
 *
 * 退出码规则:
 * - 0: 通过,正常继续
 * - 1: 警告,将stderr追加到消息中发送给AI
 * - 2+: 严重错误,阻止发送,直接显示给用户
 *
 * @param hookResult - Hook执行结果
 * @param originalMessage - 原始用户消息
 * @returns 处理结果
 */
export function handleHookResult(
	hookResult: UnifiedHookExecutionResult | null,
	originalMessage: string,
): HookHandlerResult {
	// 如果没有Hook结果或Hook执行成功,正常继续
	if (!hookResult || hookResult.success) {
		return {
			shouldContinue: true,
			modifiedMessage: originalMessage,
		};
	}
	// 查找失败的command hook
	const commandError = hookResult.results.find(
		(r: HookActionResult) => r.type === 'command' && !r.success,
	);

	// 如果没有command错误,正常继续
	if (!commandError || commandError.type !== 'command') {
		return {
			shouldContinue: true,
			modifiedMessage: originalMessage,
		};
	}

	// 根据退出码处理
	const {exitCode, command, output, error} = commandError;

	if (exitCode === 1) {
		// 警告: 追加结构化数据到消息,发送给AI
		const combinedOutput =
			[output, error].filter(Boolean).join('\n\n') || '(no output)';
		const warningMessage = `\n\n[Hook Command Warning]\nCommand: ${command}\nOutput:\n${combinedOutput}`;
		return {
			shouldContinue: true,
			modifiedMessage: originalMessage + warningMessage,
		};
	} else if (exitCode >= 2 || exitCode < 0) {
		// 严重错误或异常: 返回结构化数据,由UI组件渲染
		return {
			shouldContinue: false,
			errorDetails: {
				type: 'error',
				exitCode,
				command,
				output,
				error,
			},
		};
	}

	// 默认情况(不应该到这里)
	return {
		shouldContinue: true,
		modifiedMessage: originalMessage,
	};
}
