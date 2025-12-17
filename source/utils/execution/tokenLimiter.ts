/**
 * Token Limiter - 统一的 token 长度拦截器
 * 
 * 用于在所有 MCP 工具返回给 AI 之前验证内容长度，防止超大内容导致问题
 */

export interface TokenLimitResult {
	isValid: boolean;
	tokenCount: number;
	errorMessage?: string;
}

/**
 * 验证内容的 token 长度
 * @param content - 要验证的内容（字符串或对象）
 * @param maxTokens - 最大允许的 token 数量，默认 50000
 * @returns TokenLimitResult - 验证结果
 */
export async function validateTokenLimit(
	content: any,
	maxTokens: number = 100000,
): Promise<TokenLimitResult> {
	// 如果内容为空，直接通过
	if (content === null || content === undefined) {
		return {isValid: true, tokenCount: 0};
	}

	// 将内容转换为字符串
	let contentStr: string;
	if (typeof content === 'string') {
		contentStr = content;
	} else if (typeof content === 'object') {
		// 对于对象，序列化为 JSON
		contentStr = JSON.stringify(content);
	} else {
		contentStr = String(content);
	}

	try {
		// 使用 tiktoken 计算 token 数量
		const {encoding_for_model} = await import('tiktoken');
		const encoder = encoding_for_model('gpt-4o');
		try {
			const tokens = encoder.encode(contentStr);
			const tokenCount = tokens.length;

			if (tokenCount > maxTokens) {
				return {
					isValid: false,
					tokenCount,
					errorMessage:
						`Content is too large: ${tokenCount} tokens (exceeds ${maxTokens} token limit).\n` +
						`This is a safety limit to prevent overwhelming the AI model.\n` +
						`Tip: Consider breaking down the operation into smaller chunks or filtering the data.`,
				};
			}

			return {isValid: true, tokenCount};
		} finally {
			encoder.free();
		}
	} catch (error) {
		// 如果 tiktoken 失败，使用字符数估算（1 token ≈ 4 chars）
		const estimatedTokens = Math.ceil(contentStr.length / 4);
		if (estimatedTokens > maxTokens) {
			return {
				isValid: false,
				tokenCount: estimatedTokens,
				errorMessage:
					`Content is too large: ~${estimatedTokens} tokens (estimated, exceeds ${maxTokens} token limit).\n` +
					`This is a safety limit to prevent overwhelming the AI model.\n` +
					`Tip: Consider breaking down the operation into smaller chunks or filtering the data.`,
			};
		}
		return {isValid: true, tokenCount: estimatedTokens};
	}
}

/**
 * 包装工具结果，在返回前进行 token 限制检查
 * @param result - 工具的原始返回结果
 * @param toolName - 工具名称（用于错误提示）
 * @param maxTokens - 最大允许的 token 数量
 * @returns 验证后的结果（如果超限则抛出错误）
 */
export async function wrapToolResultWithTokenLimit(
	result: any,
	toolName: string,
	maxTokens: number = 50000,
): Promise<any> {
	const validation = await validateTokenLimit(result, maxTokens);

	if (!validation.isValid) {
		throw new Error(
			`Tool "${toolName}" returned content that exceeds token limit.\n` +
				`Token count: ${validation.tokenCount} (limit: ${maxTokens})\n` +
				validation.errorMessage,
		);
	}

	return result;
}
