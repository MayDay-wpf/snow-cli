import type {CompressionStatus} from '../../ui/components/compression/CompressionStatus.js';
import {executeContextCompression} from '../../hooks/conversation/useCommandHandler.js';

const COMPRESSION_MAX_RETRIES = 3;
const COMPRESSION_RETRY_BASE_DELAY = 1000;
const COMPRESSION_ERROR_DISMISS_MS = 5000;

/**
 * 检查 token 使用率是否达到阈值
 * @param percentage 当前上下文使用百分比（由 ChatInput 计算）
 * @param threshold 阈值百分比（默认80）
 * @returns 是否需要压缩
 */
export function shouldAutoCompress(
	percentage: number,
	threshold: number = 80,
): boolean {
	return percentage >= threshold;
}

/**
 * 执行自动压缩（含自动重试，失败提示 5s 后自动消失）
 * @param sessionId - 可选的会话ID，如果提供则使用该ID加载会话进行压缩
 * @param onStatusUpdate - 可选的状态更新回调，用于在UI中显示压缩进度
 * @returns 压缩结果，如果失败返回null或包含hookFailed的结果
 */
export async function performAutoCompression(
	sessionId?: string,
	onStatusUpdate?: (status: CompressionStatus | null) => void,
) {
	let lastError = '';

	for (let attempt = 0; attempt <= COMPRESSION_MAX_RETRIES; attempt++) {
		try {
			let failedInAttempt = false;

			const result = await executeContextCompression(
				sessionId,
				(status) => {
					if (status.step === 'failed') {
						failedInAttempt = true;
						lastError = status.message || 'Unknown error';
						// Don't forward failed status to UI during retries;
						// retry logic below will show 'retrying' or final 'failed' instead.
						return;
					}
					onStatusUpdate?.(status);
				},
			);

			if (result && (result as any).hookFailed) {
				return result;
			}

			if (result) {
				return result;
			}

			// null + not a failure (e.g. skipped) → don't retry
			if (!failedInAttempt) {
				return null;
			}

			// Failed – retry if attempts remain
			if (attempt < COMPRESSION_MAX_RETRIES) {
				const retryDelay =
					COMPRESSION_RETRY_BASE_DELAY * Math.pow(2, attempt);
				onStatusUpdate?.({
					step: 'retrying',
					message: lastError,
					sessionId,
					retryAttempt: attempt + 1,
					maxRetries: COMPRESSION_MAX_RETRIES,
				});
				await new Promise(resolve => setTimeout(resolve, retryDelay));
				continue;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : 'Unknown error';

			if (attempt < COMPRESSION_MAX_RETRIES) {
				const retryDelay =
					COMPRESSION_RETRY_BASE_DELAY * Math.pow(2, attempt);
				onStatusUpdate?.({
					step: 'retrying',
					message: lastError,
					sessionId,
					retryAttempt: attempt + 1,
					maxRetries: COMPRESSION_MAX_RETRIES,
				});
				await new Promise(resolve => setTimeout(resolve, retryDelay));
				continue;
			}
		}
	}

	// All retries exhausted
	onStatusUpdate?.({
		step: 'failed',
		message: `Failed after ${COMPRESSION_MAX_RETRIES} retries: ${lastError}`,
		sessionId,
	});
	if (onStatusUpdate) {
		setTimeout(() => onStatusUpdate(null), COMPRESSION_ERROR_DISMISS_MS);
	}
	return null;
}
