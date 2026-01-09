/**
 * Token Limiter - 统一的 token 长度拦截器
 *
 * 用于在所有 MCP 工具返回给 AI 之前验证内容长度，防止超大内容导致问题
 */

import {getOpenAiConfig} from '../config/apiConfig.js';

/** 默认的工具返回结果 token 限制 */
const DEFAULT_TOOL_RESULT_TOKEN_LIMIT = 100000;

/**
 * 获取配置的工具返回结果 token 限制
 * @returns 配置的限制值，如果未配置则返回默认值 100000
 */
export function getToolResultTokenLimit(): number {
	try {
		const config = getOpenAiConfig();
		return config.toolResultTokenLimit ?? DEFAULT_TOOL_RESULT_TOKEN_LIMIT;
	} catch {
		return DEFAULT_TOOL_RESULT_TOKEN_LIMIT;
	}
}

export interface TokenLimitResult {
	isValid: boolean;
	tokenCount: number;
	errorMessage?: string;
}

/**
 * 移除内容中的 base64 图片数据
 * @param obj - 要处理的对象
 * @returns 移除图片数据后的对象副本
 */
function removeBase64Images(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj === 'string') {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map(item => removeBase64Images(item));
	}

	if (typeof obj === 'object') {
		const result: any = {};
		for (const key in obj) {
			if (obj.hasOwnProperty(key)) {
				// 跳过 base64 图片字段
				if (
					key === 'data' &&
					typeof obj[key] === 'string' &&
					obj.type === 'image'
				) {
					result[key] = '[base64 image data removed for token calculation]';
				} else if (key === 'source' && obj[key]?.type === 'base64') {
					result[key] = {
						...obj[key],
						data: '[base64 image data removed for token calculation]',
					};
				} else {
					result[key] = removeBase64Images(obj[key]);
				}
			}
		}
		return result;
	}

	return obj;
}

/**
 * 验证内容的 token 长度
 * @param content - 要验证的内容（字符串或对象）
 * @param maxTokens - 最大允许的 token 数量，默认从配置读取
 * @returns TokenLimitResult - 验证结果
 */
export async function validateTokenLimit(
	content: any,
	maxTokens?: number,
): Promise<TokenLimitResult> {
	const limit = maxTokens ?? getToolResultTokenLimit();
	// 如果内容为空，直接通过
	if (content === null || content === undefined) {
		return {isValid: true, tokenCount: 0};
	}

	// 移除 base64 图片数据后再进行 token 计算
	const contentWithoutImages = removeBase64Images(content);

	// 将内容转换为字符串
	let contentStr: string;
	if (typeof contentWithoutImages === 'string') {
		contentStr = contentWithoutImages;
	} else if (typeof contentWithoutImages === 'object') {
		// 对于对象，序列化为 JSON
		contentStr = JSON.stringify(contentWithoutImages);
	} else {
		contentStr = String(contentWithoutImages);
	}

	try {
		// 使用 tiktoken 计算 token 数量
		const {encoding_for_model} = await import('tiktoken');
		const encoder = encoding_for_model('gpt-4o');
		try {
			const tokens = encoder.encode(contentStr);
			const tokenCount = tokens.length;

			if (tokenCount > limit) {
				return {
					isValid: false,
					tokenCount,
					errorMessage:
						`Content is too large: ${tokenCount} tokens (exceeds ${limit} token limit).\n` +
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
		if (estimatedTokens > limit) {
			return {
				isValid: false,
				tokenCount: estimatedTokens,
				errorMessage:
					`Content is too large: ~${estimatedTokens} tokens (estimated, exceeds ${limit} token limit).\n` +
					`This is a safety limit to prevent overwhelming the AI model.\n` +
					`Tip: Consider breaking down the operation into smaller chunks or filtering the data.`,
			};
		}
		return {isValid: true, tokenCount: estimatedTokens};
	}
}

/**
 * 截断字符串到指定的 token 数量
 * @param content - 要截断的字符串
 * @param maxTokens - 最大 token 数量
 * @returns 截断后的字符串
 */
async function truncateToTokenLimit(
	content: string,
	maxTokens: number,
): Promise<string> {
	try {
		const {encoding_for_model} = await import('tiktoken');
		const encoder = encoding_for_model('gpt-4o');
		try {
			const tokens = encoder.encode(content);
			if (tokens.length <= maxTokens) {
				return content;
			}
			// 截断 tokens 并解码回字符串
			const truncatedTokens = tokens.slice(0, maxTokens);
			const decoder = new TextDecoder();
			return decoder.decode(encoder.decode(truncatedTokens));
		} finally {
			encoder.free();
		}
	} catch {
		// 如果 tiktoken 失败，使用字符数估算（1 token ≈ 4 chars）
		const maxChars = maxTokens * 4;
		if (content.length <= maxChars) {
			return content;
		}
		return content.slice(0, maxChars);
	}
}

/**
 * 包装工具结果，在返回前进行 token 限制检查
 * 如果超限，会截断内容并附加提示信息
 * @param result - 工具的原始返回结果
 * @param toolName - 工具名称（用于提示）
 * @param maxTokens - 最大允许的 token 数量，默认从配置读取
 * @returns 处理后的结果（如果超限则截断并附加提示）
 */
export async function wrapToolResultWithTokenLimit(
	result: any,
	toolName: string,
	maxTokens?: number,
): Promise<any> {
	const limit = maxTokens ?? getToolResultTokenLimit();
	const validation = await validateTokenLimit(result, limit);

	if (!validation.isValid) {
		// 将结果转换为字符串进行截断
		let contentStr: string;
		if (typeof result === 'string') {
			contentStr = result;
		} else if (typeof result === 'object') {
			contentStr = JSON.stringify(result, null, 2);
		} else {
			contentStr = String(result);
		}

		// 预留一些 token 给截断提示信息（约 100 tokens）
		const reservedTokens = 100;
		const truncateLimit = Math.max(limit - reservedTokens, limit * 0.9);
		const truncatedContent = await truncateToTokenLimit(
			contentStr,
			truncateLimit,
		);

		const truncationNotice =
			`\n\n[TRUNCATED] Tool "${toolName}" output was truncated due to token limit.\n` +
			`Original: ~${validation.tokenCount} tokens | Limit: ${limit} tokens\n` +
			`The content above is incomplete. Consider using more specific queries or filters to get smaller results.`;

		return truncatedContent + truncationNotice;
	}

	return result;
}
