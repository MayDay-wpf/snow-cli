import {getSubAgent} from '../config/subAgentConfig.js';
import {
	BUILTIN_AGENT_IDS,
	getBuiltinAgentDefinition,
} from './subagents/index.js';
import type {MCPTool} from './mcpToolsManager.js';

export interface ResolveAgentResult {
	agent: any;
	error?: string;
}

export async function resolveAgent(agentId: string): Promise<ResolveAgentResult> {
	if (BUILTIN_AGENT_IDS.includes(agentId)) {
		const {getUserSubAgents} = await import('../config/subAgentConfig.js');
		const userAgents = getUserSubAgents();
		const userAgent = userAgents.find(a => a.id === agentId);
		if (userAgent) {
			return {agent: userAgent};
		}
		return {agent: getBuiltinAgentDefinition(agentId)};
	}

	const agent = getSubAgent(agentId);
	if (!agent) {
		return {
			agent: null,
			error: `Sub-agent with ID "${agentId}" not found`,
		};
	}
	return {agent};
}

const BUILTIN_PREFIXES = new Set([
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

export function filterAllowedTools(agent: any, allTools: MCPTool[]): MCPTool[] {
	return allTools.filter((tool: MCPTool) => {
		const toolName = tool.function.name;
		const normalizedToolName = toolName.replace(/_/g, '-');

		return agent.tools.some((allowedTool: string) => {
			const normalizedAllowedTool = allowedTool.replace(/_/g, '-');
			const isQualifiedAllowed =
				normalizedAllowedTool.includes('-') ||
				Array.from(BUILTIN_PREFIXES).some(prefix =>
					normalizedAllowedTool.startsWith(prefix),
				);

			if (
				normalizedToolName === normalizedAllowedTool ||
				normalizedToolName.startsWith(`${normalizedAllowedTool}-`)
			) {
				return true;
			}

			// Backward compatibility: allow unqualified external tool names (missing service prefix)
			const isExternalTool = !Array.from(BUILTIN_PREFIXES).some(prefix =>
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
}
