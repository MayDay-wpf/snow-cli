import {readMergedSettings} from '../../utils/config/unifiedSettings.js';
import type {
	ContextInjectProfile,
	ContextInjectSettings,
	ResolvedContextInjectConfig,
} from './types.js';

/** Codex-like defaults: one AGENTS chain + hard size cap. */
export const DEFAULT_CONTEXT_INJECT = {
	enabled: false,
	budgetChars: 32_000,
	profile: 'full' as ContextInjectProfile,
	primaryFilename: 'AGENTS.md',
	// Optional Claude-compatible name if AGENTS.md missing in a directory.
	fallbackFilenames: ['CLAUDE.md'] as string[],
	writeBreadcrumb: false,
	compactBudgetChars: 8_000,
	perFileMax: 16_000,
} as const;

function mergeBool(value: boolean | undefined, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function mergeNumber(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

function mergeStringArray(
	value: string[] | undefined,
	fallback: string[],
): string[] {
	if (!Array.isArray(value)) {
		return [...fallback];
	}
	return value
		.filter(item => typeof item === 'string' && item.trim())
		.map(s => s.trim());
}

export function resolveContextInjectConfig(
	cwd: string = process.cwd(),
): ResolvedContextInjectConfig {
	let user: ContextInjectSettings = {};
	try {
		const merged = readMergedSettings(cwd);
		user = merged.contextInject ?? {};
	} catch {
		user = {};
	}

	const profile =
		user.profile === 'full' ||
		user.profile === 'compact' ||
		user.profile === 'off'
			? user.profile
			: DEFAULT_CONTEXT_INJECT.profile;

	return {
		enabled: mergeBool(user.enabled, DEFAULT_CONTEXT_INJECT.enabled),
		budgetChars: mergeNumber(
			user.budgetChars,
			DEFAULT_CONTEXT_INJECT.budgetChars,
		),
		profile,
		fallbackFilenames: mergeStringArray(user.fallbackFilenames, [
			...DEFAULT_CONTEXT_INJECT.fallbackFilenames,
		]),
		writeBreadcrumb: mergeBool(
			user.writeBreadcrumb,
			DEFAULT_CONTEXT_INJECT.writeBreadcrumb,
		),
		primaryFilename: DEFAULT_CONTEXT_INJECT.primaryFilename,
		compactBudgetChars: DEFAULT_CONTEXT_INJECT.compactBudgetChars,
		perFileMax: DEFAULT_CONTEXT_INJECT.perFileMax,
	};
}

export function applyProfile(
	config: ResolvedContextInjectConfig,
	profile: ContextInjectProfile,
): ResolvedContextInjectConfig {
	if (profile === 'off') {
		return {...config, profile: 'off', enabled: false};
	}
	if (profile === 'compact') {
		return {
			...config,
			profile: 'compact',
			budgetChars: Math.min(config.budgetChars, config.compactBudgetChars),
		};
	}
	return {...config, profile: 'full'};
}
