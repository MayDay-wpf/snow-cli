import type {ChatMessage} from '../api/chat.js';
import type {Message} from '../ui/components/MessageList.js';
import {formatToolCallMessage} from './messageFormatter.js';

/**
 * Convert API format session messages to UI format messages
 */
export function convertSessionMessagesToUI(
	sessionMessages: ChatMessage[],
): Message[] {
	const uiMessages: Message[] = [];

	// First pass: build a map of tool_call_id to tool results
	const toolResultsMap = new Map<string, string>();
	for (const msg of sessionMessages) {
		if (msg.role === 'tool' && msg.tool_call_id) {
			toolResultsMap.set(msg.tool_call_id, msg.content);
		}
	}

	for (const msg of sessionMessages) {
		// Skip system messages
		if (msg.role === 'system') continue;

		// Skip tool role messages (we'll attach them to tool calls)
		if (msg.role === 'tool') continue;

		// Handle user and assistant messages
		const uiMessage: Message = {
			role: msg.role as 'user' | 'assistant',
			content: msg.content,
			streaming: false,
			images: msg.images,
		};

		// If assistant message has tool_calls, expand to show each tool call
		if (
			msg.role === 'assistant' &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			for (const toolCall of msg.tool_calls) {
				const toolDisplay = formatToolCallMessage(toolCall as any);
				let toolArgs;
				try {
					toolArgs = JSON.parse(toolCall.function.arguments);
				} catch (e) {
					toolArgs = {};
				}

				// Get the tool result for this tool call
				const toolResult = toolResultsMap.get(toolCall.id);
				const isError = toolResult?.startsWith('Error:') || false;

				// For filesystem-edit, try to extract diff data from result
				let editDiffData:
					| {oldContent?: string; newContent?: string; filename?: string}
					| undefined;
				if (
					toolCall.function.name === 'filesystem-edit' &&
					toolResult &&
					!isError
				) {
					try {
						const resultData = JSON.parse(toolResult);
						if (resultData.oldContent && resultData.newContent) {
							editDiffData = {
								oldContent: resultData.oldContent,
								newContent: resultData.newContent,
								filename: toolArgs.filePath,
							};
							// Merge diff data into toolArgs for DiffViewer
							toolArgs.oldContent = resultData.oldContent;
							toolArgs.newContent = resultData.newContent;
						}
					} catch (e) {
						// If parsing fails, just show regular result
					}
				}

				// For terminal-execute, try to extract terminal result data
				let terminalResultData:
					| {
							stdout?: string;
							stderr?: string;
							exitCode?: number;
							command?: string;
					  }
					| undefined;
				if (
					toolCall.function.name === 'terminal-execute' &&
					toolResult &&
					!isError
				) {
					try {
						const resultData = JSON.parse(toolResult);
						if (
							resultData.stdout !== undefined ||
							resultData.stderr !== undefined
						) {
							terminalResultData = {
								stdout: resultData.stdout,
								stderr: resultData.stderr,
								exitCode: resultData.exitCode,
								command: toolArgs.command,
							};
						}
					} catch (e) {
						// If parsing fails, just show regular result
					}
				}

				// Create tool call message
				uiMessages.push({
					role: 'assistant',
					content: `⚡ ${toolDisplay.toolName}`,
					streaming: false,
					toolCall: {
						name: toolCall.function.name,
						arguments: toolArgs,
					},
					toolDisplay,
				});

				// Create tool result message
				if (toolResult) {
					const statusIcon = isError ? '✗' : '✓';
					const statusText = isError ? `\n  └─ ${toolResult}` : '';

					uiMessages.push({
						role: 'assistant',
						content: `${statusIcon} ${toolCall.function.name}${statusText}`,
						streaming: false,
						toolResult: !isError ? toolResult : undefined,
						toolCall:
							editDiffData || terminalResultData
								? {
										name: toolCall.function.name,
										arguments: toolArgs,
								  }
								: undefined,
						terminalResult: terminalResultData,
					});
				}
			}
		} else {
			// Add regular message directly
			uiMessages.push(uiMessage);
		}
	}

	return uiMessages;
}
