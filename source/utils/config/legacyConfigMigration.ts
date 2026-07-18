/**
 * One-shot migration from legacy split JSON files in `.snow/` to the unified
 * `settings.json`. Called early during CLI bootstrap so the rest of the code
 * base can safely read/write only `settings.json`.
 *
 * Files migrated (per scope: project `<cwd>/.snow/` and global `~/.snow/`):
 *   - settings.json                 -> kept; merged into unified shape (no-op if already shaped)
 *   - codebase.json                 -> settings.codebase
 *   - connection.json               -> settings.connection (project only)
 *   - working-dirs.json             -> settings.workingDirectories
 *   - disabled-builtin-tools.json   -> settings.disabledBuiltInServices
 *   - disabled-mcp-tools.json       -> settings.disabledMCPTools
 *   - opt-in-mcp-tools.json         -> settings.optInMCPTools
 *   - disabled-skills.json          -> settings.disabledSkills
 *   - mcp-config.json               -> settings.mcpServers
 *   - role.json                     -> settings.role
 *   - sensitive-commands.json       -> settings.sensitiveCommands
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	readSettings,
	writeSettings,
	type SettingsScope,
	type UnifiedSettings,
} from './unifiedSettings.js';

const LEGACY_FILES = {
	codebase: 'codebase.json',
	connection: 'connection.json',
	workingDirs: 'working-dirs.json',
	disabledBuiltin: 'disabled-builtin-tools.json',
	disabledMcp: 'disabled-mcp-tools.json',
	optInMcp: 'opt-in-mcp-tools.json',
	disabledSkills: 'disabled-skills.json',
	mcpConfig: 'mcp-config.json',
	role: 'role.json',
	sensitive: 'sensitive-commands.json',
} as const;

function getSnowDir(scope: SettingsScope, workingDirectory?: string): string {
	if (scope === 'global') {
		return path.join(os.homedir(), '.snow');
	}
	return path.join(workingDirectory || process.cwd(), '.snow');
}

function safeReadJSON<T>(filePath: string): T | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		const raw = fs.readFileSync(filePath, 'utf-8');
		if (!raw.trim()) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function safeUnlink(filePath: string): void {
	try {
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	} catch {
		// ignore
	}
}

interface MigrationResult {
	scope: SettingsScope;
	migratedFiles: string[];
	settings: UnifiedSettings;
}

function migrateScope(
	scope: SettingsScope,
	workingDirectory?: string,
): MigrationResult | null {
	const dir = getSnowDir(scope, workingDirectory);
	if (!fs.existsSync(dir)) {
		return null;
	}

	const settings = readSettings(scope, workingDirectory);
	const migrated: string[] = [];
	let mutated = false;

	const tryMigrate = <T>(
		filename: string,
		apply: (data: T) => boolean,
	): void => {
		const filePath = path.join(dir, filename);
		const data = safeReadJSON<T>(filePath);
		if (data === null) {
			// Even if the file doesn't exist, we still consider migration "done"
			// for that key. We only delete files that DO exist, so nothing happens.
			return;
		}
		const changed = apply(data);
		if (changed) {
			mutated = true;
		}
		// Always delete legacy file once it was readable & processed.
		safeUnlink(filePath);
		migrated.push(filename);
	};

	// codebase.json
	tryMigrate<Record<string, unknown>>(LEGACY_FILES.codebase, data => {
		const next = {...(settings.codebase || {})};
		let touched = false;
		const copyTopLevel = (key: keyof typeof next, value: unknown) => {
			if (value !== undefined && (next as any)[key] === undefined) {
				(next as any)[key] = value;
				touched = true;
			}
		};
		copyTopLevel('enabled', data['enabled']);
		copyTopLevel('enableAgentReview', data['enableAgentReview']);
		copyTopLevel('enableReranking', data['enableReranking']);
		copyTopLevel('batch', data['batch']);
		copyTopLevel('chunking', data['chunking']);
		copyTopLevel('embedding', data['embedding']);
		copyTopLevel('reranking', data['reranking']);
		if (touched) {
			settings.codebase = next;
		}
		return touched;
	});

	// connection.json — project scope only (global never used it).
	if (scope === 'project') {
		tryMigrate<UnifiedSettings['connection']>(LEGACY_FILES.connection, data => {
			if (
				data &&
				typeof data === 'object' &&
				settings.connection === undefined
			) {
				settings.connection = data;
				return true;
			}
			return false;
		});
	}

	// working-dirs.json
	tryMigrate<{directories?: unknown}>(LEGACY_FILES.workingDirs, data => {
		if (
			Array.isArray(data.directories) &&
			settings.workingDirectories === undefined
		) {
			type WD = NonNullable<UnifiedSettings['workingDirectories']>[number];
			const isWorkingDirectory = (d: unknown): d is WD =>
				!!d &&
				typeof d === 'object' &&
				typeof (d as Record<string, unknown>)['path'] === 'string' &&
				typeof (d as Record<string, unknown>)['isDefault'] === 'boolean' &&
				typeof (d as Record<string, unknown>)['addedAt'] === 'number';
			settings.workingDirectories = data.directories.filter(isWorkingDirectory);
			return true;
		}

		return false;
	});

	// disabled-builtin-tools.json
	tryMigrate<{disabledServices?: unknown}>(
		LEGACY_FILES.disabledBuiltin,
		data => {
			if (
				Array.isArray(data.disabledServices) &&
				settings.disabledBuiltInServices === undefined
			) {
				settings.disabledBuiltInServices = data.disabledServices.filter(
					(v): v is string => typeof v === 'string',
				);
				return true;
			}
			return false;
		},
	);

	// disabled-mcp-tools.json
	tryMigrate<{disabledTools?: unknown}>(LEGACY_FILES.disabledMcp, data => {
		if (
			Array.isArray(data.disabledTools) &&
			settings.disabledMCPTools === undefined
		) {
			settings.disabledMCPTools = data.disabledTools.filter(
				(v): v is string => typeof v === 'string',
			);
			return true;
		}
		return false;
	});

	// opt-in-mcp-tools.json
	tryMigrate<{enabledTools?: unknown}>(LEGACY_FILES.optInMcp, data => {
		if (
			Array.isArray(data.enabledTools) &&
			settings.optInMCPTools === undefined
		) {
			settings.optInMCPTools = data.enabledTools.filter(
				(v): v is string => typeof v === 'string',
			);
			return true;
		}
		return false;
	});

	// disabled-skills.json
	tryMigrate<{disabledSkills?: unknown}>(LEGACY_FILES.disabledSkills, data => {
		if (
			Array.isArray(data.disabledSkills) &&
			settings.disabledSkills === undefined
		) {
			settings.disabledSkills = data.disabledSkills.filter(
				(v): v is string => typeof v === 'string',
			);
			return true;
		}
		return false;
	});

	// mcp-config.json
	tryMigrate<{mcpServers?: unknown}>(LEGACY_FILES.mcpConfig, data => {
		if (
			data.mcpServers &&
			typeof data.mcpServers === 'object' &&
			!Array.isArray(data.mcpServers) &&
			settings.mcpServers === undefined
		) {
			settings.mcpServers = data.mcpServers as Record<string, unknown>;
			return true;
		}
		return false;
	});

	// role.json
	tryMigrate<{activeRoleId?: unknown; overrideRoleIds?: unknown}>(
		LEGACY_FILES.role,
		data => {
			if (settings.role !== undefined) return false;
			const next: NonNullable<UnifiedSettings['role']> = {};
			if (typeof data.activeRoleId === 'string') {
				next.activeRoleId = data.activeRoleId;
			}
			if (Array.isArray(data.overrideRoleIds)) {
				next.overrideRoleIds = data.overrideRoleIds.filter(
					(v): v is string => typeof v === 'string',
				);
			}
			if (Object.keys(next).length === 0) return false;
			settings.role = next;
			return true;
		},
	);

	// sensitive-commands.json
	tryMigrate<{commands?: unknown}>(LEGACY_FILES.sensitive, data => {
		if (
			Array.isArray(data.commands) &&
			settings.sensitiveCommands === undefined
		) {
			type SC = NonNullable<UnifiedSettings['sensitiveCommands']>[number];
			const isSC = (c: unknown): c is SC =>
				!!c &&
				typeof c === 'object' &&
				typeof (c as Record<string, unknown>)['id'] === 'string' &&
				typeof (c as Record<string, unknown>)['pattern'] === 'string';
			settings.sensitiveCommands = data.commands.filter(isSC);
			return true;
		}
		return false;
	});


	if (settings.goal?.defaultTokenBudgetM === undefined) {
		settings.goal = {
			...(settings.goal || {}),
			defaultTokenBudgetM: 2,
		};
		mutated = true;
	}

	if (mutated) {
		writeSettings(scope, settings, workingDirectory);
	}

	return {
		scope,
		migratedFiles: migrated,
		settings,
	};
}

let migrationDone = false;

/**
 * Run legacy migration once per process. Safe to call multiple times.
 *
 * @returns Per-scope summaries (useful for debug/logging) or `null` if a scope
 *   doesn't have a `.snow` directory at all.
 */
export function runLegacyConfigMigration(workingDirectory?: string): {
	project: MigrationResult | null;
	global: MigrationResult | null;
} {
	if (migrationDone) {
		return {project: null, global: null};
	}
	migrationDone = true;

	let project: MigrationResult | null = null;
	let global: MigrationResult | null = null;
	try {
		project = migrateScope('project', workingDirectory);
	} catch {
		project = null;
	}
	try {
		global = migrateScope('global');
	} catch {
		global = null;
	}
	return {project, global};
}

/**
 * Test-only helper to reset the one-shot guard.
 *
 * @internal
 */
export function __resetLegacyConfigMigrationForTesting(): void {
	migrationDone = false;
}
