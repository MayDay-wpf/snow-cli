import {executeContextCompression} from '../../hooks/conversation/useCommandHandler.js';

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
 * @param sessionId - 可选的会话ID，如果提供则使用该ID加载会话进行压缩
 * @returns 压缩结果，如果失败返回null或包含hookFailed的结果
 */
export async function performAutoCompression(sessionId?: string) {
	try {
		const result = await executeContextCompression(sessionId);

		// If beforeCompress hook failed, return the result with hookFailed flag
		// The caller (useConversation.ts) will handle displaying error and aborting AI flow
		if (result && (result as any).hookFailed) {
			return result;
		}

		return result;
	} catch (error) {
		console.error('Auto-compression failed:', error);
		return null;
	}
}
