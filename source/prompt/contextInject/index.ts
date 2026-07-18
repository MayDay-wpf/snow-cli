/**
 * Minimal AGENTS.md-first context inject (Codex/Claude-style).
 *
 * Loads:
 *   1. ~/.snow/AGENTS.md (global)
 *   2. AGENTS.md chain from git root → cwd (one file per directory)
 *
 * ROLE.md is NOT loaded here — remains via getSystemPromptWithRole / override.
 */

import fs from 'node:fs';
import path from 'node:path';
import {getActiveRoleContentFingerprints} from '../shared/promptHelpers.js';
import {applyBudget} from './budget.js';
import {
	buildCacheKey,
	clearContextInjectCache,
	fingerprintConfig,
	getCachedInjectResult,
	setCachedInjectResult,
} from './cache.js';
import {applyProfile, resolveContextInjectConfig} from './defaults.js';
import {dedupeLoadedSources} from './dedupe.js';
import {discoverContextSources} from './discoverSources.js';
import {loadContextSources} from './loadSources.js';
import {
	appendInjectedRules,
	prependAgentsContext as prependAgentsContextHelper,
	renderInjectedRulesSection,
} from './render.js';
import type {
	ContextInjectProfile,
	DiscoveredSource,
	InjectRenderResult,
	InjectSourceReport,
	LoadedSource,
} from './types.js';

export type {
	ContextInjectProfile,
	ContextInjectSettings,
	InjectRenderResult,
	InjectSourceReport,
} from './types.js';

export {appendInjectedRules, clearContextInjectCache};
export {prependAgentsContext as prependAgentsContextFromSection} from './render.js';
export {summarizeAgentsMd} from './loadSources.js';
export {isExcluded, discoverContextSources} from './discoverSources.js';
export {applyBudget} from './budget.js';
export {dedupeLoadedSources} from './dedupe.js';
export {renderInjectedRulesSection} from './render.js';
export {resolveContextInjectConfig, applyProfile} from './defaults.js';

function emptyResult(): InjectRenderResult {
	return {
		section: '',
		totalChars: 0,
		truncated: false,
		sources: [],
	};
}

function collectMtimes(sources: DiscoveredSource[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const source of sources) {
		try {
			map.set(source.absPath, fs.statSync(source.absPath).mtimeMs);
		} catch {
			// ignore
		}
	}
	return map;
}

function writeBreadcrumb(cwd: string, text: string): string | undefined {
	try {
		const rel = path.join('.snow', 'log', 'injected-rules.txt');
		const abs = path.join(cwd, rel);
		fs.mkdirSync(path.dirname(abs), {recursive: true});
		fs.writeFileSync(abs, text, 'utf-8');
		return rel.split(path.sep).join('/');
	} catch {
		return undefined;
	}
}

function shrinkKeptToBudget(
	kept: LoadedSource[],
	budgetChars: number,
	meta: {truncated: boolean; breadcrumbPath?: string},
): {section: string; kept: LoadedSource[]; truncated: boolean} {
	let current = [...kept];
	let truncated = meta.truncated;
	let section = renderInjectedRulesSection(current, {
		truncated,
		breadcrumbPath: meta.breadcrumbPath,
	});

	// Drop later (more nested) files first if over budget
	while (section.length > budgetChars && current.length > 0) {
		current = current.slice(0, -1);
		truncated = true;
		section = renderInjectedRulesSection(current, {
			truncated: true,
			breadcrumbPath: meta.breadcrumbPath,
		});
	}

	if (section.length > budgetChars) {
		const keep = Math.max(0, budgetChars - 20);
		section = section.slice(0, keep) + '\n...(truncated)\n';
		truncated = true;
	}

	return {section, kept: current, truncated};
}

function buildReports(
	loaded: LoadedSource[],
	kept: LoadedSource[],
): InjectSourceReport[] {
	const keptPaths = new Set(kept.map(s => s.absPath));
	return loaded.map(source => {
		const included = keptPaths.has(source.absPath);
		const keptSource = kept.find(s => s.absPath === source.absPath);
		return {
			kind: source.kind,
			relLabel: source.relLabel,
			chars: included ? keptSource?.chars ?? source.chars : source.chars,
			truncated: included ? Boolean(keptSource?.truncated) : source.truncated,
			included,
		};
	});
}

