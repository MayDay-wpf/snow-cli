import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {ToolCall, ToolResult} from '../../../utils/execution/toolExecutor.js';
import {formatToolCallMessage} from '../../../utils/ui/messageFormatter.js';
import {isToolNeedTwoStepDisplay} from '../../../utils/config/toolDisplayConfig.js';

/**
 * Build UI messages for tool execution results.
 */
export function buildToolResultMessages(
	toolResults: ToolResult[],
	receivedToolCalls: ToolCall[],
	parallelGroupId: string | undefined,
): Message[] {
	const resultMessages: Message[] = [];

	for (const result of toolResults) {
		const toolCall = receivedToolCalls.find(
			tc => tc.id === result.tool_call_id,
		);
		if (!toolCall) continue;

		const isError = result.content.startsWith('Error:');
		const statusIcon = isError ? '✗' : '✓';

		// Sub-agent tools
		if (toolCall.function.name.startsWith('subagent-')) {
			let usage: any = undefined;
			if (!isError) {
				try {
					const subAgentResult = JSON.parse(result.content);
					usage = subAgentResult.usage;
				} catch {
					// Ignore parsing errors
				}
			}

			resultMessages.push({
				role: 'assistant',
				content: `${statusIcon} ${toolCall.function.name}`,
				streaming: false,
				messageStatus: isError ? 'error' : 'success',
				toolResult: !isError ? result.content : undefined,
				subAgentUsage: usage,
			});
			continue;
		}

		// Edit tool diff data
		let editDiffData = extractEditDiffData(toolCall, result);

		const toolDisplay = formatToolCallMessage(toolCall);
		const isNonTimeConsuming = !isToolNeedTwoStepDisplay(
			toolCall.function.name,
		);

		resultMessages.push({
			role: 'assistant',
			content: `${statusIcon} ${toolCall.function.name}`,
			streaming: false,
			messageStatus: isError ? 'error' : 'success',
			toolCall: editDiffData
				? {name: toolCall.function.name, arguments: editDiffData}
				: undefined,
			toolDisplay: isNonTimeConsuming ? toolDisplay : undefined,
			toolResult: !isError ? result.content : undefined,
			parallelGroup: parallelGroupId,
		});
	}

	return resultMessages;
}

function extractEditDiffData(
	toolCall: ToolCall,
	result: ToolResult,
): Record<string, any> | undefined {
	const isError = result.content.startsWith('Error:');
	if (
		(toolCall.function.name === 'filesystem-edit' ||
			toolCall.function.name === 'filesystem-edit_search') &&
		!isError
	) {
		try {
			const resultData = JSON.parse(result.content);
			if (resultData.oldContent && resultData.newContent) {
				return {
					oldContent: resultData.oldContent,
					newContent: resultData.newContent,
					filename: JSON.parse(toolCall.function.arguments).filePath,
					completeOldContent: resultData.completeOldContent,
					completeNewContent: resultData.completeNewContent,
					contextStartLine: resultData.contextStartLine,
				};
			}
			if (resultData.results && Array.isArray(resultData.results)) {
				return {
					batchResults: resultData.results,
					isBatch: true,
				};
			}
		} catch {
			// If parsing fails, show regular result
		}
	}
	return undefined;
}
