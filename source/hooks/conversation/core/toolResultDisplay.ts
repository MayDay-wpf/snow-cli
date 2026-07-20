import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {
	ToolCall,
	ToolResult,
} from '../../../utils/execution/toolExecutor.js';
import {formatToolCallMessage} from '../../../utils/ui/messageFormatter.js';
import {
	extractFilesystemEditDiffFromRawResult,
	isToolNeedTwoStepDisplay,
} from '../../../utils/config/toolDisplayConfig.js';
import {formatToolTitleLine} from '../../../ui/components/special/toolIcons.js';
import {
	formatDurationMs,
	MIN_TOOL_DURATION_DISPLAY_MS,
} from '../../../utils/core/textUtils.js';

/**
 * Build UI messages for tool execution results.
 */
export function buildToolResultMessages(
	toolResults: ToolResult[],
	receivedToolCalls: ToolCall[],
	parallelGroupId: string | undefined,
	toolStartTimes?: Map<string, number>,
): Message[] {
	const resultMessages: Message[] = [];
	const completedAt = Date.now();

	for (const result of toolResults) {
		const toolCall = receivedToolCalls.find(
			tc => tc.id === result.tool_call_id,
		);
		if (!toolCall) continue;

		const isError = result.content.startsWith('Error:');
		const statusKey = isError ? 'error' : 'success';

		const startedAt = toolStartTimes?.get(toolCall.id);
		const durationMs =
			typeof startedAt === 'number' ? completedAt - startedAt : undefined;
		const durationLabel =
			typeof durationMs === 'number' &&
			durationMs >= MIN_TOOL_DURATION_DISPLAY_MS
				? formatDurationMs(durationMs)
				: '';
		const titleBase = formatToolTitleLine(toolCall.function.name, statusKey);
		const titleContent = durationLabel
			? `${titleBase} (${durationLabel})`
			: titleBase;

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
				content: titleContent,
				streaming: false,
				messageStatus: isError ? 'error' : 'success',
				toolCallId: result.tool_call_id,
				toolResult: !isError ? result.content : undefined,
				subAgentUsage: usage,
				...(typeof durationMs === 'number' ? {toolDurationMs: durationMs} : {}),
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
			content: titleContent,
			streaming: false,
			messageStatus: isError ? 'error' : 'success',
			toolCallId: result.tool_call_id,
			toolCall: editDiffData
				? {name: toolCall.function.name, arguments: editDiffData}
				: undefined,
			toolDisplay: isNonTimeConsuming ? toolDisplay : undefined,
			toolResult: !isError ? result.content : undefined,
			parallelGroup: parallelGroupId,
			...(typeof durationMs === 'number' ? {toolDurationMs: durationMs} : {}),
		});
	}

	return resultMessages;
}

function extractEditDiffData(
	toolCall: ToolCall,
	result: ToolResult,
): Record<string, any> | undefined {
	if (
		toolCall.function.name !== 'filesystem-edit' &&
		toolCall.function.name !== 'filesystem-replaceedit' &&
		toolCall.function.name !== 'filesystem-create'
	) {
		return undefined;
	}

	const isError = result.content.startsWith('Error:');
	if (isError) return undefined;

	// Prefer pre-extracted diff data (survives token truncation)
	if (result.editDiffData) {
		return result.editDiffData;
	}

	// Fallback: parse from content string
	try {
		const resultData = JSON.parse(result.content);
		const fromParsed = extractFilesystemEditDiffFromRawResult(
			toolCall.function.name,
			resultData,
		);
		if (fromParsed) {
			if (!fromParsed['filename']) {
				try {
					const callArgs = JSON.parse(toolCall.function.arguments);
					if (typeof callArgs.filePath === 'string') {
						fromParsed['filename'] = callArgs.filePath;
					}
				} catch {
					// ignore
				}
			}
			return fromParsed;
		}
	} catch {
		// If parsing fails, show regular result
	}

	// For filesystem-create single file: the result is a plain string message,
	// not a JSON object. Extract content/path from the tool call arguments.
	if (toolCall.function.name === 'filesystem-create') {
		try {
			const callArgs = JSON.parse(toolCall.function.arguments);
			if (
				typeof callArgs.filePath === 'string' &&
				typeof callArgs.content === 'string'
			) {
				return {
					content: callArgs.content,
					path: callArgs.filePath,
				};
			}
		} catch {
			// ignore
		}
	}

	return undefined;
}
