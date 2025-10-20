import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {homedir} from 'os';

export interface SubAgent {
	id: string;
	name: string;
	description: string;
	tools: string[];
	createdAt: string;
	updatedAt: string;
}

export interface SubAgentsConfig {
	agents: SubAgent[];
}

const CONFIG_DIR = join(homedir(), '.snow');
const SUB_AGENTS_CONFIG_FILE = join(CONFIG_DIR, 'sub-agents.json');

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

function generateId(): string {
	return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get all sub-agents
 */
export function getSubAgents(): SubAgent[] {
	try {
		ensureConfigDirectory();

		if (!existsSync(SUB_AGENTS_CONFIG_FILE)) {
			return [];
		}

		const configData = readFileSync(SUB_AGENTS_CONFIG_FILE, 'utf8');
		const config = JSON.parse(configData) as SubAgentsConfig;
		return config.agents || [];
	} catch (error) {
		console.error('Failed to load sub-agents:', error);
		return [];
	}
}

/**
 * Get a sub-agent by ID
 */
export function getSubAgent(id: string): SubAgent | null {
	const agents = getSubAgents();
	return agents.find(agent => agent.id === id) || null;
}

/**
 * Save all sub-agents
 */
function saveSubAgents(agents: SubAgent[]): void {
	try {
		ensureConfigDirectory();
		const config: SubAgentsConfig = {agents};
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(SUB_AGENTS_CONFIG_FILE, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save sub-agents: ${error}`);
	}
}

/**
 * Create a new sub-agent
 */
export function createSubAgent(
	name: string,
	description: string,
	tools: string[],
): SubAgent {
	const agents = getSubAgents();
	const now = new Date().toISOString();

	const newAgent: SubAgent = {
		id: generateId(),
		name,
		description,
		tools,
		createdAt: now,
		updatedAt: now,
	};

	agents.push(newAgent);
	saveSubAgents(agents);

	return newAgent;
}

/**
 * Update an existing sub-agent
 */
export function updateSubAgent(
	id: string,
	updates: {
		name?: string;
		description?: string;
		tools?: string[];
	},
): SubAgent | null {
	const agents = getSubAgents();
	const index = agents.findIndex(agent => agent.id === id);

	if (index === -1) {
		return null;
	}

	const existingAgent = agents[index];
	if (!existingAgent) {
		return null;
	}

	const updatedAgent: SubAgent = {
		id: existingAgent.id,
		name: updates.name ?? existingAgent.name,
		description: updates.description ?? existingAgent.description,
		tools: updates.tools ?? existingAgent.tools,
		createdAt: existingAgent.createdAt,
		updatedAt: new Date().toISOString(),
	};

	agents[index] = updatedAgent;
	saveSubAgents(agents);

	return updatedAgent;
}

/**
 * Delete a sub-agent
 */
export function deleteSubAgent(id: string): boolean {
	const agents = getSubAgents();
	const filteredAgents = agents.filter(agent => agent.id !== id);

	if (filteredAgents.length === agents.length) {
		return false; // Agent not found
	}

	saveSubAgents(filteredAgents);
	return true;
}

/**
 * Validate sub-agent data
 */
export function validateSubAgent(data: {
	name: string;
	description: string;
	tools: string[];
}): string[] {
	const errors: string[] = [];

	if (!data.name || data.name.trim().length === 0) {
		errors.push('Agent name is required');
	}

	if (data.name && data.name.length > 100) {
		errors.push('Agent name must be less than 100 characters');
	}

	if (data.description && data.description.length > 500) {
		errors.push('Description must be less than 500 characters');
	}

	if (!data.tools || data.tools.length === 0) {
		errors.push('At least one tool must be selected');
	}

	return errors;
}
