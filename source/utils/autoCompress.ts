import type {UsageInfo} from '../api/chat.js';
import {getOpenAiConfig} from './apiConfig.js';
import {executeContextCompression} from '../hooks/useCommandHandler.js';

/**
 * 检查 token 使用率是否达到阈值
 * @param contextUsage 当前token使用情况
 * @param threshold 阈值百分比（默认80）
 * @returns 是否需要压缩
 */
export function shouldAutoCompress(
	contextUsage: UsageInfo | null,
	threshold: number = 80,
): boolean {
	if (!contextUsage) return false;

	const {prompt_tokens, cache_creation_input_tokens, cache_read_input_tokens} =
		contextUsage;
	const maxTokens = getOpenAiConfig().maxContextTokens || 4000;

	// 计算总token
	const totalTokens =
		prompt_tokens +
		(cache_creation_input_tokens || 0) +
		(cache_read_input_tokens || 0);

	const percentage = (totalTokens / maxTokens) * 100;

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
