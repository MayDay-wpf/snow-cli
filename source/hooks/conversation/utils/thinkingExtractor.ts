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
		return receivedThinking.thinking;
	}
	// 2. Responses API reasoning summary
	if (receivedReasoning?.summary && receivedReasoning.summary.length > 0) {
		return receivedReasoning.summary.map(item => item.text).join('\n');
	}
	// 3. DeepSeek R1 reasoning content
	if (receivedReasoningContent) {
		return receivedReasoningContent;
	}
	return undefined;
}
