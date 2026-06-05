import type {CompressionStatus} from '../../ui/components/compression/CompressionStatus.js';
import {executeContextCompression} from '../../hooks/conversation/useCommandHandler.js';
import {withCompactSpan} from '../telemetry/otel.js';

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
 * 执行自动上下文压缩，失败时最多重试 3 次。
 */
export async function performAutoCompression(
	sessionId?: string,
	onStatusUpdate?: (status: CompressionStatus | null) => void,
) {
	return withCompactSpan(
		{
			name: 'snow.cli.compact',
			sessionId,
			conversationId: sessionId,
		},
		async () => {
			let lastError = '';

			for (let attempt = 0; attempt <= COMPRESSION_MAX_RETRIES; attempt++) {
				try {
					let failedInAttempt = false;

					const result = await executeContextCompression(sessionId, status => {
						if (status.step === 'failed') {
							failedInAttempt = true;
							lastError = status.message || 'Unknown error';
							// Don't forward failed status to UI during retries;
							// retry logic below will show 'retrying' or final 'failed' instead.
							return;
						}

						onStatusUpdate?.(status);
					});

					if (result && (result as {hookFailed?: boolean}).hookFailed) {
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
		},
	);
}
