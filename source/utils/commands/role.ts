import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import fs from 'fs/promises';
import path from 'path';
import {homedir} from 'os';
import {existsSync} from 'fs';

// Role location type
export type RoleLocation = 'global' | 'project';

/**
 * Get role file path based on location
 */
export function getRoleFilePath(
	location: RoleLocation,
	projectRoot?: string,
): string {
	if (location === 'global') {
		return path.join(homedir(), '.snow', 'ROLE.md');
	}
	const root = projectRoot || process.cwd();
	return path.join(root, 'ROLE.md');
}

/**
 * Check if role file exists at specified location
 */
export function checkRoleExists(
	location: RoleLocation,
	projectRoot?: string,
): boolean {
	const roleFilePath = getRoleFilePath(location, projectRoot);
	return existsSync(roleFilePath);
}

/**
 * Create role file at specified location
 */
export async function createRoleFile(
	location: RoleLocation,
	projectRoot?: string,
): Promise<{success: boolean; path: string; error?: string}> {
	try {
		const roleFilePath = getRoleFilePath(location, projectRoot);

		// Create parent directory if needed (for global location)
		if (location === 'global') {
			const dir = path.dirname(roleFilePath);
			await fs.mkdir(dir, {recursive: true});
		}

		// Create empty ROLE.md file
		await fs.writeFile(roleFilePath, '', 'utf-8');

		return {
			success: true,
			path: roleFilePath,
		};
	} catch (error) {
		return {
			success: false,
			path: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Delete role file at specified location
 */
export async function deleteRoleFile(
	location: RoleLocation,
	projectRoot?: string,
): Promise<{success: boolean; path: string; error?: string}> {
	try {
		const roleFilePath = getRoleFilePath(location, projectRoot);

		// Check if file exists
		if (!existsSync(roleFilePath)) {
			return {
				success: false,
				path: roleFilePath,
				error: 'ROLE.md does not exist at this location',
			};
		}

		// Delete the file
		await fs.unlink(roleFilePath);

		return {
			success: true,
			path: roleFilePath,
		};
	} catch (error) {
		return {
			success: false,
			path: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

// Register /role command - show role creation dialog
registerCommand('role', {
	execute: async (args?: string): Promise<CommandResult> => {
		// Check if delete flag is present
		if (args?.trim() === '-d' || args?.trim() === '--delete') {
			return {
				success: true,
				action: 'showRoleDeletion',
				message: 'Opening ROLE deletion dialog...',
			};
		}

		// Default: show creation dialog
		return {
			success: true,
			action: 'showRoleCreation',
			message: 'Opening ROLE creation dialog...',
		};
	},
});

export default {};
