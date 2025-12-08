/**
 * 重试工具函数
 * 提供统一的重试机制用于所有 AI 请求
 * - 支持5次重试
 * - 延时递增策略 (1s, 2s, 4s, 8s, 16s)
 * - 支持 AbortSignal 中断
 */

import {logger} from './logger.js';

export interface RetryOptions {
	maxRetries?: number; // 最大重试次数，默认5次
	baseDelay?: number; // 基础延迟时间(ms)，默认1000ms
	onRetry?: (error: Error, attempt: number, nextDelay: number) => void; // 重试回调函数
	abortSignal?: AbortSignal; // 中断信号
}

/**
 * 延时函数，支持 AbortSignal 中断
 */
async function delay(ms: number, abortSignal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (abortSignal?.aborted) {
			reject(new Error('Aborted'));
			return;
		}

		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		const abortHandler = () => {
			cleanup();
			reject(new Error('Aborted'));
		};

		const cleanup = () => {
			clearTimeout(timer);
			abortSignal?.removeEventListener('abort', abortHandler);
		};

		abortSignal?.addEventListener('abort', abortHandler);
	});
}

/**
 * 判断错误是否可重试
 */
function isRetriableError(error: Error): boolean {
	const errorMessage = error.message.toLowerCase();

	// 网络错误
	if (
		errorMessage.includes('network') ||
		errorMessage.includes('econnrefused') ||
		errorMessage.includes('econnreset') ||
		errorMessage.includes('etimedout') ||
		errorMessage.includes('timeout')
	) {
		return true;
	}

	// Rate limit errors
	if (
		errorMessage.includes('rate limit') ||
		errorMessage.includes('too many requests') ||
		errorMessage.includes('429')
	) {
		return true;
	}

	// Server errors (5xx - temporary server issues, retryable)
	// Note: 400, 403, 405 are client errors - typically not retryable
	// as they indicate request format issues that won't change on retry
	if (
		errorMessage.includes('500') ||
		errorMessage.includes('502') ||
		errorMessage.includes('503') ||
		errorMessage.includes('504') ||
		errorMessage.includes('internal server error') ||
		errorMessage.includes('bad gateway') ||
		errorMessage.includes('service unavailable') ||
		errorMessage.includes('gateway timeout')
	) {
		return true;
	}

	// Temporary service unavailable
	if (
		errorMessage.includes('overloaded') ||
		errorMessage.includes('unavailable')
	) {
		return true;
	}

	// Connection terminated by server
	if (
		errorMessage.includes('terminated') ||
		errorMessage.includes('connection reset') ||
		errorMessage.includes('socket hang up')
	) {
		return true;
	}

	// JSON parsing errors from streaming (incomplete or malformed tool calls)
	if (
		errorMessage.includes('invalid tool call json') ||
		errorMessage.includes('incomplete tool call json')
	) {
		return true;
	}

	return false;
}

/**
 * 包装异步函数，提供重试机制
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const {maxRetries = 5, baseDelay = 1000, onRetry, abortSignal} = options;

	let lastError: Error | null = null;
	let attempt = 0;

	while (attempt <= maxRetries) {
		// 检查是否已中断
		if (abortSignal?.aborted) {
			throw new Error('Request aborted');
		}

		try {
			// 尝试执行函数
			return await fn();
		} catch (error) {
			lastError = error as Error;

			// 如果是 AbortError，立即退出
			if (lastError.name === 'AbortError' || lastError.message === 'Aborted') {
				throw lastError;
			}

			// 如果已达到最大重试次数，抛出错误
			if (attempt >= maxRetries) {
				throw lastError;
			}

			// 检查错误是否可重试
			if (!isRetriableError(lastError)) {
				throw lastError;
			}

			// 计算下次重试的延时（指数退避：1s, 2s, 4s, 8s, 16s）
			const nextDelay = baseDelay * Math.pow(2, attempt);

			// 调用重试回调
			if (onRetry) {
				onRetry(lastError, attempt + 1, nextDelay);
			}

			// 等待后重试
			try {
				await delay(nextDelay, abortSignal);
			} catch (delayError) {
				// 延时过程中被中断
				throw new Error('Request aborted');
			}

			attempt++;
		}
	}

	// 不应该到达这里
	throw lastError || new Error('Retry failed');
}

/**
 * 包装异步生成器函数，提供重试机制
 * 注意：如果生成器已经开始产生数据，则不会重试
 */
export async function* withRetryGenerator<T>(
	fn: () => AsyncGenerator<T, void, unknown>,
	options: RetryOptions = {},
): AsyncGenerator<T, void, unknown> {
	const {maxRetries = 5, baseDelay = 1000, onRetry, abortSignal} = options;

	let lastError: Error | null = null;
	let attempt = 0;
	let hasYielded = false; // 标记是否已经产生过数据

	while (attempt <= maxRetries) {
		// 检查是否已中断
		if (abortSignal?.aborted) {
			throw new Error('Request aborted');
		}

		try {
			// 尝试执行生成器
			const generator = fn();

			for await (const chunk of generator) {
				hasYielded = true; // 标记已产生数据
				yield chunk;
			}

			// 成功完成
			return;
		} catch (error) {
			lastError = error as Error;

			// 如果是 AbortError，立即退出
			if (lastError.name === 'AbortError' || lastError.message === 'Aborted') {
				throw lastError;
			}

			// 如果已经产生过数据，不再重试（避免重复数据）
			if (hasYielded) {
				throw lastError;
			}

			// 如果已达到最大重试次数，抛出错误
			if (attempt >= maxRetries) {
				throw lastError;
			}

			// 检查错误是否可重试
			if (!isRetriableError(lastError)) {
				throw lastError;
			}

			// 计算下次重试的延时（指数退避：1s, 2s, 4s, 8s, 16s）
			const nextDelay = baseDelay * Math.pow(2, attempt);

			// 调用重试回调
			if (onRetry) {
				onRetry(lastError, attempt + 1, nextDelay);
			}

			// 等待后重试
			try {
				await delay(nextDelay, abortSignal);
			} catch (delayError) {
				// 延时过程中被中断
				throw new Error('Request aborted');
			}

			attempt++;
		}
	}

	// 不应该到达这里
	throw lastError || new Error('Retry failed');
}

