import type { ChatMessage } from '../api/chat.js';
import type { Message } from '../ui/components/MessageList.js';
import { formatToolCallMessage } from './messageFormatter.js';

/**
 * Convert API format session messages to UI format messages
 */
export function convertSessionMessagesToUI(sessionMessages: ChatMessage[]): Message[] {
	const uiMessages: Message[] = [];

	for (const msg of sessionMessages) {
		// Skip system messages
		if (msg.role === 'system') continue;

		// Handle tool role messages (tool execution results)
		if (msg.role === 'tool') {
			const isError = msg.content.startsWith('Error:');
			const statusIcon = isError ? '✗' : '✓';
			const statusText = isError ? `\n  └─ ${msg.content}` : '';
			const toolName = msg.tool_call_id || 'unknown-tool';

			uiMessages.push({
				role: 'assistant',
				content: `${statusIcon} ${toolName}${statusText}`,
				streaming: false,
				toolResult: !isError ? msg.content : undefined
			});
			continue;
		}

		// Handle user and assistant messages
		const uiMessage: Message = {
			role: msg.role as 'user' | 'assistant',
			content: msg.content,
			streaming: false,
			images: msg.images
		};

		// If assistant message has tool_calls, expand to show each tool call
		if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
			for (const toolCall of msg.tool_calls) {
				const toolDisplay = formatToolCallMessage(toolCall as any);
				let toolArgs;
				try {
					toolArgs = JSON.parse(toolCall.function.arguments);
				} catch (e) {
					toolArgs = {};
				}

				uiMessages.push({
					role: 'assistant',
					content: `⚡ ${toolDisplay.toolName}`,
					streaming: false,
					toolCall: {
						name: toolCall.function.name,
						arguments: toolArgs
					},
					toolDisplay
				});
			}
		} else {
			// Add regular message directly
			uiMessages.push(uiMessage);
		}
	}

	return uiMessages;
}
