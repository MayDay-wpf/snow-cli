import {executeSubAgent} from '../utils/subAgentExecutor.js';
import {getUserSubAgents} from '../utils/subAgentConfig.js';
import type {SubAgentMessage} from '../utils/subAgentExecutor.js';
import type {ToolCall} from '../utils/toolExecutor.js';
import type {ConfirmationResult} from '../ui/components/ToolConfirmation.js';

export interface SubAgentToolExecutionOptions {
	agentId: string;
	prompt: string;
	onMessage?: (message: SubAgentMessage) => void;
	abortSignal?: AbortSignal;
	requestToolConfirmation?: (
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	) => Promise<ConfirmationResult>;
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
		// Get only user-configured agents (built-in agents are hardcoded below)
		const userAgents = getUserSubAgents();

		// Built-in agents (hardcoded, always available)
		const tools = [
			{
				name: 'agent_explore',
				description:
					'Explore Agent: Specialized for quickly exploring and understanding codebases. Excels at searching code, finding definitions, analyzing code structure and dependencies. Read-only operations, will not modify files or execute commands.',
				inputSchema: {
					type: 'object',
					properties: {
						prompt: {
							type: 'string',
							description:
								'Description of the exploration task (e.g., find implementation of a feature, analyze module dependencies)',
						},
					},
					required: ['prompt'],
				},
			},
			{
				name: 'agent_plan',
				description:
					'Plan Agent: Specialized for planning complex tasks. Analyzes requirements, explores code, identifies relevant files, and creates detailed implementation plans. Read-only operations, outputs structured implementation proposals.',
				inputSchema: {
					type: 'object',
					properties: {
						prompt: {
							type: 'string',
							description:
								'Description of the task to plan (e.g., how to implement a new feature, how to refactor a module)',
						},
					},
					required: ['prompt'],
				},
			},
			{
				name: 'agent_general',
				description:
					'General Purpose Agent: General-purpose multi-step task execution agent. Has full tool access for searching, modifying files, and executing commands. Best for complex tasks requiring actual operations.',
				inputSchema: {
					type: 'object',
					properties: {
						prompt: {
							type: 'string',
							description: 'Description of the general task to execute',
						},
					},
					required: ['prompt'],
				},
			},
		];

		// Add user-configured agents (avoid duplicates with built-in)
		tools.push(
			...userAgents.map(agent => ({
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
			})),
		);

		return tools;
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
