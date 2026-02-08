import {executeSubAgent} from '../utils/execution/subAgentExecutor.js';
import {getUserSubAgents} from '../utils/config/subAgentConfig.js';
import type {SubAgentMessage} from '../utils/execution/subAgentExecutor.js';
import type {ToolCall} from '../utils/execution/toolExecutor.js';
import type {ConfirmationResult} from '../ui/components/tools/ToolConfirmation.js';

export interface SubAgentToolExecutionOptions {
	agentId: string;
	prompt: string;
	/** Unique execution instance ID for message injection from the main flow */
	instanceId?: string;
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
	requestUserQuestion?: (
		question: string,
		options: string[],
		multiSelect?: boolean,
	) => Promise<{selected: string | string[]; customInput?: string}>;
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
			instanceId,
			onMessage,
			abortSignal,
			requestToolConfirmation,
			isToolAutoApproved,
			yoloMode,
			addToAlwaysApproved,
			requestUserQuestion,
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
			requestUserQuestion,
			instanceId,
		);

		if (!result.success) {
			throw new Error(result.error || 'Sub-agent execution failed');
		}

		return {
			success: true,
			result: result.result,
			usage: result.usage,
			injectedUserMessages: result.injectedUserMessages,
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
		// Get user-configured agents (built-in agents are hardcoded below)
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
								'CRITICAL: Provide COMPLETE context from main session. Sub-agent has NO access to main conversation history. Include: (1) Full task description with business requirements, (2) Known file locations and code paths, (3) Relevant code snippets or patterns already discovered, (4) Any constraints or important context. Example: "Explore authentication implementation. Main flow uses OAuth in src/auth/oauth.ts, need to find all related error handling. User mentioned JWT tokens are validated in middleware."',
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
								'CRITICAL: Provide COMPLETE context from main session. Sub-agent has NO access to main conversation history. Include: (1) Full requirement details and business objectives, (2) Current architecture/file structure understanding, (3) Known dependencies and constraints, (4) Files/modules already identified that need changes, (5) User preferences or specific implementation approaches mentioned. Example: "Plan caching implementation. Current API uses Express in src/server.ts, data layer in src/models/. Need Redis caching, user wants minimal changes to existing controllers in src/controllers/."',
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
							description:
								'CRITICAL: Provide COMPLETE context from main session. Sub-agent has NO access to main conversation history. Include: (1) Full task description with step-by-step requirements, (2) Exact file paths and locations to modify, (3) Code patterns/snippets to follow or replicate, (4) Dependencies between files/changes, (5) Testing/verification requirements, (6) Any business logic or constraints discovered in main session. Example: "Update error handling across API. Files: src/api/users.ts, src/api/posts.ts, src/api/comments.ts. Replace old pattern try-catch with new ErrorHandler class from src/utils/errorHandler.ts. Must preserve existing error codes. Run npm test after changes."',
						},
					},
					required: ['prompt'],
				},
			},
		];

		// Built-in agent IDs (used to filter out duplicates)
		const builtInAgentIds = new Set([
			'agent_explore',
			'agent_plan',
			'agent_general',
		]);

		// Add user-configured agents (filter out duplicates with built-in)
		tools.push(
			...userAgents
				.filter(agent => !builtInAgentIds.has(agent.id))
				.map(agent => ({
					name: agent.id,
					description: `${agent.name}: ${agent.description}`,
					inputSchema: {
						type: 'object',
						properties: {
							prompt: {
								type: 'string',
								description:
									'CRITICAL: Provide COMPLETE context from main session. Sub-agent has NO access to main conversation history. Include all relevant: (1) Task requirements and objectives, (2) Known file locations and code structure, (3) Business logic and constraints, (4) Code patterns or examples, (5) Dependencies and relationships. Be specific and comprehensive - sub-agent cannot ask for clarification from main session.',
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
