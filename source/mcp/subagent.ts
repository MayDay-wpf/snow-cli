import {executeSubAgentInChildProcess} from '../utils/execution/agentChildProcess.js';
import {getUserSubAgents} from '../utils/config/subAgentConfig.js';
import {subAgentSessionStore} from '../utils/execution/subAgentSessionStore.js';
import {sessionManager} from '../utils/session/sessionManager.js';
import {getConversationContext} from '../utils/codebase/conversationContext.js';
import type {ChatMessage} from '../api/chat.js';
import type {SubAgentMessage} from '../utils/execution/subAgentTypes.js';
import type {ToolCall} from '../utils/execution/toolExecutor.js';
import type {ConfirmationResult} from '../ui/components/tools/ToolConfirmation.js';

export interface SubAgentToolExecutionOptions {
	agentId: string;
	prompt: string;
	/** Unique execution instance ID for message injection from the main flow */
	instanceId?: string;
	/**
	 * Raw tool arguments (only used by built-in session management tools
	 * like agent_session_query / agent_session_continue).
	 */
	args?: any;
	/**
	 * Resume context: full conversation history of a previous run of the same
	 * logical sub-agent session. When provided the sub-agent re-activates
	 * with its previous context instead of starting fresh.
	 */
	resumeMessages?: ChatMessage[];
	/**
	 * Logical session store key. When provided, the conversation history is
	 * persisted under this key (updating the original record) instead of
	 * creating a new one — used by agent_session_continue.
	 */
	sessionKey?: string;
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
	 * Execute a sub-agent as a tool.
	 * Also routes built-in session management tools
	 * (agent_session_query / agent_session_continue) that re-activate a
	 * previously executed sub-agent within the same conversation while
	 * inheriting its full context.
	 */
	async execute(options: SubAgentToolExecutionOptions): Promise<any> {
		if (options.agentId === 'agent_session_query') {
			return this.querySessions();
		}
		if (options.agentId === 'agent_session_continue') {
			return this.continueSession(options);
		}
		return this.runAgent(options);
	}

