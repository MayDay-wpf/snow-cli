/**
 * Reasoning data structure from Responses API
 */
interface ReasoningData {
	summary?: Array<{type: 'summary_text'; text: string}>;
	content?: any;
	encrypted_content?: string;
}

/**
 * Thinking data structure from Anthropic
 */
interface ThinkingData {
	type: 'thinking';
	thinking: string;
	signature?: string;
}

/**
 * Clean thinking content by removing XML-like tags
 * Some third-party APIs (e.g., DeepSeek R1) may include <think></think> or <thinking></thinking> tags
 * in the reasoning content that should be stripped
 *
 * @param content - Raw thinking content
 * @returns Cleaned thinking content
 */
function cleanThinkingContent(content: string): string {
	// Remove <think>, </think>, <thinking>, </thinking> tags (with surrounding whitespace/newlines)
	return content
		.replace(/\s*<\/?think(?:ing)?>\s*/gi, '')
		.trim();
}

/**
 * Extract thinking content from various sources
 *
 * Supports multiple reasoning formats:
 * 1. Anthropic Extended Thinking
 * 2. Responses API reasoning summary
 * 3. DeepSeek R1 reasoning content
 *
 * @param receivedThinking - Anthropic thinking data
 * @param receivedReasoning - Responses API reasoning data
 * @param receivedReasoningContent - DeepSeek R1 reasoning content
 * @returns Extracted thinking content or undefined
 */
export function extractThinkingContent(
	receivedThinking?: ThinkingData,
	receivedReasoning?: ReasoningData,
	receivedReasoningContent?: string,
): string | undefined {
	// 1. Anthropic Extended Thinking
	if (receivedThinking?.thinking) {
		return cleanThinkingContent(receivedThinking.thinking);
	}
	// 2. Responses API reasoning summary
	if (receivedReasoning?.summary && receivedReasoning.summary.length > 0) {
		const content = receivedReasoning.summary.map(item => item.text).join('\n');
		return cleanThinkingContent(content);
	}
	// 3. DeepSeek R1 reasoning content
	if (receivedReasoningContent) {
		return cleanThinkingContent(receivedReasoningContent);
	}
	return undefined;
}
