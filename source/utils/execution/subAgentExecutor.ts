import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingChatCompletion} from '../../api/chat.js';
import {getSubAgent} from '../config/subAgentConfig.js';
import {
	BUILTIN_AGENT_IDS,
	getBuiltinAgentDefinition,
} from './subagents/index.js';
import {collectAllMCPTools, executeMCPTool} from './mcpToolsManager.js';
import {getOpenAiConfig} from '../config/apiConfig.js';
import {sessionManager} from '../session/sessionManager.js';
import {unifiedHooksExecutor} from './unifiedHooksExecutor.js';
import {checkYoloPermission} from './yoloPermissionChecker.js';
import {connectionManager} from '../connection/ConnectionManager.js';
import {getSubAgentMaxSpawnDepth} from '../config/projectSettings.js';
import {
	shouldCompressSubAgentContext,
	getContextPercentage,
	compressSubAgentContext,
	countMessagesTokens,
} from '../core/subAgentContextCompressor.js';
import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';
import type {MCPTool} from './mcpToolsManager.js';
import type {ChatMessage} from '../../api/chat.js';

export interface SubAgentMessage {
	type: 'sub_agent_message';
	agentId: string;
	agentName: string;
	message: any; // Stream event from anthropic API
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
}

export interface SubAgentResult {
	success: boolean;
	result: string;
	error?: string;
	usage?: TokenUsage;
	/** User messages injected from the main session during sub-agent execution */
	injectedUserMessages?: string[];
	/** Internal stop/summarize instructions injected by the executor */
	terminationInstructions?: string[];
}

export interface ToolConfirmationCallback {
	(toolName: string, toolArgs: any): Promise<ConfirmationResult>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

export interface AddToAlwaysApprovedCallback {
	(toolName: string): void;
}

/**
 * 用户问题回调接口
 * 用于子智能体调用 askuser 工具时，请求主会话显示蓝色边框的 AskUserQuestion 组件
 * @param question - 问题文本
 * @param options - 选项列表
 * @param multiSelect - 是否多选模式
 * @returns 用户选择的结果
 */
export interface UserQuestionCallback {
	(question: string, options: string[], multiSelect?: boolean): Promise<{
		selected: string | string[];
		customInput?: string;
	}>;
}

/**
 * Maximum spawn depth is project-configurable via `.snow/settings.json`.
 */

/**
 * 执行子智能体作为工具
 * @param agentId - 子智能体 ID
 * @param prompt - 发送给子智能体的任务提示
 * @param onMessage - 流式消息回调（用于 UI 显示）
 * @param abortSignal - 可选的中止信号
 * @param requestToolConfirmation - 工具确认回调
 * @param isToolAutoApproved - 检查工具是否自动批准
 * @param yoloMode - 是否启用 YOLO 模式（自动批准所有工具）
 * @param addToAlwaysApproved - 添加工具到始终批准列表的回调
 * @param requestUserQuestion - 用户问题回调，用于子智能体调用 askuser 工具时显示主会话的蓝色边框 UI
 * @param spawnDepth - 当前 spawn 嵌套深度（0 = 主流程直接调起的子代理）
 * @returns 子智能体的最终结果
 */
export async function executeSubAgent(
	agentId: string,
	prompt: string,
	onMessage?: (message: SubAgentMessage) => void,
	abortSignal?: AbortSignal,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
	requestUserQuestion?: UserQuestionCallback,
	instanceId?: string,
	spawnDepth: number = 0,
): Promise<SubAgentResult> {
	try {
		// Resolve agent: user custom copy > builtin definition > user-configured agent
		let agent: any;

		if (BUILTIN_AGENT_IDS.includes(agentId)) {
			const {getUserSubAgents} = await import('../config/subAgentConfig.js');
			const userAgents = getUserSubAgents();
			const userAgent = userAgents.find(a => a.id === agentId);
			if (userAgent) {
				agent = userAgent;
			} else {
				agent = getBuiltinAgentDefinition(agentId);
			}
		} else {
			agent = getSubAgent(agentId);
			if (!agent) {
				return {
					success: false,
					result: '',
					error: `Sub-agent with ID "${agentId}" not found`,
				};
			}
		}

		// Get all available tools
		const allTools = await collectAllMCPTools();

		// Filter tools based on sub-agent's allowed tools
		const allowedTools = allTools.filter((tool: MCPTool) => {
			const toolName = tool.function.name;
			const normalizedToolName = toolName.replace(/_/g, '-');
			const builtInPrefixes = new Set([
				'todo-',
				'notebook-',
				'filesystem-',
				'terminal-',
				'ace-',
				'websearch-',
				'ide-',
				'codebase-',
				'askuser-',
				'skill-',
				'subagent-',
			]);

			return agent.tools.some((allowedTool: string) => {
				// Normalize both tool names: replace underscores with hyphens for comparison
				const normalizedAllowedTool = allowedTool.replace(/_/g, '-');
				const isQualifiedAllowed =
					normalizedAllowedTool.includes('-') ||
					Array.from(builtInPrefixes).some(prefix =>
						normalizedAllowedTool.startsWith(prefix),
					);

				// Support both exact match and prefix match (e.g., "filesystem" matches "filesystem-read")
				if (
					normalizedToolName === normalizedAllowedTool ||
					normalizedToolName.startsWith(`${normalizedAllowedTool}-`)
				) {
					return true;
				}

				// Backward compatibility: allow unqualified external tool names (missing service prefix)
				const isExternalTool = !Array.from(builtInPrefixes).some(prefix =>
					normalizedToolName.startsWith(prefix),
				);
				if (
					!isQualifiedAllowed &&
					isExternalTool &&
					normalizedToolName.endsWith(`-${normalizedAllowedTool}`)
				) {
					return true;
				}

				return false;
			});
		});

		if (allowedTools.length === 0) {
			return {
				success: false,
				result: '',
				error: `Sub-agent "${agent.name}" has no valid tools configured`,
			};
		}

		// ── Inject the inter-agent messaging tool ──
		// This tool is always available to all sub-agents (not part of MCP tools)
		const {runningSubAgentTracker} = await import(
			'./runningSubAgentTracker.js'
		);

		const sendMessageTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'send_message_to_agent',
				description:
					"Send a message to another running sub-agent. Use this to share information, findings, or coordinate work with other agents that are executing in parallel. The message will be injected into the target agent's context. IMPORTANT: Use query_agents_status first to check if the target agent is still running before sending.",
				parameters: {
					type: 'object',
					properties: {
						target_agent_id: {
							type: 'string',
							description:
								'The agent ID (type) of the target sub-agent (e.g., "agent_explore", "agent_general"). If multiple instances of the same type are running, the message is sent to the first found instance.',
						},
						target_instance_id: {
							type: 'string',
							description:
								'(Optional) The specific instance ID of the target sub-agent. Use this for precise targeting when multiple instances of the same agent type are running.',
						},
						message: {
							type: 'string',
							description:
								'The message content to send to the target agent. Be clear and specific about what information you are sharing or what action you are requesting.',
						},
					},
					required: ['message'],
				},
			},
		};

