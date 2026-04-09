import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import fs from 'fs/promises';
import path from 'path';
import {homedir} from 'os';
import {existsSync, readdirSync, readFileSync} from 'fs';
import {getSubAgents, type SubAgent} from '../config/subAgentConfig.js';

export type RoleSubagentLocation = 'global' | 'project';

export interface RoleSubagentItem {
	agentId: string;
	agentName: string;
	filename: string;
	location: RoleSubagentLocation;
	path: string;
}

function getRoleSubagentDirectory(
	location: RoleSubagentLocation,
	projectRoot?: string,
): string {
	if (location === 'global') {
		return path.join(homedir(), '.snow');
	}
	return projectRoot || process.cwd();
}

function buildRoleSubagentFilename(agentName: string): string {
	return `ROLE-${agentName}.md`;
}

function parseRoleSubagentFilename(filename: string): string | null {
	const match = filename.match(/^ROLE-(.+)\.md$/);
	return match && match[1] ? match[1] : null;
}

export function getRoleSubagentFilePath(
	agentName: string,
	location: RoleSubagentLocation,
	projectRoot?: string,
): string {
	const dir = getRoleSubagentDirectory(location, projectRoot);
	return path.join(dir, buildRoleSubagentFilename(agentName));
}

export function checkRoleSubagentExists(
	agentName: string,
	location: RoleSubagentLocation,
	projectRoot?: string,
): boolean {
	return existsSync(getRoleSubagentFilePath(agentName, location, projectRoot));
}

export async function createRoleSubagentFile(
	agentName: string,
	location: RoleSubagentLocation,
	projectRoot?: string,
): Promise<{success: boolean; path: string; error?: string}> {
	try {
		const filePath = getRoleSubagentFilePath(agentName, location, projectRoot);

		if (existsSync(filePath)) {
			return {
				success: false,
				path: filePath,
				error: `Role file for "${agentName}" already exists at this location`,
			};
		}

		const dir = path.dirname(filePath);
		await fs.mkdir(dir, {recursive: true});
		await fs.writeFile(filePath, '', 'utf-8');

		return {success: true, path: filePath};
	} catch (error) {
		return {
			success: false,
			path: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

export async function deleteRoleSubagentFile(
	agentName: string,
	location: RoleSubagentLocation,
	projectRoot?: string,
): Promise<{success: boolean; path: string; error?: string}> {
	try {
		const filePath = getRoleSubagentFilePath(agentName, location, projectRoot);

		if (!existsSync(filePath)) {
			return {
				success: false,
				path: filePath,
				error: `Role file for "${agentName}" does not exist at this location`,
			};
		}

		await fs.unlink(filePath);
		return {success: true, path: filePath};
	} catch (error) {
		return {
			success: false,
			path: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

export function listRoleSubagents(
	location: RoleSubagentLocation,
	projectRoot?: string,
): RoleSubagentItem[] {
	const dir = getRoleSubagentDirectory(location, projectRoot);
	const items: RoleSubagentItem[] = [];

	if (!existsSync(dir)) return items;

	try {
		const files = readdirSync(dir);
		const allAgents = getSubAgents();
		const agentNameMap = new Map<string, SubAgent>();
		for (const agent of allAgents) {
			agentNameMap.set(agent.name, agent);
		}

		for (const file of files) {
			const agentName = parseRoleSubagentFilename(file);
			if (!agentName) continue;

			const agent = agentNameMap.get(agentName);
			items.push({
				agentId: agent?.id || agentName,
				agentName,
				filename: file,
				location,
				path: path.join(dir, file),
			});
		}
	} catch {
		// ignore
	}

	return items.sort((a, b) => a.agentName.localeCompare(b.agentName));
}

/**
 * Load custom role content for a subagent (project > global priority).
 * Returns the file content if found, or null.
 */
export function loadSubAgentCustomRole(
	agentName: string,
	projectRoot?: string,
): string | null {
	if (projectRoot) {
		const projectPath = getRoleSubagentFilePath(
			agentName,
			'project',
			projectRoot,
		);
		if (existsSync(projectPath)) {
			try {
				const content = readFileSync(projectPath, 'utf-8').trim();
				if (content) return content;
			} catch {
				// fall through to global
			}
		}
	}

	const globalPath = getRoleSubagentFilePath(agentName, 'global');
	if (existsSync(globalPath)) {
		try {
			const content = readFileSync(globalPath, 'utf-8').trim();
			if (content) return content;
		} catch {
			// no custom role
		}
	}

	return null;
}

/**
 * Get all available subagents for selection in creation panel.
 */
export function getAvailableSubAgents(): Array<{
	id: string;
	name: string;
}> {
	return getSubAgents().map(a => ({id: a.id, name: a.name}));
}

registerCommand('role-subagent', {
	execute: async (args?: string): Promise<CommandResult> => {
		const trimmedArgs = args?.trim();

		if (trimmedArgs === '-d' || trimmedArgs === '--delete') {
			return {
				success: true,
				action: 'showRoleSubagentDeletion',
				message: 'Opening sub-agent role deletion dialog...',
			};
		}

		if (trimmedArgs === '-l' || trimmedArgs === '--list') {
			return {
				success: true,
				action: 'showRoleSubagentList',
				message: 'Opening sub-agent role list panel...',
			};
		}

		return {
			success: true,
			action: 'showRoleSubagentCreation',
			message: 'Opening sub-agent role creation dialog...',
		};
	},
});

export default {};
