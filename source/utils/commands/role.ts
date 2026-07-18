import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import fs from 'fs/promises';
import path from 'path';
import {homedir} from 'os';
import {existsSync, readdirSync} from 'fs';
import crypto from 'crypto';
import {
	readSettings,
	updateSettings,
	type SettingsScope,
	type UnifiedSettings,
} from '../config/unifiedSettings.js';

// Role location type
export type RoleLocation = 'global' | 'project';

type RoleConfig = NonNullable<UnifiedSettings['role']>;

const DEFAULT_ACTIVE_ROLE_ID = 'active';

/**
 * Role metadata (activeRoleId / overrideRoleIds) is now stored in the unified
 * settings.json (`role` key). Role MARKDOWN files (`ROLE.md`,
 * `ROLE-<hash>.md`) are still kept as plain files in the project / home
 * directory.
 */
function settingsScope(location: RoleLocation): SettingsScope {
	return location === 'global' ? 'global' : 'project';
}

function readRoleConfig(
	location: RoleLocation,
	projectRoot?: string,
): RoleConfig {
	const settings = readSettings(settingsScope(location), projectRoot);
	return settings.role ?? {};
}

async function writeRoleConfig(
	location: RoleLocation,
	config: RoleConfig,
	projectRoot?: string,
): Promise<void> {
	updateSettings(
		settingsScope(location),
		settings => {
			settings.role = config;
		},
		projectRoot,
	);
}

function resolveActiveRoleId(
	location: RoleLocation,
	projectRoot: string | undefined,
	roles: Array<{id: string; filename: string}>,
): string {
	const config = readRoleConfig(location, projectRoot);
	const configured = config.activeRoleId;
	if (configured && roles.some(r => r.id === configured)) {
		return configured;
	}
	// Default: ROLE.md if present, otherwise first role
	if (
		roles.some(r => r.id === DEFAULT_ACTIVE_ROLE_ID || r.filename === 'ROLE.md')
	) {
		return DEFAULT_ACTIVE_ROLE_ID;
	}
	return roles[0]?.id || DEFAULT_ACTIVE_ROLE_ID;
}

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

/**
 * Role item interface for list display
 */
export interface RoleItem {
	id: string; // unique identifier (hash suffix or 'active')
	name: string; // display name (extracted from file or filename)
	filename: string; // actual filename
	isActive: boolean; // whether this is the active ROLE.md
	isOverride: boolean; // whether this role is marked to OVERRIDE the system prompt
	location: RoleLocation;
	path: string; // full file path
}

/**
 * Generate a short random hash for role filename
 */
function generateRoleHash(): string {
	return crypto.randomBytes(3).toString('hex'); // 6 characters
}

/**
 * Get the directory path for roles based on location
 */
export function getRoleDirectory(
	location: RoleLocation,
	projectRoot?: string,
): string {
	if (location === 'global') {
		return path.join(homedir(), '.snow');
	}
	return projectRoot || process.cwd();
}

/**
 * Parse role filename to extract hash suffix
 * ROLE.md -> null (active)
 * ROLE-abc123.md -> 'abc123'
 */
function parseRoleFilename(filename: string): string | null {
	const match = filename.match(/^ROLE-([a-f0-9]+)\.md$/i);
	return match && match[1] ? match[1] : null;
}

/**
 * List all role files at specified location
 */
