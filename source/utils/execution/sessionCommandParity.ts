/**
 * Lightweight dual-path parity helpers for issue #190 hardening.
 * Plane allowlist is source of truth for headless; TUI slash remains UI-facing.
 */

import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {listSessionCommands} from './sessionCommandRegistry.js';

/** Top-level names expected to exist both in plane allowlist and TUI slash surface. */
export const PLANE_TUI_OVERLAP_COMMANDS: readonly string[] = [
	'buddy',
	'simple',
	'agents-inject',
	'display',
	'tool-display',
	'think-display',
	'subagent-display',
	'yolo',
	'plan',
	'tool-search',
	'team',
	'ultra-todo',
	'vulnerability-hunting',
	'mcp',
	'profiles',
	'codebase',
	'reindex',
	'compact',
	'export',
	'permissions',
	'session',
	'goal',
	'loop',
	'skills',
	'help',
	'theme',
	'statusline',
	'ide',
	'telemetry',
	'usage',
	'auto-format',
	'image-compress',
	'hybrid-compress',
	'speedometer',
	'subagent-depth',
] as const;

/** Critical TUI command modules that should remain present while dual-path exists. */
export const CRITICAL_TUI_COMMAND_MODULES: readonly string[] = [
	'buddy.ts',
	'yolo.ts',
	'mcp.ts',
	'simple.ts',
	'agentsInject.ts',
	'toolDisplay.ts',
	'subagentDisplay.ts',
	'display.ts',
	'compact.ts',
	'export.ts',
	'goal.ts',
	'loop.ts',
	'skills.ts',
	'permissions.ts',
	'ide.ts',
] as const;

export function getPlaneTopLevelCommands(): string[] {
	const set = new Set(listSessionCommands().map(item => item.command));
	return [...set].sort();
}

export function assertCriticalOverlapPresent(): {
	ok: boolean;
	missingFromPlane: string[];
	missingTuiModules: string[];
} {
	const plane = new Set(getPlaneTopLevelCommands());
	const missingFromPlane = PLANE_TUI_OVERLAP_COMMANDS.filter(
		name => !plane.has(name),
	);

	const here = dirname(fileURLToPath(import.meta.url));
	const commandsDir = join(here, '../commands');
	const missingTuiModules = CRITICAL_TUI_COMMAND_MODULES.filter(
		file => !existsSync(join(commandsDir, file)),
	);

	return {
		ok: missingFromPlane.length === 0 && missingTuiModules.length === 0,
		missingFromPlane,
		missingTuiModules,
	};
}