		const queryAgentsStatusTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'query_agents_status',
				description:
					'Query the current status of all running sub-agents. Returns a list of currently active agents with their IDs, names, prompts, and how long they have been running. Use this to check if a target agent is still running before sending it a message, or to discover new agents that have started.',
				parameters: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
		};

		const spawnSubAgentTool: MCPTool = {
			type: 'function' as const,
			function: {
				name: 'spawn_sub_agent',
				description: `Spawn a NEW sub-agent of a DIFFERENT type to get specialized help. The spawned agent runs in parallel and results are reported back automatically.

**WHEN TO USE** — Only spawn when you genuinely need a different agent's specialization:
- You are an Explore Agent and need code modifications → spawn agent_general
- You are a General Purpose Agent and need deep code analysis → spawn agent_explore
- You need a detailed implementation plan → spawn agent_plan
- You need requirement clarification with user → spawn agent_analyze

**WHEN NOT TO USE** — Do NOT spawn to offload YOUR OWN work:
- NEVER spawn an agent of the same type as yourself to delegate your task — that is lazy and wasteful
- NEVER spawn an agent just to "break work into pieces" if you can do it yourself
- NEVER spawn when you are simply stuck — try harder or ask the user instead
- If you can complete the task with your own tools, DO IT YOURSELF

Available agent types: agent_explore (code exploration, read-only), agent_plan (planning, read-only), agent_general (full access, code modification), agent_analyze (requirement analysis), agent_qa (quality assurance, code review & testing), agent_debug (debug logging).`,
				parameters: {
					type: 'object',
					properties: {
						agent_id: {
							type: 'string',
							description:
								'The agent type to spawn. Must be a DIFFERENT type from yourself unless you have a very strong justification. (e.g., "agent_explore", "agent_plan", "agent_general", "agent_analyze", "agent_debug", or a user-defined agent ID).',
						},
						prompt: {
							type: 'string',
							description:
								'CRITICAL: The task prompt for the spawned agent. Must include COMPLETE context since the spawned agent has NO access to your conversation history. Include all relevant file paths, findings, constraints, and requirements.',
						},
					},
					required: ['agent_id', 'prompt'],
				},
			},
		};

		const maxSpawnDepth = getSubAgentMaxSpawnDepth();
		allowedTools.push(sendMessageTool, queryAgentsStatusTool);
		if (spawnDepth < maxSpawnDepth) {
			allowedTools.push(spawnSubAgentTool);
		}

		// ── Build other agents' status info for context ──
		const otherAgents = runningSubAgentTracker
			.getRunningAgents()
			.filter(a => a.instanceId !== instanceId);

		const canSpawn = spawnDepth < maxSpawnDepth;
		let otherAgentsContext = '';

		if (otherAgents.length > 0) {
			const agentList = otherAgents
				.map(
					a =>
						`- ${a.agentName} (id: ${a.agentId}, instance: ${a.instanceId}): "${
							a.prompt ? a.prompt.substring(0, 120) : 'N/A'
						}"`,
				)
				.join('\n');
			const spawnHint = canSpawn
				? ', or `spawn_sub_agent` to request a DIFFERENT type of agent for specialized help'
				: '';
			const spawnAdvice = canSpawn
				? '\n\n**Spawn rules**: Only spawn agents of a DIFFERENT type for work you CANNOT do with your own tools. Complete your own task first — do NOT delegate it.'
				: '';
			otherAgentsContext = `\n\n## Currently Running Peer Agents
The following sub-agents are running in parallel with you. You can use \`query_agents_status\` to get real-time status, \`send_message_to_agent\` to communicate${spawnHint}.

${agentList}

If you discover information useful to another agent, proactively share it.${spawnAdvice}`;
		} else {
			const spawnToolLine = canSpawn
				? '\n- `spawn_sub_agent`: Spawn a DIFFERENT type of agent for specialized help (do NOT spawn your own type to offload work)'
				: '';
			const spawnUsage = canSpawn
				? '\n\n**Spawn rules**: Only use `spawn_sub_agent` when you genuinely need a different agent\'s specialization (e.g., you are read-only but need code changes). NEVER spawn to delegate your own task or to "parallelize" work you should do yourself.'
				: '';
			otherAgentsContext = `\n\n## Agent Collaboration Tools
You have access to these collaboration tools:
- \`query_agents_status\`: Check which sub-agents are currently running
- \`send_message_to_agent\`: Send a message to a running peer agent (check status first!)${spawnToolLine}${spawnUsage}`;
		}

		// Build conversation history for sub-agent
		// Load custom user role for this subagent (project > global)
		let customRoleContent: string | null = null;
		try {
			const {loadSubAgentCustomRole} = await import(
				'../commands/roleSubagent.js'
			);
			customRoleContent = loadSubAgentCustomRole(
				agent.name,
				process.cwd(),
			);
		} catch {
			// roleSubagent module unavailable, skip custom role
		}

		// Assemble: [prompt] + [custom role (prepended)] + [built-in role]
		let finalPrompt = prompt;
		let combinedRole = '';
		if (customRoleContent) {
			combinedRole += customRoleContent;
		}
		if (agent.role) {
			combinedRole += (combinedRole ? '\n\n' : '') + agent.role;
		}
		if (combinedRole) {
			finalPrompt = `${prompt}\n\n${combinedRole}`;
		}
		// Append other agents context
		if (otherAgentsContext) {
			finalPrompt = `${finalPrompt}${otherAgentsContext}`;
		}

		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: finalPrompt,
			},
		];

		// Stream sub-agent execution
		let finalResponse = '';
		let hasError = false;
		let errorMessage = '';
		let totalUsage: TokenUsage | undefined;
		// Latest total_tokens from the most recent API call (prompt + completion).
		// Unlike totalUsage which accumulates across rounds, this reflects the actual
		// context size for the current round — used for context window monitoring.
		let latestTotalTokens = 0;
		// Track all user messages injected from the main session
		const collectedInjectedMessages: string[] = [];
		// Track internal stop/summarize instructions injected by the executor
		const collectedTerminationInstructions: string[] = [];

		// Track instanceIds of sub-agents spawned by THIS agent via spawn_sub_agent.
		// Used to prevent this agent from finishing while its children are still running.
		const spawnedChildInstanceIds = new Set<string>();

		// Local session-approved tools for this sub-agent execution
		// This ensures tools approved during execution are immediately recognized
		const sessionApprovedTools = new Set<string>();

		// eslint-disable-next-line no-constant-condition
		while (true) {
			// Check abort signal before streaming
			if (abortSignal?.aborted) {
				// Send done message to mark completion (like normal tool abort)
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'done',
						},
					});
				}
				return {
					success: false,
					result: finalResponse,
					error: 'Sub-agent execution aborted',
				};
			}

			// Inject any pending user messages from the main flow.
			// The main flow enqueues messages via runningSubAgentTracker.enqueueMessage()
			// when the user directs a pending message to this specific sub-agent instance.
			if (instanceId) {
				const injectedMessages =
					runningSubAgentTracker.dequeueMessages(instanceId);
				for (const injectedMsg of injectedMessages) {
					// Collect for inclusion in the final result
					collectedInjectedMessages.push(injectedMsg);

					messages.push({
						role: 'user',
						content: `[User message from main session]\n${injectedMsg}`,
					});

					// Notify UI about the injected message
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'user_injected',
								content: injectedMsg,
							},
						});
					}
				}

				// Inject any pending inter-agent messages from other sub-agents
				const interAgentMessages =
					runningSubAgentTracker.dequeueInterAgentMessages(instanceId);
				for (const iaMsg of interAgentMessages) {
					messages.push({
						role: 'user',
						content: `[Inter-agent message from ${iaMsg.fromAgentName} (${iaMsg.fromAgentId})]\n${iaMsg.content}`,
					});

					// Notify UI about the inter-agent message reception
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'inter_agent_received',
								fromAgentId: iaMsg.fromAgentId,
								fromAgentName: iaMsg.fromAgentName,
								content: iaMsg.content,
							},
						});
					}
				}
			}

			// Get current session
			const currentSession = sessionManager.getCurrentSession();

			// Get sub-agent configuration
			// If sub-agent has configProfile, load it; otherwise use main config
			let config;
			let model;
			if (agent.configProfile) {
				try {
					const {loadProfile} = await import('../config/configManager.js');
					const profileConfig = loadProfile(agent.configProfile);
					if (profileConfig?.snowcfg) {
						config = profileConfig.snowcfg;
						model = config.advancedModel || 'gpt-5';
					} else {
						// Profile not found, fallback to main config
						config = getOpenAiConfig();
						model = config.advancedModel || 'gpt-5';
						console.warn(
							`Profile ${agent.configProfile} not found for sub-agent, using main config`,
						);
					}
				} catch (error) {
					// If loading profile fails, fallback to main config
					config = getOpenAiConfig();
					model = config.advancedModel || 'gpt-5';
					console.warn(
						`Failed to load profile ${agent.configProfile} for sub-agent, using main config:`,
						error,
					);
				}
			} else {
				// No configProfile specified, use main config
				config = getOpenAiConfig();
				model = config.advancedModel || 'gpt-5';
			}

			// Call API with sub-agent's tools - choose API based on config
			// Apply sub-agent configuration overrides (model already loaded from configProfile above)
			const stream =
				config.requestMethod === 'anthropic'
					? createStreamingAnthropicCompletion(
							{
								model,
								messages,
								temperature: 0,
								max_tokens: config.maxTokens || 4096,
								tools: allowedTools,
								sessionId: currentSession?.id,
								//disableThinking: true, // Sub-agents 不使用 Extended Thinking
								configProfile: agent.configProfile,
							},
							abortSignal,
					  )
					: config.requestMethod === 'gemini'
					? createStreamingGeminiCompletion(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
								configProfile: agent.configProfile,
							},
							abortSignal,
					  )
					: config.requestMethod === 'responses'
					? createStreamingResponse(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
								prompt_cache_key: currentSession?.id,
								configProfile: agent.configProfile,
							},
							abortSignal,
					  )
					: createStreamingChatCompletion(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
								configProfile: agent.configProfile,
							},
							abortSignal,
					  );

			let currentContent = '';
			let toolCalls: any[] = [];
			// 保存 thinking/reasoning 内容用于多轮对话
			let currentThinking:
				| {type: 'thinking'; thinking: string; signature?: string}
				| undefined; // Anthropic/Gemini thinking block
			let currentReasoningContent: string | undefined; // Chat API (DeepSeek R1) reasoning_content
			let currentReasoning:
				| {
						summary?: Array<{type: 'summary_text'; text: string}>;
						content?: any;
						encrypted_content?: string;
				  }
				| undefined; // Responses API reasoning data

			for await (const event of stream) {
				// Forward message to UI (but don't save to main conversation)
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: event,
					});
				}

				// Capture usage from stream events
				if (event.type === 'usage' && event.usage) {
					const eventUsage = event.usage;
					// Track total_tokens (prompt + completion) for context window monitoring.
					// total_tokens better reflects actual context consumption because the model's
					// response (completion_tokens) will also be added to the messages array,
					// contributing to the next round's input.
					latestTotalTokens =
						eventUsage.total_tokens ||
						(eventUsage.prompt_tokens || 0) +
							(eventUsage.completion_tokens || 0);

					if (!totalUsage) {
						totalUsage = {
							inputTokens: eventUsage.prompt_tokens || 0,
							outputTokens: eventUsage.completion_tokens || 0,
							cacheCreationInputTokens: eventUsage.cache_creation_input_tokens,
							cacheReadInputTokens: eventUsage.cache_read_input_tokens,
						};
					} else {
						// Accumulate usage if there are multiple rounds
						totalUsage.inputTokens += eventUsage.prompt_tokens || 0;
						totalUsage.outputTokens += eventUsage.completion_tokens || 0;
						if (eventUsage.cache_creation_input_tokens) {
							totalUsage.cacheCreationInputTokens =
								(totalUsage.cacheCreationInputTokens || 0) +
								eventUsage.cache_creation_input_tokens;
						}
						if (eventUsage.cache_read_input_tokens) {
							totalUsage.cacheReadInputTokens =
								(totalUsage.cacheReadInputTokens || 0) +
								eventUsage.cache_read_input_tokens;
						}
					}

					// Notify UI of context usage DURING the stream (before 'done' marks message complete)
					// This ensures the streaming message still exists for the UI to update
					if (onMessage && config.maxContextTokens && latestTotalTokens > 0) {
						const ctxPct = getContextPercentage(
							latestTotalTokens,
							config.maxContextTokens,
						);
						// Use Math.max(1, ...) so the first API call (small prompt) still shows ≥1%
						// instead of rounding to 0% and hiding the bar entirely
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'context_usage',
								percentage: Math.max(1, Math.round(ctxPct)),
								inputTokens: latestTotalTokens,
								maxTokens: config.maxContextTokens,
							},
						});
					}
				}

				if (event.type === 'content' && event.content) {
					currentContent += event.content;
				} else if (event.type === 'tool_calls' && event.tool_calls) {
					toolCalls = event.tool_calls;
				} else if (event.type === 'reasoning_data' && 'reasoning' in event) {
					// Capture reasoning data from Responses API
					currentReasoning = event.reasoning as typeof currentReasoning;
				} else if (event.type === 'done') {
					// Capture thinking/reasoning from done event for multi-turn conversations
					if ('thinking' in event && event.thinking) {
						// Anthropic/Gemini thinking block
						currentThinking = event.thinking as {
							type: 'thinking';
							thinking: string;
							signature?: string;
						};
					}
					if ('reasoning_content' in event && event.reasoning_content) {
						// Chat API (DeepSeek R1) reasoning_content
						currentReasoningContent = event.reasoning_content as string;
					}
				}
			}

			if (hasError) {
				return {
					success: false,
					result: finalResponse,
					error: errorMessage,
				};
			}

			// Add assistant response to conversation
			if (currentContent || toolCalls.length > 0) {
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: currentContent || '',
				};

				// Save thinking/reasoning for multi-turn conversations
				// Anthropic/Gemini: thinking block (required by Anthropic when thinking is enabled)
				if (currentThinking) {
					assistantMessage.thinking = currentThinking;
				}
				// Chat API (DeepSeek R1): reasoning_content
				if (currentReasoningContent) {
					(assistantMessage as any).reasoning_content = currentReasoningContent;
				}
				// Responses API: reasoning data with encrypted_content
				if (currentReasoning) {
					(assistantMessage as any).reasoning = currentReasoning;
				}

				if (toolCalls.length > 0) {
					// tool_calls may contain thought_signature (Gemini thinking mode)
					// This is preserved automatically since toolCalls is captured directly from the stream
					assistantMessage.tool_calls = toolCalls;
				}

				messages.push(assistantMessage);
				finalResponse = currentContent;
			}

			// ── Fallback: count tokens with tiktoken when API doesn't return usage ──
			// Some third-party APIs or proxy servers may not include usage data in responses.
			// In that case, use tiktoken to estimate the token count from the messages array.
			if (latestTotalTokens === 0 && config.maxContextTokens) {
				latestTotalTokens = countMessagesTokens(messages);

				// Send context_usage event with the tiktoken-estimated count
				if (onMessage && latestTotalTokens > 0) {
					const ctxPct = getContextPercentage(
						latestTotalTokens,
						config.maxContextTokens,
					);
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'context_usage',
							percentage: Math.max(1, Math.round(ctxPct)),
							inputTokens: latestTotalTokens,
							maxTokens: config.maxContextTokens,
						},
					});
				}
			}

			// ── Context compression check ──
			// After each API round, check if context is approaching the limit.
			// If so, compress messages to prevent context_length_exceeded errors.
			// Note: context_usage UI notification is sent during the stream (in the usage event handler above)
			// to ensure the streaming message still exists for the UI to attach the progress bar.
			let justCompressed = false;
			if (latestTotalTokens > 0 && config.maxContextTokens) {
				// Trigger compression if above threshold
				if (
					shouldCompressSubAgentContext(
						latestTotalTokens,
						config.maxContextTokens,
					)
				) {
					const ctxPercentage = getContextPercentage(
						latestTotalTokens,
						config.maxContextTokens,
					);
					// Notify UI that compression is starting
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'context_compressing',
								percentage: Math.round(ctxPercentage),
							},
						});
					}

					try {
						const compressionResult = await compressSubAgentContext(
							messages,
							latestTotalTokens,
							config.maxContextTokens,
							{
								model,
								requestMethod: config.requestMethod,
								maxTokens: config.maxTokens,
								configProfile: agent.configProfile,
							},
						);

						if (compressionResult.compressed) {
							// Replace messages array contents
							messages.length = 0;
							messages.push(...compressionResult.messages);
							justCompressed = true;

							// Reset latestTotalTokens to the estimated post-compression value
							// so the next context_usage event reflects the compressed state
							if (compressionResult.afterTokensEstimate) {
								latestTotalTokens = compressionResult.afterTokensEstimate;
							}

							// Notify UI that compression is complete
							if (onMessage) {
								onMessage({
									type: 'sub_agent_message',
									agentId: agent.id,
									agentName: agent.name,
									message: {
										type: 'context_compressed',
										beforeTokens: compressionResult.beforeTokens,
										afterTokensEstimate: compressionResult.afterTokensEstimate,
									},
								});
							}

							console.log(
								`[SubAgent:${agent.name}] Context compressed: ` +
									`${compressionResult.beforeTokens} → ~${compressionResult.afterTokensEstimate} tokens`,
							);
						}
					} catch (compressError) {
						console.error(
							`[SubAgent:${agent.name}] Context compression failed:`,
							compressError,
						);
						// Continue without compression — the API call may still succeed
						// or will fail with context_length_exceeded on the next round
					}
				}
			}

			// ── After compression: force continuation if agent was about to exit ──
			// When context was compressed and the model gave a "final" response (no tool_calls),
			// the response was likely generated under context pressure. Remove it and ask the
			// agent to continue working with the now-compressed context.
			if (justCompressed && toolCalls.length === 0) {
				// Remove the last assistant message (premature exit under context pressure)
				while (
					messages.length > 0 &&
					messages[messages.length - 1]?.role === 'assistant'
				) {
					messages.pop();
				}
				// Inject continuation instruction
				messages.push({
					role: 'user',
					content:
						'[System] Your context has been auto-compressed to free up space. Your task is NOT finished. Continue working based on the compressed context above. Pick up where you left off.',
				});
				continue;
			}

			// If no tool calls, we're done — BUT first check for spawned children
			if (toolCalls.length === 0) {
				// ── Wait for spawned child agents before finishing ──
				// If this agent spawned children via spawn_sub_agent, we must
				// wait for them and feed their results back before we exit.
				// This prevents the parent from finishing (and thus the main flow
				// from considering this tool call "done") while children still run.
				const runningChildren = Array.from(spawnedChildInstanceIds).filter(id =>
					runningSubAgentTracker.isRunning(id),
				);

				if (
					runningChildren.length > 0 ||
					runningSubAgentTracker.hasSpawnedResults()
				) {
					// Wait for running children to complete
					if (runningChildren.length > 0) {
						await runningSubAgentTracker.waitForSpawnedAgents(
							300_000, // 5 min timeout
							abortSignal,
						);
					}

					// Drain all spawned results and inject as user context
					const spawnedResults = runningSubAgentTracker.drainSpawnedResults();
					if (spawnedResults.length > 0) {
						for (const sr of spawnedResults) {
							const statusIcon = sr.success ? '✓' : '✗';
							const resultSummary = sr.success
								? sr.result.length > 800
									? sr.result.substring(0, 800) + '...'
									: sr.result
								: sr.error || 'Unknown error';

							messages.push({
								role: 'user',
								content: `[Spawned Sub-Agent Result] ${statusIcon} ${sr.agentName} (${sr.agentId})\nPrompt: ${sr.prompt}\nResult: ${resultSummary}`,
							});

							// Notify UI about the spawned agent completion
							if (onMessage) {
								onMessage({
									type: 'sub_agent_message',
									agentId: agent.id,
									agentName: agent.name,
									message: {
										type: 'spawned_agent_completed',
										spawnedAgentId: sr.agentId,
										spawnedAgentName: sr.agentName,
										success: sr.success,
									} as any,
								});
							}
						}

						// Don't break — continue the loop so the AI sees spawned results
						// and can incorporate them into its final response
						if (onMessage) {
							onMessage({
								type: 'sub_agent_message',
								agentId: agent.id,
								agentName: agent.name,
								message: {
									type: 'done',
								},
							});
						}
						continue;
					}
				}

				// 执行 onSubAgentComplete 钩子（在子代理任务完成前）
				try {
					const hookResult = await unifiedHooksExecutor.executeHooks(
						'onSubAgentComplete',
						{
							agentId: agent.id,
							agentName: agent.name,
							content: finalResponse,
							success: true,
							usage: totalUsage,
						},
					);

					// 处理钩子返回结果
					if (hookResult.results && hookResult.results.length > 0) {
						let shouldContinue = false;

						for (const result of hookResult.results) {
							if (result.type === 'command' && !result.success) {
								if (result.exitCode >= 2) {
									// exitCode >= 2: 错误，追加消息并再次调用 API
									const errorMessage: ChatMessage = {
										role: 'user',
										content: result.error || result.output || '未知错误',
									};
									messages.push(errorMessage);
									shouldContinue = true;
								}
							} else if (result.type === 'prompt' && result.response) {
								// 处理 prompt 类型
								if (result.response.ask === 'ai' && result.response.continue) {
									// 发送给 AI 继续处理
									const promptMessage: ChatMessage = {
										role: 'user',
										content: result.response.message,
									};
									messages.push(promptMessage);
									shouldContinue = true;

									// 向 UI 显示钩子消息，告知用户子代理继续执行
									if (onMessage) {
										console.log(`Hook: ${result.response.message}`);
									}
								}
							}
						}
						// 如果需要继续，则不 break，让循环继续
						if (shouldContinue) {
							// 在继续前发送提示信息
							if (onMessage) {
								// 先发送一个 done 消息标记当前流结束
								onMessage({
									type: 'sub_agent_message',
									agentId: agent.id,
									agentName: agent.name,
									message: {
										type: 'done',
									},
								});
							}
							continue;
						}
					}
				} catch (error) {
					console.error('onSubAgentComplete hook execution failed:', error);
				}

				break;
			}

			// 拦截 send_message_to_agent 工具：子代理间通信，内部处理，不需要外部执行
			const sendMsgTools = toolCalls.filter(
				tc => tc.function.name === 'send_message_to_agent',
			);

			if (sendMsgTools.length > 0 && instanceId) {
				for (const sendMsgTool of sendMsgTools) {
					let targetAgentId: string | undefined;
					let targetInstanceId: string | undefined;
					let msgContent = '';

					try {
						const args = JSON.parse(sendMsgTool.function.arguments);
						targetAgentId = args.target_agent_id;
						targetInstanceId = args.target_instance_id;
						msgContent = args.message || '';
					} catch (error) {
						console.error(
							'Failed to parse send_message_to_agent arguments:',
							error,
						);
					}

					let success = false;
					let resultText = '';

					if (!msgContent) {
						resultText = 'Error: message content is empty';
					} else if (targetInstanceId) {
						// Send to specific instance
						success = runningSubAgentTracker.sendInterAgentMessage(
							instanceId,
							targetInstanceId,
							msgContent,
						);
						if (success) {
							const targetAgent = runningSubAgentTracker
								.getRunningAgents()
								.find(a => a.instanceId === targetInstanceId);
							resultText = `Message sent to ${
								targetAgent?.agentName || targetInstanceId
							}`;
						} else {
							resultText = `Error: Target agent instance "${targetInstanceId}" is not running`;
						}
					} else if (targetAgentId) {
						// Find by agent type ID
						const targetAgent =
							runningSubAgentTracker.findInstanceByAgentId(targetAgentId);
						if (targetAgent && targetAgent.instanceId !== instanceId) {
							success = runningSubAgentTracker.sendInterAgentMessage(
								instanceId,
								targetAgent.instanceId,
								msgContent,
							);
							if (success) {
								resultText = `Message sent to ${targetAgent.agentName} (instance: ${targetAgent.instanceId})`;
							} else {
								resultText = `Error: Failed to send message to ${targetAgentId}`;
							}
						} else if (targetAgent && targetAgent.instanceId === instanceId) {
							resultText = 'Error: Cannot send a message to yourself';
						} else {
							resultText = `Error: No running agent found with ID "${targetAgentId}"`;
						}
					} else {
						resultText =
							'Error: Either target_agent_id or target_instance_id must be provided';
					}

					// Build tool result
					const toolResultMessage = {
						role: 'tool' as const,
						tool_call_id: sendMsgTool.id,
						content: JSON.stringify({success, result: resultText}),
					};
					messages.push(toolResultMessage);

					// Notify UI about the inter-agent message sending
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'inter_agent_sent',
								targetAgentId: targetAgentId || targetInstanceId || 'unknown',
								targetAgentName:
									(targetInstanceId
										? runningSubAgentTracker
												.getRunningAgents()
												.find(a => a.instanceId === targetInstanceId)?.agentName
										: targetAgentId
										? runningSubAgentTracker.findInstanceByAgentId(
												targetAgentId,
										  )?.agentName
										: undefined) ||
									targetAgentId ||
									'unknown',
								content: msgContent,
								success,
							} as any,
						});
					}
				}

				// Remove send_message_to_agent from toolCalls
				toolCalls = toolCalls.filter(
					tc => tc.function.name !== 'send_message_to_agent',
				);

				if (toolCalls.length === 0) {
					continue;
				}
			}

			// 拦截 query_agents_status 工具：返回当前所有子代理的状态
			const queryStatusTools = toolCalls.filter(
				tc => tc.function.name === 'query_agents_status',
			);

			if (queryStatusTools.length > 0) {
				for (const queryTool of queryStatusTools) {
					const allAgents = runningSubAgentTracker.getRunningAgents();
					const statusList = allAgents.map(a => ({
						instanceId: a.instanceId,
						agentId: a.agentId,
						agentName: a.agentName,
						prompt: a.prompt ? a.prompt.substring(0, 150) : 'N/A',
						runningFor: `${Math.floor(
							(Date.now() - a.startedAt.getTime()) / 1000,
						)}s`,
						isSelf: a.instanceId === instanceId,
					}));

					const toolResultMessage = {
						role: 'tool' as const,
						tool_call_id: queryTool.id,
						content: JSON.stringify({
							totalRunning: allAgents.length,
							agents: statusList,
						}),
					};
					messages.push(toolResultMessage);
				}

				toolCalls = toolCalls.filter(
					tc => tc.function.name !== 'query_agents_status',
				);

				if (toolCalls.length === 0) {
					continue;
				}
			}

			// 拦截 spawn_sub_agent 工具：异步启动新子代理，结果注入主流程
			const spawnTools = toolCalls.filter(
				tc => tc.function.name === 'spawn_sub_agent',
			);

			if (spawnTools.length > 0 && instanceId) {
				for (const spawnTool of spawnTools) {
					let spawnAgentId = '';
					let spawnPrompt = '';

					try {
						const args = JSON.parse(spawnTool.function.arguments);
						spawnAgentId = args.agent_id || '';
						spawnPrompt = args.prompt || '';
					} catch (error) {
						console.error('Failed to parse spawn_sub_agent arguments:', error);
					}

					if (!spawnAgentId || !spawnPrompt) {
						const toolResultMessage = {
							role: 'tool' as const,
							tool_call_id: spawnTool.id,
							content: JSON.stringify({
								success: false,
								error: 'Both agent_id and prompt are required',
							}),
						};
						messages.push(toolResultMessage);
						continue;
					}

					// ── Soft guard: warn when spawning the same agent type as yourself ──
					// This prevents lazy behavior where an agent spawns a clone of itself
					// to offload its own work instead of completing it directly.
					if (spawnAgentId === agent.id) {
						const toolResultMessage = {
							role: 'tool' as const,
							tool_call_id: spawnTool.id,
							content: JSON.stringify({
								success: false,
								error: `REJECTED: You (${agent.name}) attempted to spawn another "${spawnAgentId}" which is the SAME type as yourself. This is not allowed because it wastes resources and delegates work you should complete yourself. If you need help from a DIFFERENT specialization, spawn a different agent type. If the task is within your capabilities, do it yourself.`,
							}),
						};
						messages.push(toolResultMessage);
						continue;
					}

					// Look up agent name
					let spawnAgentName = spawnAgentId;
					try {
						const agentConfig = getSubAgent(spawnAgentId);
						if (agentConfig) {
							spawnAgentName = agentConfig.name;
						}
					} catch {
						// Built-in agents aren't resolved by getSubAgent, use ID-based name mapping
						const builtinNames: Record<string, string> = {
							agent_explore: 'Explore Agent',
							agent_plan: 'Plan Agent',
							agent_general: 'General Purpose Agent',
							agent_analyze: 'Requirement Analysis Agent',
							agent_qa: 'QA Agent',
							agent_debug: 'Debug Assistant',
						};
						spawnAgentName = builtinNames[spawnAgentId] || spawnAgentId;
					}

					// Generate unique instance ID
					const spawnInstanceId = `spawn-${Date.now()}-${Math.random()
						.toString(36)
						.slice(2, 8)}`;

					// Get current agent info for the "spawnedBy" record
					const spawnerInfo = {
						instanceId,
						agentId: agent.id,
						agentName: agent.name,
					};

					// Track this child so we can wait for it before finishing
					spawnedChildInstanceIds.add(spawnInstanceId);

					// Register spawned agent in tracker
					runningSubAgentTracker.register({
						instanceId: spawnInstanceId,
						agentId: spawnAgentId,
						agentName: spawnAgentName,
						prompt: spawnPrompt,
						startedAt: new Date(),
					});

					// Fire-and-forget: start the spawned agent asynchronously
					// Its result will be stored in the tracker for the main flow to pick up
					executeSubAgent(
						spawnAgentId,
						spawnPrompt,
						onMessage, // Same UI callback — spawned agent's messages are visible
						abortSignal, // Same abort signal — ESC stops everything
						requestToolConfirmation,
						isToolAutoApproved,
						yoloMode,
						addToAlwaysApproved,
						requestUserQuestion,
						spawnInstanceId,
						spawnDepth + 1, // Increase depth to enforce the configured spawn limit
					)
						.then(result => {
							runningSubAgentTracker.storeSpawnedResult({
								instanceId: spawnInstanceId,
								agentId: spawnAgentId,
								agentName: spawnAgentName,
								prompt:
									spawnPrompt.length > 200
										? spawnPrompt.substring(0, 200) + '...'
										: spawnPrompt,
								success: result.success,
								result: result.result,
								error: result.error,
								completedAt: new Date(),
								spawnedBy: spawnerInfo,
							});
						})
						.catch(error => {
							runningSubAgentTracker.storeSpawnedResult({
								instanceId: spawnInstanceId,
								agentId: spawnAgentId,
								agentName: spawnAgentName,
								prompt:
									spawnPrompt.length > 200
										? spawnPrompt.substring(0, 200) + '...'
										: spawnPrompt,
								success: false,
								result: '',
								error: error instanceof Error ? error.message : 'Unknown error',
								completedAt: new Date(),
								spawnedBy: spawnerInfo,
							});
						})
						.finally(() => {
							// Unregister the spawned agent (it may have already been unregistered
							// inside executeSubAgent, but calling again is safe due to the delete check)
							runningSubAgentTracker.unregister(spawnInstanceId);
						});

					// Notify UI that a spawn happened
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'agent_spawned',
								spawnedAgentId: spawnAgentId,
								spawnedAgentName: spawnAgentName,
								spawnedInstanceId: spawnInstanceId,
								spawnedPrompt: spawnPrompt,
							} as any,
						});
					}

					// Return immediate result to spawning sub-agent
					const toolResultMessage = {
						role: 'tool' as const,
						tool_call_id: spawnTool.id,
						content: JSON.stringify({
							success: true,
							result: `Agent "${spawnAgentName}" (${spawnAgentId}) has been spawned and is now running in the background with instance ID "${spawnInstanceId}". Its results will be automatically reported to the main workflow when it completes.`,
						}),
					};
					messages.push(toolResultMessage);
				}

				toolCalls = toolCalls.filter(
					tc => tc.function.name !== 'spawn_sub_agent',
				);

				if (toolCalls.length === 0) {
					continue;
				}
			}

			// 拦截 askuser 工具：子智能体调用时需要显示主会话的蓝色边框 UI，而不是工具确认界面
			const askUserTool = toolCalls.find(tc =>
				tc.function.name.startsWith('askuser-'),
			);

			if (askUserTool && requestUserQuestion) {
				//解析工具参数，失败时使用默认值
				let question = 'Please select an option:';
				let options: string[] = ['Yes', 'No'];
				let multiSelect = false;
				let parsedArgs: Record<string, any> = {};

				try {
					parsedArgs = JSON.parse(askUserTool.function.arguments);
					if (parsedArgs['question']) question = parsedArgs['question'];
					if (parsedArgs['options'] && Array.isArray(parsedArgs['options'])) {
						options = parsedArgs['options'];
					}
					if (parsedArgs['multiSelect'] === true) {
						multiSelect = true;
					}
				} catch (error) {
					console.error('Failed to parse askuser tool arguments:', error);
				}

				try {
					const hookResult = await unifiedHooksExecutor.executeHooks(
						'beforeToolCall',
						{
							toolName: askUserTool.function.name,
							args: parsedArgs,
						},
					);

					if (hookResult && !hookResult.success) {
						const commandError = hookResult.results.find(
							(r: any) => r.type === 'command' && !r.success,
						);

						if (commandError && commandError.type === 'command') {
							const {exitCode, command, output, error} = commandError;

							if (exitCode === 1) {
								const blockedContent =
									error ||
									output ||
									`[beforeToolCall Hook Warning] Command: ${command} exited with code 1`;
								const blockedResult = {
									role: 'tool' as const,
									tool_call_id: askUserTool.id,
									content: blockedContent,
								};
								messages.push(blockedResult);

								if (onMessage) {
									onMessage({
										type: 'sub_agent_message',
										agentId: agent.id,
										agentName: agent.name,
										message: {
											type: 'tool_result',
											tool_call_id: askUserTool.id,
											tool_name: askUserTool.function.name,
											content: blockedContent,
										} as any,
									});
								}
							} else if (exitCode >= 2 || exitCode < 0) {
								const hookErrorDetails = {
									type: 'error' as const,
									exitCode,
									command,
									output,
									error,
								};
								const hookFailedResult = {
									role: 'tool' as const,
									tool_call_id: askUserTool.id,
									content: '',
									hookFailed: true,
									hookErrorDetails,
								};
								messages.push(hookFailedResult as ChatMessage);

								if (onMessage) {
									onMessage({
										type: 'sub_agent_message',
										agentId: agent.id,
										agentName: agent.name,
										message: {
											type: 'tool_result',
											tool_call_id: askUserTool.id,
											tool_name: askUserTool.function.name,
											content: '',
											hookFailed: true,
											hookErrorDetails,
										} as any,
									});
								}
							}

							const remainingTools = toolCalls.filter(
								tc => tc.id !== askUserTool.id,
							);
							if (remainingTools.length === 0) {
								continue;
							}

							toolCalls = remainingTools;
						}
					}
				} catch (hookError) {
					console.warn(
						'Failed to execute beforeToolCall hook for askuser in sub-agent:',
						hookError,
					);
				}

				// Notify server that user interaction is needed (only if connected)
				if (connectionManager.isConnected()) {
					await connectionManager.notifyUserInteractionNeeded(
						question,
						options,
						askUserTool.id,
						multiSelect,
					);
				}

				const userAnswer = await requestUserQuestion(
					question,
					options,
					multiSelect,
				);

				const answerText = userAnswer.customInput
					? `${
							Array.isArray(userAnswer.selected)
								? userAnswer.selected.join(', ')
								: userAnswer.selected
					  }: ${userAnswer.customInput}`
					: Array.isArray(userAnswer.selected)
					? userAnswer.selected.join(', ')
					: userAnswer.selected;

				const toolResultMessage = {
					role: 'tool' as const,
					tool_call_id: askUserTool.id,
					content: JSON.stringify({
						answer: answerText,
						selected: userAnswer.selected,
						customInput: userAnswer.customInput,
					}),
				};

				messages.push(toolResultMessage);

				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'tool_result',
							tool_call_id: askUserTool.id,
							tool_name: askUserTool.function.name,
							content: JSON.stringify({
								answer: answerText,
								selected: userAnswer.selected,
								customInput: userAnswer.customInput,
							}),
						} as any,
					});
				}

				// 移除已处理的 askuser 工具，避免重复执行
				const remainingTools = toolCalls.filter(tc => tc.id !== askUserTool.id);

				if (remainingTools.length === 0) {
					continue;
				}

				toolCalls = remainingTools;
			}

			// Check tool approvals before execution
			const approvedToolCalls: typeof toolCalls = [];
			const rejectedToolCalls: typeof toolCalls = [];
			const rejectionReasons = new Map<string, string>(); // Map tool_call_id to rejection reason
			let shouldStopAfterRejection = false;
			let stopRejectedToolName: string | undefined;
			let stopRejectionReason: string | undefined;

			for (const toolCall of toolCalls) {
				const toolName = toolCall.function.name;
				let args: any;
				try {
					args = JSON.parse(toolCall.function.arguments);
				} catch (e) {
					args = {};
				}

				// Check if tool needs confirmation using the unified YOLO permission checker
				const permissionResult = await checkYoloPermission(
					toolName,
					args,
					yoloMode ?? false,
				);
				let needsConfirmation = permissionResult.needsConfirmation;

				// Check if tool is in auto-approved list (global or session)
				// This should override the YOLO permission check result
				if (
					sessionApprovedTools.has(toolName) ||
					(isToolAutoApproved && isToolAutoApproved(toolName))
				) {
					needsConfirmation = false;
				}

				if (needsConfirmation && requestToolConfirmation) {
					// Request confirmation from user
					const confirmation = await requestToolConfirmation(toolName, args);

					if (
						confirmation === 'reject' ||
						(typeof confirmation === 'object' &&
							confirmation.type === 'reject_with_reply')
					) {
						rejectedToolCalls.push(toolCall);
						// Save rejection reason if provided
						if (typeof confirmation === 'object' && confirmation.reason) {
							rejectionReasons.set(toolCall.id, confirmation.reason);
						}
						if (confirmation === 'reject') {
							shouldStopAfterRejection = true;
							stopRejectedToolName = toolName;
							stopRejectionReason = rejectionReasons.get(toolCall.id);
							break;
						}
						continue;
					}
					// If approve_always, add to both global and session lists
					if (confirmation === 'approve_always') {
						// Add to local session set (immediate effect)
						sessionApprovedTools.add(toolName);
						// Add to global list (persistent across sub-agent calls)
						if (addToAlwaysApproved) {
							addToAlwaysApproved(toolName);
						}
					}
				}

				approvedToolCalls.push(toolCall);
			}

			// Handle rejected tools - add rejection results to conversation instead of stopping
			if (rejectedToolCalls.length > 0) {
				const rejectionResults: ChatMessage[] = [];
				const handledToolIds = new Set<string>([
					...approvedToolCalls.map(tc => tc.id),
					...rejectedToolCalls.map(tc => tc.id),
				]);
				const cancelledToolCalls = shouldStopAfterRejection
					? toolCalls.filter(tc => !handledToolIds.has(tc.id))
					: [];
				const abortedApprovedToolCalls = shouldStopAfterRejection
					? [...approvedToolCalls]
					: [];

				for (const toolCall of rejectedToolCalls) {
					// Get rejection reason if provided by user
					const rejectionReason = rejectionReasons.get(toolCall.id);
					const rejectMessage = rejectionReason
						? `Tool execution rejected by user: ${rejectionReason}`
						: 'Tool execution rejected by user';

					const toolResultMessage = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: `Error: ${rejectMessage}`,
					};
					rejectionResults.push(toolResultMessage);

					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: `Error: ${rejectMessage}`,
								rejection_reason: rejectionReason,
							} as any,
						});
					}
				}

				if (shouldStopAfterRejection) {
					const cancelledMessage = stopRejectedToolName
						? `Tool execution cancelled because the user rejected tool "${stopRejectedToolName}" and requested the sub-agent to stop`
						: 'Tool execution cancelled because the user requested the sub-agent to stop';

					for (const toolCall of [
						...abortedApprovedToolCalls,
						...cancelledToolCalls,
					]) {
						const toolResultMessage = {
							role: 'tool' as const,
							tool_call_id: toolCall.id,
							content: `Error: ${cancelledMessage}`,
						};
						rejectionResults.push(toolResultMessage);

						if (onMessage) {
							onMessage({
								type: 'sub_agent_message',
								agentId: agent.id,
								agentName: agent.name,
								message: {
									type: 'tool_result',
									tool_call_id: toolCall.id,
									tool_name: toolCall.function.name,
									content: `Error: ${cancelledMessage}`,
								} as any,
							});
						}
					}
				}

				// Add rejection/cancellation results to conversation
				messages.push(...rejectionResults);

				if (shouldStopAfterRejection) {
					const stopInstructionLines = [
						`[System] The user rejected your request to run tool "${
							stopRejectedToolName || 'unknown tool'
						}" and asked you to stop.`,
						stopRejectionReason
							? `[System] Rejection reason: ${stopRejectionReason}`
							: undefined,
						'[System] Do not call any more tools.',
						'[System] Based only on the information already available in this conversation, provide a final summary of what you know, clearly state any missing information caused by the rejected tool, and then end your work.',
					].filter(Boolean);
					const stopInstruction = stopInstructionLines.join('\n');
					collectedTerminationInstructions.push(stopInstruction);
					messages.push({
						role: 'user',
						content: stopInstruction,
					});
					continue;
				}

				// If all tools were rejected and there are no approved tools, continue to next AI turn

				if (approvedToolCalls.length === 0) {
					continue;
				}
			}

			// Execute approved tool calls
			const toolResults: ChatMessage[] = [];
			for (const toolCall of approvedToolCalls) {
				// Check abort signal before executing each tool
				if (abortSignal?.aborted) {
					// Send done message to mark completion
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'done',
							},
						});
					}
					return {
						success: false,
						result: finalResponse,
						error: 'Sub-agent execution aborted during tool execution',
					};
				}

				try {
					const args = JSON.parse(toolCall.function.arguments);

					try {
						const hookResult = await unifiedHooksExecutor.executeHooks(
							'beforeToolCall',
							{
								toolName: toolCall.function.name,
								args,
							},
						);

						if (hookResult && !hookResult.success) {
							const commandError = hookResult.results.find(
								(r: any) => r.type === 'command' && !r.success,
							);

							if (commandError && commandError.type === 'command') {
								const {exitCode, command, output, error} = commandError;

								if (exitCode === 1) {
									const blockedContent =
										error ||
										output ||
										`[beforeToolCall Hook Warning] Command: ${command} exited with code 1`;
									const blockedResult = {
										role: 'tool' as const,
										tool_call_id: toolCall.id,
										content: blockedContent,
									};
									toolResults.push(blockedResult);

									if (onMessage) {
										onMessage({
											type: 'sub_agent_message',
											agentId: agent.id,
											agentName: agent.name,
											message: {
												type: 'tool_result',
												tool_call_id: toolCall.id,
												tool_name: toolCall.function.name,
												content: blockedContent,
											} as any,
										});
									}
									continue;
								}

								if (exitCode >= 2 || exitCode < 0) {
									const hookErrorDetails = {
										type: 'error' as const,
										exitCode,
										command,
										output,
										error,
									};
									const hookFailedResult = {
										role: 'tool' as const,
										tool_call_id: toolCall.id,
										content: '',
										hookFailed: true,
										hookErrorDetails,
									};
									toolResults.push(hookFailedResult as ChatMessage);

									if (onMessage) {
										onMessage({
											type: 'sub_agent_message',
											agentId: agent.id,
											agentName: agent.name,
											message: {
												type: 'tool_result',
												tool_call_id: toolCall.id,
												tool_name: toolCall.function.name,
												content: '',
												hookFailed: true,
												hookErrorDetails,
											} as any,
										});
									}
									continue;
								}
							}
						}
					} catch (hookError) {
						console.warn(
							'Failed to execute beforeToolCall hook in sub-agent:',
							hookError,
						);
					}

					const result = await executeMCPTool(
						toolCall.function.name,
						args,
						abortSignal,
					);

					const toolResult = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: JSON.stringify(result),
					};
					toolResults.push(toolResult);

					// Send tool result to UI
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: JSON.stringify(result),
							} as any,
						});
					}
				} catch (error) {
					const errorResult = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: `Error: ${
							error instanceof Error ? error.message : 'Tool execution failed'
						}`,
					};
					toolResults.push(errorResult);

					// Send error result to UI
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: `Error: ${
									error instanceof Error
										? error.message
										: 'Tool execution failed'
								}`,
							} as any,
						});
					}
				}
			}

			// Add tool results to conversation
			messages.push(...toolResults);

			// Continue to next iteration if there were tool calls
			// The loop will continue until no more tool calls
		}

		return {
			success: true,
			result: finalResponse,
			usage: totalUsage,
			injectedUserMessages:
				collectedInjectedMessages.length > 0
					? collectedInjectedMessages
					: undefined,
			terminationInstructions:
				collectedTerminationInstructions.length > 0
					? collectedTerminationInstructions
					: undefined,
		};
	} catch (error) {
		return {
			success: false,
			result: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}
