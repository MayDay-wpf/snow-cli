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
 * Clean thinking content by removing outer XML-like tags (<think>...</think>, <thinking>...</thinking>)
 * while strictly protecting internal Markdown code fences (``` or ~~~) and preserving indentation/newlines.
 *
 * @param content - Raw thinking content
 * @returns Cleaned thinking content
 */
export function cleanThinkingContent(content: string): string {
	if (!content) {
		return '';
	}

	const lines = content.split('\n');
	const cleanedLines: string[] = [];
	let inFence = false;
	let fenceMarker = '';

	const fenceRegex = /^\s*(`{3,}|~{3,})/;
	// Match think tags only, with optional horizontal whitespace around them on the same line.
	// We do NOT use \s* across lines, to protect original line breaks and code layout.
	const tagRegex = /[ \t]*<\/?(?:think|thinking)>[ \t]*/gi;

	for (const line of lines) {
		const fenceMatch = line.match(fenceRegex);
		if (fenceMatch && fenceMatch[1]) {
			const marker = fenceMatch[1];
			const char = marker[0];
			if (!inFence) {
				inFence = true;
				fenceMarker = marker;
			} else if (char === fenceMarker[0] && marker.length >= fenceMarker.length) {
				inFence = false;
				fenceMarker = '';
			}
			cleanedLines.push(line);
			continue;
		}

		if (inFence) {
			cleanedLines.push(line);
		} else {
			cleanedLines.push(line.replace(tagRegex, ''));
		}
	}

	return cleanedLines.join('\n').trim();
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
