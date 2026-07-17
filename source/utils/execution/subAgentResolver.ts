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

export async function resolveAgent(
	agentId: string,
): Promise<ResolveAgentResult> {
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

function toolMatchesAllowlist(toolName: string, allowedTool: string): boolean {
	const normalizedToolName = toolName.replace(/_/g, '-');
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
}

/**
 * Warn (once per agent) about frontmatter tools that match no registered MCP/builtin tool.
 * Unknown tools are not silently dropped from the allowlist declaration — we only warn.
 */
export function warnUnknownAgentTools(
	agent: any,
	allTools: MCPTool[],
): string[] {
	const declared: string[] = Array.isArray(agent?.tools) ? agent.tools : [];
	if (declared.length === 0) {
		return [];
	}

	const unknown = declared.filter(
		allowedTool =>
			!allTools.some(tool =>
				toolMatchesAllowlist(tool.function.name, allowedTool),
			),
	);

	if (unknown.length > 0) {
		console.warn(
			`[sub-agent] Unknown tools for agent "${
				agent?.id || agent?.name || '?'
			}": ${unknown.join(', ')} (not in MCP/builtin registry)`,
		);
	}
	return unknown;
}

export function filterAllowedTools(agent: any, allTools: MCPTool[]): MCPTool[] {
	if (Array.isArray(agent?.tools) && agent.tools.length > 0) {
		warnUnknownAgentTools(agent, allTools);
	}

	return allTools.filter((tool: MCPTool) => {
		const toolName = tool.function.name;

		return agent.tools.some((allowedTool: string) => {
			return toolMatchesAllowlist(toolName, allowedTool);
		});
	});
}