/**
 * JSON 解析结果
 */
export interface JsonParseResult<T = any> {
	success: boolean;
	data?: T;
	error?: Error;
	wasFixed?: boolean;
	originalJson?: string;
	fixedJson?: string;
}

/**
 * 尝试解析 JSON，如果失败则尝试修复常见的 JSON 错误
 * @param jsonString - 要解析的 JSON 字符串
 * @param options - 配置选项
 * @returns 解析结果
 */
export function parseJsonWithFix<T = any>(
	jsonString: string,
	options: {
		/** 是否在修复成功时记录警告 */
		logWarning?: boolean;
		/** 是否在修复失败时记录错误 */
		logError?: boolean;
		/** 工具名称（用于日志） */
		toolName?: string;
		/** 失败时的回退值 */
		fallbackValue?: T;
	} = {},
): JsonParseResult<T> {
	const {
		logWarning = true,
		logError = true,
		toolName = 'unknown',
		fallbackValue,
	} = options;

	// 首先尝试直接解析
	try {
		const data = JSON.parse(jsonString) as T;
		return {success: true, data};
	} catch (originalError) {
		// 解析失败，尝试修复
		let fixedJson = jsonString;
		let wasFixed = false;

		// Fix 1: 移除格式错误的模式，如 "endLine":685 ": ""
		// 处理值后面有额外冒号和引号的情况
		const malformedPattern = /(\"[\w]+\"\s*:\s*[^,}\]]+)\s*\":\s*\"[^\"]*\"/g;
		if (malformedPattern.test(fixedJson)) {
			fixedJson = fixedJson.replace(malformedPattern, '$1');
			wasFixed = true;
		}

		// Fix 2: 移除闭合括号前的尾随逗号
		if (/,(\s*[}\]])/.test(fixedJson)) {
			fixedJson = fixedJson.replace(/,(\s*[}\]])/g, '$1');
			wasFixed = true;
		}

		// Fix 3: 修复属性名缺少引号的问题
		if (/{\s*\w+\s*:/.test(fixedJson)) {
			fixedJson = fixedJson.replace(/{\s*(\w+)\s*:/g, '{"$1":');
			fixedJson = fixedJson.replace(/,\s*(\w+)\s*:/g, ',"$1":');
			wasFixed = true;
		}

		// Fix 4: 添加缺失的闭合括号
		const openBraces = (fixedJson.match(/{/g) || []).length;
		const closeBraces = (fixedJson.match(/}/g) || []).length;
		const openBrackets = (fixedJson.match(/\[/g) || []).length;
		const closeBrackets = (fixedJson.match(/\]/g) || []).length;

		if (openBraces > closeBraces) {
			fixedJson += '}'.repeat(openBraces - closeBraces);
			wasFixed = true;
		}
		if (openBrackets > closeBrackets) {
			fixedJson += ']'.repeat(openBrackets - closeBrackets);
			wasFixed = true;
		}

		// Fix 5: 移除多余的闭合括号
		if (closeBraces > openBraces) {
			const extraBraces = closeBraces - openBraces;
			for (let i = 0; i < extraBraces; i++) {
				fixedJson = fixedJson.replace(/}([^}]*)$/, '$1');
			}
			wasFixed = true;
		}
		if (closeBrackets > openBrackets) {
			const extraBrackets = closeBrackets - openBrackets;
			for (let i = 0; i < extraBrackets; i++) {
				fixedJson = fixedJson.replace(/\]([^\]]*)$/, '$1');
			}
			wasFixed = true;
		}

		// 尝试解析修复后的 JSON
		try {
			const data = JSON.parse(fixedJson) as T;
			if (wasFixed && logWarning) {
				logger.warn(`Warning: Fixed malformed JSON for ${toolName}`);
			}
			return {
				success: true,
				data,
				wasFixed,
				originalJson: jsonString,
				fixedJson,
			};
		} catch (fixError) {
			// 修复失败
			if (logError) {
				logger.error(`Error: Failed to parse JSON for ${toolName}`);
				logger.error(`Original: ${jsonString}`);
				if (wasFixed) {
					logger.error(`After fixes: ${fixedJson}`);
				}
				logger.error(
					`Parse error: ${
						fixError instanceof Error ? fixError.message : 'Unknown'
					}`,
				);
			}

			// 如果提供了回退值，使用回退值
			if (fallbackValue !== undefined) {
				return {
					success: false,
					data: fallbackValue,
					error:
						fixError instanceof Error ? fixError : new Error(String(fixError)),
					wasFixed,
					originalJson: jsonString,
					fixedJson: wasFixed ? fixedJson : undefined,
				};
			}

			return {
				success: false,
				error:
					fixError instanceof Error ? fixError : new Error(String(fixError)),
				wasFixed,
				originalJson: jsonString,
				fixedJson: wasFixed ? fixedJson : undefined,
			};
		}
	}
}
