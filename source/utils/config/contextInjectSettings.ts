/**
 * Read/write helpers for UnifiedSettings.contextInject.enabled.
 * Used by slash command and session-command (agentic) plane.
 */

import {
	readMergedSettings,
	readSettings,
	updateSettings,
	type SettingsScope,
} from './unifiedSettings.js';
import {clearContextInjectCache} from '../../prompt/contextInject/cache.js';
import {DEFAULT_CONTEXT_INJECT} from '../../prompt/contextInject/defaults.js';

/** Effective enabled flag after project > global merge (default false). */
export function getContextInjectEnabled(workingDirectory?: string): boolean {
	try {
		const merged = readMergedSettings(workingDirectory);
		const value = merged.contextInject?.enabled;
		return typeof value === 'boolean'
			? value
			: DEFAULT_CONTEXT_INJECT.enabled;
	} catch {
		return DEFAULT_CONTEXT_INJECT.enabled;
	}
}

/**
 * Persist enabled flag. Project scope by default (cwd `.snow/settings.json`).
 * Clears inject cache so the next message re-resolves config.
 */
export function setContextInjectEnabled(
	enabled: boolean,
	scope: SettingsScope = 'project',
	workingDirectory?: string,
): void {
	updateSettings(
		scope,
		settings => {
			settings.contextInject = {
				...(settings.contextInject ?? {}),
				enabled,
			};
		},
		workingDirectory,
	);
	clearContextInjectCache();
}

/** Where the effective value comes from (for status UX). */
export function getContextInjectEnabledSource(
	workingDirectory?: string,
): 'project' | 'global' | 'default' {
	try {
		const project = readSettings('project', workingDirectory);
		if (typeof project.contextInject?.enabled === 'boolean') {
			return 'project';
		}
		const global = readSettings('global');
		if (typeof global.contextInject?.enabled === 'boolean') {
			return 'global';
		}
	} catch {
		// ignore
	}
	return 'default';
}