export function listRoles(
	location: RoleLocation,
	projectRoot?: string,
): RoleItem[] {
	const dir = getRoleDirectory(location, projectRoot);
	const roles: RoleItem[] = [];

	if (!existsSync(dir)) {
		return roles;
	}

	try {
		const files = readdirSync(dir);
		const scanned: Array<{id: string; filename: string}> = [];

		for (const file of files) {
			// Match ROLE.md or ROLE-{hash}.md
			if (file === 'ROLE.md' || /^ROLE-[a-f0-9]+\.md$/i.test(file)) {
				const isRoleMd = file === 'ROLE.md';
				const hash = parseRoleFilename(file);
				const id = isRoleMd ? DEFAULT_ACTIVE_ROLE_ID : hash || file;
				scanned.push({id, filename: file});
			}
		}

		if (scanned.length === 0) {
			return roles;
		}

		const activeRoleId = resolveActiveRoleId(location, projectRoot, scanned);
		const config = readRoleConfig(location, projectRoot);
		const overrideSet = new Set(config.overrideRoleIds || []);

		for (const item of scanned) {
			const isActive = item.id === activeRoleId;
			roles.push({
				id: item.id,
				name: isActive ? 'Active Role' : `Role (${item.id})`,
				filename: item.filename,
				isActive,
				isOverride: overrideSet.has(item.id),
				location,
				path: path.join(dir, item.filename),
			});
		}
	} catch {
		// Directory read error, return empty
	}

	// Sort by filename only to keep list stable when switching active role
	return roles.sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * Switch active role by persisting the selected role id.
 *
 * Rationale: Role files can have stable names (ROLE.md / ROLE-<id>.md), while the
 * actual active selection is recorded in config to avoid "it didn't switch" confusion.
 */
export async function switchActiveRole(
	roleId: string,
	location: RoleLocation,
	projectRoot?: string,
): Promise<{success: boolean; error?: string}> {
	try {
		const roles = listRoles(location, projectRoot);
		const targetRole = roles.find(r => r.id === roleId);

		if (!targetRole) {
			return {success: false, error: 'Role not found'};
		}

		const previous = readRoleConfig(location, projectRoot);
		await writeRoleConfig(
			location,
			{...previous, activeRoleId: roleId},
			projectRoot,
		);
		return {success: true};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Create a new inactive role file
 */
export async function createInactiveRole(
	location: RoleLocation,
	projectRoot?: string,
): Promise<{success: boolean; path: string; error?: string}> {
	try {
		const dir = getRoleDirectory(location, projectRoot);

		// Create directory if needed
		if (location === 'global') {
			await fs.mkdir(dir, {recursive: true});
		}

		// Generate unique hash
		const hash = generateRoleHash();
		const filename = `ROLE-${hash}.md`;
		const filePath = path.join(dir, filename);

		// Create empty file
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

/**
 * Delete a role file (only inactive roles can be deleted)
 */
export async function deleteRole(
	roleId: string,
	location: RoleLocation,
	projectRoot?: string,
): Promise<{success: boolean; error?: string}> {
	try {
		const roles = listRoles(location, projectRoot);
		const targetRole = roles.find(r => r.id === roleId);

		if (!targetRole) {
			return {success: false, error: 'Role not found'};
		}

		if (targetRole.isActive) {
			return {success: false, error: 'Cannot delete active role'};
		}

		await fs.unlink(targetRole.path);

		// If config points to this role, fall back to ROLE.md
		const config = readRoleConfig(location, projectRoot);
		if (config.activeRoleId === roleId) {
			await writeRoleConfig(
				location,
				{...config, activeRoleId: DEFAULT_ACTIVE_ROLE_ID},
				projectRoot,
			);
		}

		return {success: true};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Toggle override flag for a role: when enabled, this role's content
 * COMPLETELY REPLACES the default system prompt (only system env/time appended).
 * Only the active role can be toggled - inactive roles cannot be made the override.
 */
export async function toggleRoleOverride(
	roleId: string,
	location: RoleLocation,
	projectRoot?: string,
): Promise<{success: boolean; isOverride?: boolean; error?: string}> {
	try {
		const roles = listRoles(location, projectRoot);
		const targetRole = roles.find(r => r.id === roleId);

		if (!targetRole) {
			return {success: false, error: 'Role not found'};
		}

		if (!targetRole.isActive) {
			return {
				success: false,
				error: 'Only the active role can be marked as override',
			};
		}

		const config = readRoleConfig(location, projectRoot);
		const current = new Set(config.overrideRoleIds || []);
		let nextIsOverride: boolean;
		if (current.has(roleId)) {
			current.delete(roleId);
			nextIsOverride = false;
		} else {
			current.add(roleId);
			nextIsOverride = true;
		}
		const nextConfig: RoleConfig = {
			...config,
			overrideRoleIds: Array.from(current),
		};
		await writeRoleConfig(location, nextConfig, projectRoot);
		return {success: true, isOverride: nextIsOverride};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

// Register /role command - show role creation dialog
registerCommand('role', {
	execute: async (args?: string): Promise<CommandResult> => {
		const trimmedArgs = args?.trim();

		// Check if delete flag is present
		if (trimmedArgs === '-d' || trimmedArgs === '--delete') {
			return {
				success: true,
				action: 'showRoleDeletion',
				message: 'Opening ROLE deletion dialog...',
			};
		}

		// Check if list flag is present
		if (trimmedArgs === '-l' || trimmedArgs === '--list') {
			return {
				success: true,
				action: 'showRoleList',
				message: 'Opening ROLE list panel...',
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
