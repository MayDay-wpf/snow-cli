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

const builtinAgentsMap: Record<string, BuiltinAgentDefinition> = {
	agent_explore: exploreAgent,
	agent_plan: planAgent,
	agent_general: generalAgent,
	agent_analyze: analyzeAgent,
	agent_qa: qaAgent,
	agent_debug: debugAgent,
};

export const BUILTIN_AGENT_IDS = Object.keys(builtinAgentsMap);

export function getBuiltinAgentDefinition(
	agentId: string,
): BuiltinAgentDefinition | null {
	return builtinAgentsMap[agentId] ?? null;
}

export function getAllBuiltinAgentDefinitions(): BuiltinAgentDefinition[] {
	return Object.values(builtinAgentsMap);
}
