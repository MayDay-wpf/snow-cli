import { executeMCPTool } from './mcpToolsManager.js';

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ToolResult {
	tool_call_id: string;
	role: 'tool';
	content: string;
}

/**
 * Execute a single tool call and return the result
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
	try {
		const args = JSON.parse(toolCall.function.arguments);
		const result = await executeMCPTool(toolCall.function.name, args);

		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify(result)
		};
	} catch (error) {
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}`
		};
	}
}

/**
 * Execute multiple tool calls in parallel
 */
export async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
	return Promise.all(toolCalls.map(tc => executeToolCall(tc)));
}
