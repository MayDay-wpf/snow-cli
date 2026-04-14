import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {homedir} from 'os';
import {getAllBuiltinAgentDefinitions} from '../execution/subagents/index.js';

export interface SubAgent {
	id: string;
	name: string;
	description: string;
	systemPrompt?: string;
	tools?: string[];
	role?: string;
	createdAt?: string;
	updatedAt?: string;
	builtin?: boolean;
	// 可选配置项
	configProfile?: string; // 配置文件名称
	customSystemPrompt?: string; // 自定义系统提示词
	customHeaders?: Record<string, string>; // 自定义请求头
}
export interface SubAgentsConfig {
	agents: SubAgent[];
}

const CONFIG_DIR = join(homedir(), '.snow');
const SUB_AGENTS_CONFIG_FILE = join(CONFIG_DIR, 'sub-agents.json');

/**
 * Built-in sub-agents (hardcoded, always available)
 * Build dynamically so tool enable/disable changes are reflected immediately.
 */
function getBuiltinAgents(): SubAgent[] {
	return getAllBuiltinAgentDefinitions().map(def => ({
		...def,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		builtin: true,
	}));
}

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

function generateId(): string {
	return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get user-configured sub-agents only (exported for MCP tool generation)
 */
export function getUserSubAgents(): SubAgent[] {
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
 * Get all sub-agents (built-in + user-configured)
 * 优先使用用户副本，避免重复
 */
export function getSubAgents(): SubAgent[] {
	const userAgents = getUserSubAgents();
	const userAgentIds = new Set(userAgents.map(a => a.id));
	const builtinAgents = getBuiltinAgents();

	// 过滤掉已被用户覆盖的内置代理
	const effectiveBuiltinAgents = builtinAgents.filter(
		agent => !userAgentIds.has(agent.id),
	);

	// 先返回内置代理（未被覆盖的），再返回用户代理
	return [...effectiveBuiltinAgents, ...userAgents];
}

/**
 * Get a sub-agent by ID (checks both built-in and user-configured)
 * getSubAgents已经处理了优先级（用户副本优先）
 */
export function getSubAgent(id: string): SubAgent | null {
	const agents = getSubAgents();
	return agents.find(agent => agent.id === id) || null;
}

/**
 * Save user-configured sub-agents only (never saves built-in agents)
 */
function saveSubAgents(agents: SubAgent[]): void {
	try {
		ensureConfigDirectory();
		// Filter out built-in agents (should never be saved to config)
		const userAgents = agents.filter(agent => !agent.builtin);
		const config: SubAgentsConfig = {agents: userAgents};
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(SUB_AGENTS_CONFIG_FILE, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save sub-agents: ${error}`);
	}
}

/**
 * Create a new sub-agent (user-configured only)
 */
export function createSubAgent(
	name: string,
	description: string,
	tools: string[],
	role?: string,
	configProfile?: string,
	customSystemPrompt?: string,
	customHeaders?: Record<string, string>,
): SubAgent {
	const userAgents = getUserSubAgents();
	const now = new Date().toISOString();

	const newAgent: SubAgent = {
		id: generateId(),
		name,
		description,
		role,
		tools,
		createdAt: now,
		updatedAt: now,
		builtin: false,
		configProfile,
		customSystemPrompt,
		customHeaders,
	};

	userAgents.push(newAgent);
	saveSubAgents(userAgents);

	return newAgent;
}

/**
 * Update an existing sub-agent
 * For built-in agents: creates or updates a user copy (override)
 * For user-configured agents: updates the existing agent
 */
export function updateSubAgent(
	id: string,
	updates: {
		name?: string;
		description?: string;
		role?: string;
		tools?: string[];
		configProfile?: string;
		customSystemPrompt?: string;
		customHeaders?: Record<string, string>;
	},
): SubAgent | null {
	const agent = getSubAgent(id);
	if (!agent) {
		return null;
	}

	const userAgents = getUserSubAgents();
	const existingUserIndex = userAgents.findIndex(a => a.id === id);

	// If it's a built-in agent, create or update user copy
	if (agent.builtin) {
		// Get existing user copy if it exists
		const existingUserCopy =
			existingUserIndex >= 0 ? userAgents[existingUserIndex] : null;

		const userCopy: SubAgent = {
			id: agent.id,
			name: updates.name ?? agent.name,
			description: updates.description ?? agent.description,
			role: updates.role ?? agent.role,
			tools: updates.tools ?? agent.tools,
			createdAt: agent.createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			builtin: false, // Must be false to allow saving to config file
			// 使用 hasOwnProperty 检查是否传递了该字段，而不是检查值是否为 undefined
			// 这样可以区分"未传递"和"传递 undefined 以清除"
			configProfile:
				'configProfile' in updates
					? updates.configProfile
					: existingUserCopy?.configProfile,
			customSystemPrompt:
				'customSystemPrompt' in updates
					? updates.customSystemPrompt
					: existingUserCopy?.customSystemPrompt,
			customHeaders:
				'customHeaders' in updates
					? updates.customHeaders
					: existingUserCopy?.customHeaders,
		};

		if (existingUserIndex >= 0) {
			// Update existing user copy
			userAgents[existingUserIndex] = userCopy;
		} else {
			// Create new user copy
			userAgents.push(userCopy);
		}

		saveSubAgents(userAgents);
		return userCopy;
	}

	// Update regular user-configured agent
	if (existingUserIndex === -1) {
		return null;
	}

	const existingAgent = userAgents[existingUserIndex];
	if (!existingAgent) {
		return null;
	}

	const updatedAgent: SubAgent = {
		id: existingAgent.id,
		name: updates.name ?? existingAgent.name,
		description: updates.description ?? existingAgent.description,
		role: updates.role ?? existingAgent.role,
		tools: updates.tools ?? existingAgent.tools,
		createdAt: existingAgent.createdAt,
		updatedAt: new Date().toISOString(),
		builtin: false,
		// 使用 'in' 操作符检查是否传递了该字段，而不是使用 ?? 运算符
		// 这样可以区分"未传递"和"传递 undefined 以清除"
		configProfile:
			'configProfile' in updates
				? updates.configProfile
				: existingAgent.configProfile,
		customSystemPrompt:
			'customSystemPrompt' in updates
				? updates.customSystemPrompt
				: existingAgent.customSystemPrompt,
		customHeaders:
			'customHeaders' in updates
				? updates.customHeaders
				: existingAgent.customHeaders,
	};

	userAgents[existingUserIndex] = updatedAgent;
	saveSubAgents(userAgents);

	return updatedAgent;
}

/**
 * Delete a sub-agent
 * For built-in agents: removes user override (restores default)
 * For user-configured agents: permanently deletes the agent
 */
export function deleteSubAgent(id: string): boolean {
	const userAgents = getUserSubAgents();
	const filteredAgents = userAgents.filter(agent => agent.id !== id);

	if (filteredAgents.length === userAgents.length) {
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
