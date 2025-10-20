import {executeMCPTool} from './mcpToolsManager.js';
import {subAgentService} from '../mcp/subagent.js';
import type {SubAgentMessage} from './subAgentExecutor.js';

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

export type SubAgentMessageCallback = (message: SubAgentMessage) => void;

export interface ToolConfirmationCallback {
	(
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	): Promise<string>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

/**
 * Execute a single tool call and return the result
 */
export async function executeToolCall(
	toolCall: ToolCall,
	abortSignal?: AbortSignal,
	onTokenUpdate?: (tokenCount: number) => void,
	onSubAgentMessage?: SubAgentMessageCallback,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
): Promise<ToolResult> {
	try {
		const args = JSON.parse(toolCall.function.arguments);

		// Check if this is a sub-agent tool
		if (toolCall.function.name.startsWith('subagent-')) {
			const agentId = toolCall.function.name.substring('subagent-'.length);

			// Create a tool confirmation adapter for sub-agent
			const subAgentToolConfirmation = requestToolConfirmation
				? async (toolName: string, toolArgs: any) => {
						// Create a fake tool call for confirmation
						const fakeToolCall: ToolCall = {
							id: 'subagent-tool',
							type: 'function',
							function: {
								name: toolName,
								arguments: JSON.stringify(toolArgs),
							},
						};
						return await requestToolConfirmation(fakeToolCall);
				  }
				: undefined;

			const result = await subAgentService.execute({
				agentId,
				prompt: args.prompt,
				onMessage: onSubAgentMessage,
				abortSignal,
				requestToolConfirmation: subAgentToolConfirmation
					? async (toolCall: ToolCall) => {
							// Use the adapter to convert to the expected signature
							const args = JSON.parse(toolCall.function.arguments);
							return await subAgentToolConfirmation(
								toolCall.function.name,
								args,
							);
					  }
					: undefined,
				isToolAutoApproved,
				yoloMode,
			});

			return {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: JSON.stringify(result),
			};
		}

		// Regular tool execution
		const result = await executeMCPTool(
			toolCall.function.name,
			args,
			abortSignal,
			onTokenUpdate,
		);

		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify(result),
		};
	} catch (error) {
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: `Error: ${
				error instanceof Error ? error.message : 'Tool execution failed'
			}`,
		};
	}
}

/**
 * Execute multiple tool calls in parallel
 */
export async function executeToolCalls(
	toolCalls: ToolCall[],
	abortSignal?: AbortSignal,
	onTokenUpdate?: (tokenCount: number) => void,
	onSubAgentMessage?: SubAgentMessageCallback,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
): Promise<ToolResult[]> {
	return Promise.all(
		toolCalls.map(tc =>
			executeToolCall(
				tc,
				abortSignal,
				onTokenUpdate,
				onSubAgentMessage,
				requestToolConfirmation,
				isToolAutoApproved,
				yoloMode,
			),
		),
	);
}
