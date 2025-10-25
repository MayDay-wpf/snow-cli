import {executeSubAgent} from '../utils/subAgentExecutor.js';
import {getSubAgents} from '../utils/subAgentConfig.js';
import type {SubAgentMessage} from '../utils/subAgentExecutor.js';
import type {ToolCall} from '../utils/toolExecutor.js';

export interface SubAgentToolExecutionOptions {
	agentId: string;
	prompt: string;
	onMessage?: (message: SubAgentMessage) => void;
	abortSignal?: AbortSignal;
	requestToolConfirmation?: (
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	) => Promise<string>;
	isToolAutoApproved?: (toolName: string) => boolean;
	yoloMode?: boolean;
	addToAlwaysApproved?: (toolName: string) => void;
}

/**
 * Sub-Agent MCP Service
 * Provides tools for executing sub-agents with their own specialized system prompts and tool access
 */
export class SubAgentService {
	/**
	 * Execute a sub-agent as a tool
	 */
	async execute(options: SubAgentToolExecutionOptions): Promise<any> {
		const {
			agentId,
			prompt,
			onMessage,
			abortSignal,
			requestToolConfirmation,
			isToolAutoApproved,
			yoloMode,
			addToAlwaysApproved,
		} = options;

		// Create a tool confirmation adapter for sub-agent if needed
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

		const result = await executeSubAgent(
			agentId,
			prompt,
			onMessage,
			abortSignal,
			subAgentToolConfirmation,
			isToolAutoApproved,
			yoloMode,
			addToAlwaysApproved,
		);

		if (!result.success) {
			throw new Error(result.error || 'Sub-agent execution failed');
		}

		return {
			success: true,
			result: result.result,
		};
	}

	/**
	 * Get all available sub-agents as MCP tools
	 */
	getTools(): Array<{
		name: string;
		description: string;
		inputSchema: any;
	}> {
		const subAgents = getSubAgents();

		return subAgents.map(agent => ({
			name: agent.id,
			description: `${agent.name}: ${agent.description}`,
			inputSchema: {
				type: 'object',
				properties: {
					prompt: {
						type: 'string',
						description: 'The task prompt to send to the sub-agent',
					},
				},
				required: ['prompt'],
			},
		}));
	}
}

// Export a default instance
export const subAgentService = new SubAgentService();

// MCP Tool definitions (dynamically generated from configuration)
// Note: These are generated at runtime, so we export a function instead of a constant
export function getMCPTools(): Array<{
	name: string;
	description: string;
	inputSchema: any;
}> {
	return subAgentService.getTools();
}