export function getInjectedRulesDetails(options?: {
	cwd?: string;
	profile?: ContextInjectProfile;
	writeBreadcrumb?: boolean;
}): InjectRenderResult {
	try {
		const cwd = options?.cwd ?? process.cwd();
		const baseConfig = resolveContextInjectConfig(cwd);
		const profile = options?.profile ?? baseConfig.profile ?? 'full';

		if (!baseConfig.enabled || profile === 'off') {
			return emptyResult();
		}

		const config = applyProfile(baseConfig, profile);
		if (!config.enabled) {
			return emptyResult();
		}

		const budget = config.budgetChars;
		const fp = fingerprintConfig({
			profile,
			budget,
			fallbackFilenames: config.fallbackFilenames,
			primaryFilename: config.primaryFilename,
		});
		const cacheKey = buildCacheKey(cwd, profile, fp);

		const discovered = discoverContextSources({cwd, config});
		const mtimes = collectMtimes(discovered);
		const cached = getCachedInjectResult(cacheKey, mtimes);
		if (cached) return cached;

		const loadedRaw = loadContextSources(discovered, config);
		// Dedupe identical AGENTS bodies; also drop content already in ROLE.
		let roleFingerprints: Set<string> | undefined;
		try {
			roleFingerprints = getActiveRoleContentFingerprints();
		} catch {
			roleFingerprints = undefined;
		}
		const {kept: loaded} = dedupeLoadedSources(loadedRaw, roleFingerprints);
		if (!loaded.length) {
			const empty = emptyResult();
			setCachedInjectResult(cacheKey, empty, mtimes);
			return empty;
		}

		const bodyBudget = Math.max(200, Math.floor(budget * 0.92));
		const {kept: initialKept, truncated: bodyTruncated} = applyBudget(
			loaded,
			bodyBudget,
		);

		const shouldWrite =
			typeof options?.writeBreadcrumb === 'boolean'
				? options.writeBreadcrumb
				: config.writeBreadcrumb;

		const draftSection = renderInjectedRulesSection(initialKept, {
			truncated: bodyTruncated,
		});

		let breadcrumbPath: string | undefined;
		if (shouldWrite && draftSection) {
			breadcrumbPath = writeBreadcrumb(cwd, draftSection);
		}

		const shrunk = shrinkKeptToBudget(initialKept, budget, {
			truncated: bodyTruncated,
			breadcrumbPath,
		});

		const section = renderInjectedRulesSection(shrunk.kept, {
			truncated: shrunk.truncated,
			breadcrumbPath,
		});

		if (shouldWrite && section && !breadcrumbPath) {
			breadcrumbPath = writeBreadcrumb(cwd, section);
		}

		const result: InjectRenderResult = {
			section,
			totalChars: section.length,
			truncated: shrunk.truncated,
			sources: buildReports(loaded, shrunk.kept),
			...(breadcrumbPath ? {breadcrumbPath} : {}),
		};

		setCachedInjectResult(cacheKey, result, mtimes);
		return result;
	} catch {
		return emptyResult();
	}
}

export function getInjectedRulesSection(options?: {
	cwd?: string;
	profile?: ContextInjectProfile;
	writeBreadcrumb?: boolean;
}): string {
	return getInjectedRulesDetails(options).section;
}

/**
 * Prepend global+project AGENTS.md chain onto a model-bound user message.
 * Does NOT go through hooks — call after/beside hook inject as a separate step.
 * UI should keep the original typed text (typedMessage).
 */
export function prependAgentsContext(
	message: string,
	options?: {
		cwd?: string;
		profile?: ContextInjectProfile;
		writeBreadcrumb?: boolean;
	},
): string {
	try {
		const section = getInjectedRulesSection(options);
		return prependAgentsContextHelper(message, section);
	} catch {
		return message;
	}
}