	/**
	 * Run a sub-agent (fresh execution or resumed with inherited context)
	 * and persist its conversation history for same-session re-activation.
	 */
	private async runAgent(options: SubAgentToolExecutionOptions): Promise<any> {
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
			resumeMessages,
			sessionKey,
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

		const result = await executeSubAgentInChildProcess(
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
			undefined,
			resumeMessages,
		);

		// Persist the full conversation history for same-session reactivation.
		// Saved even on failure so the main flow can resume a failed run too.
		if (result.conversationHistory && result.conversationHistory.length > 0) {
			const existing = sessionKey
				? subAgentSessionStore.get(sessionKey)
				: undefined;
			const recordKey =
				sessionKey ??
				instanceId ??
				`auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			subAgentSessionStore.save({
				key: recordKey,
				sessionId: getCurrentSessionId(),
				agentId,
				agentName: resolveAgentName(agentId),
				prompt: existing?.prompt ?? prompt,
				status: result.success
					? 'completed'
					: result.error === 'Sub-agent execution aborted'
					? 'aborted'
					: 'failed',
				messages: result.conversationHistory,
				lastResult: result.result || undefined,
				lastError: result.error,
				resumeCount: existing ? existing.resumeCount + 1 : 0,
				startedAt: existing?.startedAt ?? new Date(),
				updatedAt: new Date(),
			});
		}

		if (!result.success) {
			throw new Error(result.error || 'Sub-agent execution failed');
		}

		return {
			success: true,
			result: result.result,
			usage: result.usage,
			injectedUserMessages: result.injectedUserMessages,
			terminationInstructions: result.terminationInstructions,
		};
	}

	/**
	 * agent_session_query: list sub-agent sessions executed in the current
	 * conversation so the main flow can pick one to re-activate.
	 */
	private querySessions(): any {
		const sessionId = getCurrentSessionId();
		const records = subAgentSessionStore.list(sessionId);
		return {
			success: true,
			sessionId,
			total: records.length,
			sessions: records.map(r => ({
				instanceId: r.key,
				agentId: r.agentId,
				agentName: r.agentName,
				prompt: r.prompt ? r.prompt.substring(0, 200) : 'N/A',
				status: r.status,
				messageCount: r.messages.length,
				resumeCount: r.resumeCount,
				lastResult: r.lastResult ? r.lastResult.substring(0, 300) : undefined,
				startedAt: r.startedAt.toISOString(),
				updatedAt: r.updatedAt.toISOString(),
			})),
		};
	}

	/**
	 * agent_session_continue: re-activate a previously executed sub-agent in
	 * the same conversation, inheriting its full context, and send it new
	 * feedback / revision instructions.
	 */
	private async continueSession(
		options: SubAgentToolExecutionOptions,
	): Promise<any> {
		const args = options.args ?? {};
		const targetInstanceId =
			typeof args.instance_id === 'string' ? args.instance_id : undefined;
		const targetAgentId =
			typeof args.agent_id === 'string' ? args.agent_id : undefined;
		const message =
			typeof args.message === 'string' && args.message.trim()
				? args.message.trim()
				: options.prompt || '';

		if (!message) {
			throw new Error(
				'agent_session_continue requires a non-empty "message" parameter containing the feedback / revision instructions for the sub-agent',
			);
		}

		const sessionId = getCurrentSessionId();
		let record = targetInstanceId
			? subAgentSessionStore.get(targetInstanceId)
			: undefined;
		if (!record && targetAgentId) {
			record = subAgentSessionStore.findLatestByAgentId(
				targetAgentId,
				sessionId,
			);
		}
		if (!record || !record.messages || record.messages.length === 0) {
			const hint = targetInstanceId
				? `instance "${targetInstanceId}"`
				: targetAgentId
				? `agent "${targetAgentId}"`
				: 'the requested agent';
			throw new Error(
				`No resumable sub-agent session found for ${hint}. Use agent_session_query first to list sub-agents executed in this conversation, then pass its instance_id (or agent_id).`,
			);
		}

		// Re-activate: spawn a new execution instance that inherits the
		// previous conversation history, and persist the updated context
		// back under the original logical session key.
		const resumeInstanceId = `resume-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		const result = await this.runAgent({
			...options,
			agentId: record.agentId,
			prompt: message,
			instanceId: resumeInstanceId,
			sessionKey: record.key,
			resumeMessages: record.messages,
		});

		const updated = subAgentSessionStore.get(record.key);
		return {
			success: true,
			resumed: true,
			instanceId: record.key,
			agentId: record.agentId,
			agentName: record.agentName,
			resumeCount: updated?.resumeCount ?? record.resumeCount + 1,
			result: result.result,
			usage: result.usage,
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
			{
				name: 'agent_analyze',
				description:
					'Requirement Analysis Agent: Specialized for analyzing user requirements. Outputs comprehensive requirement specifications to guide the main workflow. Must confirm analysis with user before completing.',
				inputSchema: {
					type: 'object',
					properties: {
						prompt: {
							type: 'string',
							description:
								'CRITICAL: Provide COMPLETE context from main session. Sub-agent has NO access to main conversation history. Include: (1) Full user request or requirement description, (2) Any background or existing context about the project, (3) Known constraints, preferences, or non-functional requirements, (4) Relevant code or architecture information. The agent will analyze requirements and confirm with the user before completing.',
						},
					},
					required: ['prompt'],
				},
			},
			{
				name: 'agent_qa',
				description:
					'QA Agent: Quality assurance specialist that reviews code changes, identifies bugs, checks edge cases, validates security, and runs tests. Provides structured QA reports with severity-categorized findings and suggested fixes.',
				inputSchema: {
					type: 'object',
					properties: {
						prompt: {
							type: 'string',
							description:
								'CRITICAL: Provide COMPLETE context from main session. Sub-agent has NO access to main conversation history. Include: (1) What code was changed or implemented, (2) Exact file paths of modified files, (3) Requirements and acceptance criteria, (4) Any specific areas of concern, (5) Known constraints or edge cases. Example: "Review the new authentication middleware in src/middleware/auth.ts. It should validate JWT tokens, handle expired tokens gracefully, and block unauthenticated requests. Also check src/routes/api.ts where it is applied."',
						},
					},
					required: ['prompt'],
				},
			},
			{
				name: 'agent_debug',
				description:
					'Debug Assistant: Specialized for inserting structured file-based logging into project code. Writes all logs to .snow/log/ directory as .txt files with structured format. If the project lacks a logger helper, it will write one first. Reports log file locations upon completion.',
				inputSchema: {
					type: 'object',
					properties: {
						prompt: {
							type: 'string',
							description:
								'CRITICAL: Provide COMPLETE context from main session. Sub-agent has NO access to main conversation history. Include: (1) Which code/functions/modules need debug logging, (2) What specific behavior or bug you are trying to trace, (3) Known file paths and code locations, (4) Project type and language. The agent will insert structured logging that writes to .snow/log/*.txt files and report the log storage location.',
						},
					},
					required: ['prompt'],
				},
			},
			{
				name: 'agent_session_query',
				description:
					'Query sub-agent sessions in the CURRENT conversation. Lists every sub-agent executed in this session (including completed ones): instance ID, agent type, original task prompt, message count, status and resume count. USE THIS when a sub-agent result was unsatisfactory and you want to RE-ACTIVATE that same sub-agent with revision feedback — find its instance_id here, then call agent_session_continue to send the feedback while it keeps its full context.',
				inputSchema: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
			{
				name: 'agent_session_continue',
				description:
					"RE-ACTIVATE a sub-agent that already ran earlier in this conversation and CONTINUE its session while INHERITING its full context (all previous exploration, findings, decisions and tool results). Use this when a sub-agent's result needs revisions: instead of spawning a fresh agent that rebuilds context from scratch, the SAME sub-agent continues where it left off with your feedback injected as a new user message. Provide instance_id (from agent_session_query — preferred when multiple sessions exist) or agent_id (resumes the most recent session of that agent type).",
				inputSchema: {
					type: 'object',
					properties: {
						instance_id: {
							type: 'string',
							description:
								'(Optional) Instance ID of the sub-agent session to resume, as returned by agent_session_query. Prefer this when multiple sessions of the same agent type exist.',
						},
						agent_id: {
							type: 'string',
							description:
								'(Optional) Agent ID (type) of the sub-agent to resume, e.g. "agent_general", "agent_explore". Used when instance_id is not provided — resumes the MOST RECENT session of this agent type.',
						},
						message: {
							type: 'string',
							description:
								'The feedback / revision request to send to the sub-agent. It is injected into its existing conversation as a user message, and the sub-agent continues working with full knowledge of its previous context.',
						},
					},
					required: ['message'],
				},
			},
		];

		// Built-in agent IDs (used to filter out duplicates)
		const builtInAgentIds = new Set([
			'agent_explore',
			'agent_plan',
			'agent_general',
			'agent_analyze',
			'agent_qa',
			'agent_debug',
			'agent_session_query',
			'agent_session_continue',
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

// ── Helpers ────────────────────────────────────────────────────────────────

function getCurrentSessionId(): string | undefined {
	try {
		return (
			sessionManager.getCurrentSession()?.id ??
			getConversationContext()?.sessionId
		);
	} catch {
		return undefined;
	}
}

function resolveAgentName(agentId: string): string {
	try {
		const agent = getUserSubAgents().find(a => a.id === agentId);
		if (agent) return agent.name;
	} catch {
		/* fall through to built-in names */
	}
	const builtinNames: Record<string, string> = {
		agent_explore: 'Explore Agent',
		agent_plan: 'Plan Agent',
		agent_general: 'General Purpose Agent',
		agent_analyze: 'Requirement Analysis Agent',
		agent_qa: 'QA Agent',
		agent_debug: 'Debug Assistant',
	};
	return builtinNames[agentId] || agentId;
}
