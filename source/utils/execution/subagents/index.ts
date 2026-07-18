export type {BuiltinAgentDefinition} from './types.js';

export {exploreAgent} from './exploreAgent.js';
export {planAgent} from './planAgent.js';
export {generalAgent} from './generalAgent.js';
export {analyzeAgent} from './analyzeAgent.js';
export {qaAgent} from './qaAgent.js';
export {debugAgent} from './debugAgent.js';

import {exploreAgent} from './exploreAgent.js';
import {planAgent} from './planAgent.js';
import {generalAgent} from './generalAgent.js';
import {analyzeAgent} from './analyzeAgent.js';
import {qaAgent} from './qaAgent.js';
import {debugAgent} from './debugAgent.js';
import type {BuiltinAgentDefinition} from './types.js';
import {isMCPToolEnabled} from '../../config/disabledMCPTools.js';

const builtinAgentsMap: Record<string, BuiltinAgentDefinition> = {
	agent_explore: exploreAgent,
	agent_plan: planAgent,
	agent_general: generalAgent,
	agent_analyze: analyzeAgent,
	agent_qa: qaAgent,
	agent_debug: debugAgent,
};

function resolveFilesystemEditTools(tools: string[]): string[] {
	const replaceEditEnabled = isMCPToolEnabled('filesystem', 'replaceedit');
	const hashlineEditEnabled = isMCPToolEnabled('filesystem', 'edit');

	return tools.filter(tool => {
		if (tool === 'filesystem-replaceedit') {
			return replaceEditEnabled;
		}
		if (tool === 'filesystem-edit') {
			return hashlineEditEnabled;
		}
		return true;
	});
}

function buildDynamicEditGuidance(
	replaceEditEnabled: boolean,
	hashlineEditEnabled: boolean,
	context: 'strategy' | 'tools',
): string {
	if (context === 'strategy') {
		if (replaceEditEnabled && hashlineEditEnabled) {
			return (
				'- USE filesystem-replaceedit by default: Better diff readability with overflow context for closure checks\n' +
				'- USE filesystem-edit when you need strict hash-anchored stale-read safety'
			);
		}
		if (replaceEditEnabled) {
			return '- USE filesystem-replaceedit: Better diff readability with overflow context for closure checks';
		}
		if (hashlineEditEnabled) {
			return '- USE filesystem-edit: Strict hash-anchored editing with stale-read safety';
		}
		return '- No filesystem edit tool is enabled. Use read/search/terminal workflows or enable an edit tool in MCP settings.';
	}

	if (replaceEditEnabled && hashlineEditEnabled) {
		return (
			'- filesystem-replaceedit: Default edit tool for search-replace workflow and readable diffs\n' +
			'- filesystem-edit: Optional strict hash-anchored editing (reference "lineNum:hash" anchors from read output)'
		);
	}
	if (replaceEditEnabled) {
		return '- filesystem-replaceedit: Edit tool for search-replace workflow and readable diffs';
	}
	if (hashlineEditEnabled) {
		return '- filesystem-edit: Strict hash-anchored editing (reference "lineNum:hash" anchors from read output)';
	}
	return '- (No filesystem edit tool enabled currently)';
}

function resolveDynamicRoleText(definition: BuiltinAgentDefinition): string {
	const replaceEditEnabled = isMCPToolEnabled('filesystem', 'replaceedit');
	const hashlineEditEnabled = isMCPToolEnabled('filesystem', 'edit');
	let role = definition.role;

	if (definition.id === 'agent_general') {
		role = role.replace(
			'- USE filesystem-replaceedit by default: Better diff readability with overflow context for closure checks\n- USE filesystem-edit when you need strict hash-anchored stale-read safety',
			buildDynamicEditGuidance(
				replaceEditEnabled,
				hashlineEditEnabled,
				'strategy',
			),
		);
		role = role.replace(
			'- filesystem-replaceedit: Default edit tool for search-replace workflow and readable diffs\n- filesystem-edit: Optional strict hash-anchored editing (reference "lineNum:hash" anchors from read output)',
			buildDynamicEditGuidance(
				replaceEditEnabled,
				hashlineEditEnabled,
				'tools',
			),
		);
	}

	if (definition.id === 'agent_debug') {
		role = role.replace(
			'- filesystem-replaceedit: Default edit tool for readable diff validation and closure checks\n- filesystem-edit: Optional strict hash-anchored editing (insert/replace/delete via anchors)',
			buildDynamicEditGuidance(
				replaceEditEnabled,
				hashlineEditEnabled,
				'tools',
			).replace(
				'reference "lineNum:hash" anchors from read output',
				'insert/replace/delete via anchors',
			),
		);
	}

	return role;
}

function withDynamicTools(definition: BuiltinAgentDefinition): BuiltinAgentDefinition {
	if (definition.id !== 'agent_general' && definition.id !== 'agent_debug') {
		return definition;
	}

	return {
		...definition,
		role: resolveDynamicRoleText(definition),
		tools: resolveFilesystemEditTools(definition.tools),
	};
}

export const BUILTIN_AGENT_IDS = Object.keys(builtinAgentsMap);

export function getBuiltinAgentDefinition(
	agentId: string,
): BuiltinAgentDefinition | null {
	const definition = builtinAgentsMap[agentId];
	return definition ? withDynamicTools(definition) : null;
}

export function getAllBuiltinAgentDefinitions(): BuiltinAgentDefinition[] {
	return Object.values(builtinAgentsMap).map(withDynamicTools);
}
