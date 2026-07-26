import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {
	ToolCall,
	ToolResult,
} from '../../../utils/execution/toolExecutor.js';
import {formatToolCallMessage} from '../../../utils/ui/messageFormatter.js';
import {extractFilesystemEditDiffFromRawResult} from '../../../utils/config/toolDisplayConfig.js';
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
	// Fallback completion timestamp for results that don't carry their own
	// completedAt (e.g. aborted results constructed in executeToolCalls before
	// the per-tool stamping). Per-tool completedAt is preferred so parallel
	// siblings don't all inherit the slowest tool's end time.
	const fallbackCompletedAt = Date.now();

	// Resolve the best available start time for a result:
	// 1) result.startedAt stamped immediately before executeToolCall
	// 2) toolStartTimes from pending UI (batch-level for parallel rounds)
	const resolveStartedAt = (result: ToolResult, toolCallId: string) => {
		if (typeof result.startedAt === 'number') {
			return result.startedAt;
		}
		const fromPending = toolStartTimes?.get(toolCallId);
		return typeof fromPending === 'number' ? fromPending : undefined;
	};

	// Group-level wall-clock elapsed = (last completedAt) - (earliest startedAt).
	// Only meaningful when more than one tool ran in parallel; for single-tool
	// rounds the per-tool durationMs already covers it. Rendered on the
	// parallelEnd indicator so users can tell batch cost apart from per-tool cost.
	let groupElapsedMs: number | undefined;
	if (parallelGroupId && receivedToolCalls.length > 1) {
		let earliestStart: number | undefined;
		let latestEnd: number | undefined;
		for (const result of toolResults) {
			const startedAt = resolveStartedAt(result, result.tool_call_id);
			if (typeof startedAt === 'number') {
				earliestStart =
					earliestStart === undefined
						? startedAt
						: Math.min(earliestStart, startedAt);
			}
			const end =
				typeof result.completedAt === 'number'
					? result.completedAt
					: fallbackCompletedAt;
			latestEnd = latestEnd === undefined ? end : Math.max(latestEnd, end);
		}
		if (
			earliestStart !== undefined &&
			latestEnd !== undefined &&
			latestEnd >= earliestStart
		) {
			groupElapsedMs = latestEnd - earliestStart;
		}
	}

	for (const result of toolResults) {
		const toolCall = receivedToolCalls.find(
			tc => tc.id === result.tool_call_id,
		);
		if (!toolCall) continue;

		const isError = result.content.startsWith('Error:');
		const statusKey = isError ? 'error' : 'success';

		// Prefer per-tool start/completion stamps from executeToolCalls so
		// sequential siblings don't inherit "batch start → my end".
		const startedAt = resolveStartedAt(result, toolCall.id);
		const completedAt =
			typeof result.completedAt === 'number'
				? result.completedAt
				: fallbackCompletedAt;
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
				parallelGroup: parallelGroupId,
				...(typeof durationMs === 'number' ? {toolDurationMs: durationMs} : {}),
				...(typeof groupElapsedMs === 'number'
					? {parallelGroupElapsedMs: groupElapsedMs}
					: {}),
			});
			continue;
		}

		// Edit tool diff data
		let editDiffData = extractEditDiffData(toolCall, result);

		const toolDisplay = formatToolCallMessage(toolCall);

		// Always keep toolDisplay for compact title summaries (basename / action).
		// Previously only non-two-step tools carried it; read/plan need path+action
		// and edit tools still benefit when compact mode hides the full arg tree.
		resultMessages.push({
			role: 'assistant',
			content: titleContent,
			streaming: false,
			messageStatus: isError ? 'error' : 'success',
			toolCallId: result.tool_call_id,
			toolCall: editDiffData
				? {name: toolCall.function.name, arguments: editDiffData}
				: undefined,
			toolDisplay,
			// Keep error text for plan/meta summaries (plain-text tools).
			toolResult: result.content,
			parallelGroup: parallelGroupId,
			...(typeof durationMs === 'number' ? {toolDurationMs: durationMs} : {}),
			...(typeof groupElapsedMs === 'number'
				? {parallelGroupElapsedMs: groupElapsedMs}
				: {}),
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
