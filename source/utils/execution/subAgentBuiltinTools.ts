import {getSubAgentMaxSpawnDepth} from '../config/projectSettings.js';
import {runningSubAgentTracker} from './runningSubAgentTracker.js';
import type {MCPTool} from './mcpToolsManager.js';
import type {ChatMessage} from '../../api/chat.js';

export function createSendMessageTool(): MCPTool {
	return {
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
}

export function createQueryAgentsStatusTool(): MCPTool {
	return {
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
}

export function createSpawnSubAgentTool(): MCPTool {
	return {
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
}

export function injectBuiltinTools(
	allowedTools: MCPTool[],
	spawnDepth: number,
): void {
	const maxSpawnDepth = getSubAgentMaxSpawnDepth();
	allowedTools.push(createSendMessageTool(), createQueryAgentsStatusTool());
	if (spawnDepth < maxSpawnDepth) {
		allowedTools.push(createSpawnSubAgentTool());
	}
}

export function buildPeerAgentsContext(
	instanceId: string | undefined,
	canSpawn: boolean,
): string {
	const otherAgents = runningSubAgentTracker
		.getRunningAgents()
		.filter(a => a.instanceId !== instanceId);

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
		return `\n\n## Currently Running Peer Agents
The following sub-agents are running in parallel with you. You can use \`query_agents_status\` to get real-time status, \`send_message_to_agent\` to communicate${spawnHint}.

${agentList}

If you discover information useful to another agent, proactively share it.${spawnAdvice}`;
	}

	const spawnToolLine = canSpawn
		? '\n- `spawn_sub_agent`: Spawn a DIFFERENT type of agent for specialized help (do NOT spawn your own type to offload work)'
		: '';
	const spawnUsage = canSpawn
		? '\n\n**Spawn rules**: Only use `spawn_sub_agent` when you genuinely need a different agent\'s specialization (e.g., you are read-only but need code changes). NEVER spawn to delegate your own task or to "parallelize" work you should do yourself.'
		: '';
	return `\n\n## Agent Collaboration Tools
You have access to these collaboration tools:
- \`query_agents_status\`: Check which sub-agents are currently running
- \`send_message_to_agent\`: Send a message to a running peer agent (check status first!)${spawnToolLine}${spawnUsage}`;
}

export async function buildInitialMessages(
	agent: any,
	prompt: string,
	instanceId: string | undefined,
	spawnDepth: number,
): Promise<ChatMessage[]> {
	const canSpawn = spawnDepth < getSubAgentMaxSpawnDepth();
	const otherAgentsContext = buildPeerAgentsContext(instanceId, canSpawn);

	let customRoleContent: string | null = null;
	try {
		const {loadSubAgentCustomRole} = await import(
			'../commands/roleSubagent.js'
		);
		customRoleContent = loadSubAgentCustomRole(agent.name, process.cwd());
	} catch {
		// roleSubagent module unavailable, skip custom role
	}

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
	if (otherAgentsContext) {
		finalPrompt = `${finalPrompt}${otherAgentsContext}`;
	}

	return [
		{
			role: 'user',
			content: finalPrompt,
		},
	];
}
