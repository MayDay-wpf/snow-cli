import type { ToolCall } from './toolExecutor.js';

/**
 * Format tool call display information for UI rendering
 */
export function formatToolCallMessage(toolCall: ToolCall): {
	toolName: string;
	args: Array<{key: string; value: string; isLast: boolean}>;
} {
	try {
		const args = JSON.parse(toolCall.function.arguments);
		const argEntries = Object.entries(args);
		const formattedArgs: Array<{key: string; value: string; isLast: boolean}> = [];

		if (argEntries.length > 0) {
			argEntries.forEach(([key, value], idx, arr) => {
				const valueStr = typeof value === 'string'
					? value.length > 60 ? `"${value.slice(0, 60)}..."` : `"${value}"`
					: JSON.stringify(value);
				formattedArgs.push({
					key,
					value: valueStr,
					isLast: idx === arr.length - 1
				});
			});
		}

		return {
			toolName: toolCall.function.name,
			args: formattedArgs
		};
	} catch (e) {
		return {
			toolName: toolCall.function.name,
			args: []
		};
	}
}
