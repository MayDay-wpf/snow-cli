import {executeContextCompression} from '../../hooks/useCommandHandler.js';

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
 * 执行自动压缩
 * @returns 压缩结果，如果失败返回null
 */
export async function performAutoCompression() {
	try {
		const result = await executeContextCompression();
		return result;
	} catch (error) {
		console.error('Auto-compression failed:', error);
		return null;
	}
}
