import {executeMCPTool} from './mcpToolsManager.js';
import {subAgentService} from '../mcp/subagent.js';
import type {SubAgentMessage} from './subAgentExecutor.js';
import type {ConfirmationResult} from '../ui/components/ToolConfirmation.js';

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
	): Promise<ConfirmationResult>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

export interface AddToAlwaysApprovedCallback {
	(toolName: string): void;
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
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
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
				addToAlwaysApproved,
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
 * Categorize tools by their resource type for proper execution sequencing
 */
function getToolResourceType(toolName: string): string {
	// TODO tools all modify the same TODO file - must be sequential
	if (
		toolName === 'todo-create' ||
		toolName === 'todo-update' ||
		toolName === 'todo-add' ||
		toolName === 'todo-delete'
	) {
		return 'todo-state';
	}

	// Terminal commands must be sequential to avoid race conditions
	// (e.g., npm install -> npm build, port conflicts, file locks)
	if (toolName === 'terminal-execute') {
		return 'terminal-execution';
	}

	// Each file is a separate resource
	if (
		toolName === 'filesystem-edit' ||
		toolName === 'filesystem-edit_search' ||
		toolName === 'filesystem-create' ||
		toolName === 'filesystem-delete'
	) {
		return 'filesystem'; // Will be further refined by file path
	}

	// Other tools are independent
	return 'independent';
}

/**
 * Get resource identifier for a tool call
 * Tools modifying the same resource will have the same identifier
 */
function getResourceIdentifier(toolCall: ToolCall): string {
	const toolName = toolCall.function.name;
	const resourceType = getToolResourceType(toolName);

	if (resourceType === 'todo-state') {
		return 'todo-state'; // All TODO operations share same resource
	}

	if (resourceType === 'terminal-execution') {
		return 'terminal-execution'; // All terminal commands share same execution context
	}

	if (resourceType === 'filesystem') {
		try {
			const args = JSON.parse(toolCall.function.arguments);
			// Support both single file and array of files
			const filePath = args.filePath;
			if (typeof filePath === 'string') {
				return `filesystem:${filePath}`;
			} else if (Array.isArray(filePath)) {
				// For batch operations, treat as independent (already handling multiple files)
				return `filesystem-batch:${toolCall.id}`;
			}
		} catch {
			// Parsing error, treat as independent
		}
	}

	// Each independent tool gets its own unique identifier
	return `independent:${toolCall.id}`;
}

/**
 * Execute multiple tool calls with intelligent sequencing
 * - Tools modifying the same resource execute sequentially
 * - Independent tools execute in parallel
 */
export async function executeToolCalls(
	toolCalls: ToolCall[],
	abortSignal?: AbortSignal,
	onTokenUpdate?: (tokenCount: number) => void,
	onSubAgentMessage?: SubAgentMessageCallback,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
): Promise<ToolResult[]> {
	// Group tool calls by their resource identifier
	const resourceGroups = new Map<string, ToolCall[]>();

	for (const toolCall of toolCalls) {
		const resourceId = getResourceIdentifier(toolCall);
		const group = resourceGroups.get(resourceId) || [];
		group.push(toolCall);
		resourceGroups.set(resourceId, group);
	}

	// Execute each resource group sequentially, but execute different groups in parallel
	const results = await Promise.all(
		Array.from(resourceGroups.values()).map(async group => {
			// Within the same resource group, execute sequentially
			const groupResults: ToolResult[] = [];
			for (const toolCall of group) {
				const result = await executeToolCall(
					toolCall,
					abortSignal,
					onTokenUpdate,
					onSubAgentMessage,
					requestToolConfirmation,
					isToolAutoApproved,
					yoloMode,
					addToAlwaysApproved,
				);
				groupResults.push(result);
			}
			return groupResults;
		}),
	);

	// Flatten results and restore original order
	const flatResults = results.flat();
	const resultMap = new Map(flatResults.map(r => [r.tool_call_id, r]));

	return toolCalls.map(tc => {
		const result = resultMap.get(tc.id);
		if (!result) {
			throw new Error(`Result not found for tool call ${tc.id}`);
		}
		return result;
	});
}
