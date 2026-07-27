/**
 * Process-local plan document + active-path caches.
 *
 * PlanDoc entries are validated against mtimeMs + size from fs.stat so
 * external edits (or same-process writes that forget to invalidate) still
 * re-parse correctly.
 *
 * Active path lists use a short TTL and are also invalidated when the
 * `.snow/plan` directory mtime changes (covers raw create/delete without
 * going through mutate/archive helpers).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {PlanDoc} from './planDocument.js';

type PlanDocCacheEntry = {
	doc: PlanDoc;
	mtimeMs: number;
	size: number;
};

type ActivePathsCacheEntry = {
	paths: string[];
	expiresAt: number;
	/** mtimeMs of `<cwd>/.snow/plan` at cache time; -1 when dir was missing. */
	planDirMtimeMs: number;
};

const planDocCache = new Map<string, PlanDocCacheEntry>();
const activePathsCache = new Map<string, ActivePathsCacheEntry>();

function normalizeCachePath(filePath: string): string {
	return path.resolve(filePath);
}

function normalizeCwd(cwd: string): string {
	return path.resolve(cwd);
}

/**
 * Best-effort: walk from an absolute plan file path up to the project cwd
 * that owns `.snow/plan`.
 */
export function resolveCwdFromPlanPath(filePath: string): string | undefined {
	const abs = path.normalize(path.resolve(filePath));
	const marker = `${path.sep}.snow${path.sep}plan`;
	const lower = abs.toLowerCase();
	const markerLower = marker.toLowerCase();
	const idx = lower.lastIndexOf(markerLower);
	if (idx === -1) {
		return undefined;
	}
	const after = abs.slice(idx + marker.length);
	if (after.length > 0 && after[0] !== path.sep) {
		return undefined;
	}
	const cwd = abs.slice(0, idx);
	return cwd.length > 0 ? cwd : path.parse(abs).root;
}

/**
 * Return a cached PlanDoc when the on-disk mtimeMs + size still match.
 * Misses (or stale / unreadable paths) return null.
 */
export async function getCachedPlanDoc(
	filePath: string,
): Promise<PlanDoc | null> {
	const key = normalizeCachePath(filePath);
	const entry = planDocCache.get(key);
	if (!entry) {
		return null;
	}

	try {
		const stat = await fs.stat(key);
		const sizeMismatch = entry.size >= 0 && stat.size !== entry.size;
		if (stat.mtimeMs !== entry.mtimeMs || sizeMismatch) {
			planDocCache.delete(key);
			return null;
		}
		return entry.doc;
	} catch {
		planDocCache.delete(key);
		return null;
	}
}

/**
 * Store a PlanDoc keyed by its absolute filePath.
 * Prefer an explicit size from fs.stat; when omitted, only mtimeMs is enforced.
 */
export function setCachedPlanDoc(doc: PlanDoc, size?: number): void {
	const key = normalizeCachePath(doc.filePath);
	const resolvedSize =
		typeof size === 'number' && Number.isFinite(size) ? size : -1;
	planDocCache.set(key, {
		doc,
		mtimeMs: doc.mtimeMs,
		size: resolvedSize,
	});
}

/** Invalidate one plan path, or the entire PlanDoc cache when omitted. */
export function invalidatePlanCache(filePath?: string): void {
	if (filePath === undefined) {
		planDocCache.clear();
		return;
	}
	planDocCache.delete(normalizeCachePath(filePath));
}

export function getCachedActivePlanPaths(
	cwd: string,
): {paths: string[]; expiresAt: number; planDirMtimeMs: number} | null {
	const key = normalizeCwd(cwd);
	const entry = activePathsCache.get(key);
	if (!entry) {
		return null;
	}
	if (Date.now() >= entry.expiresAt) {
		activePathsCache.delete(key);
		return null;
	}
	return {
		paths: entry.paths,
		expiresAt: entry.expiresAt,
		planDirMtimeMs: entry.planDirMtimeMs,
	};
}

export function setCachedActivePlanPaths(
	cwd: string,
	paths: string[],
	ttlMs = 2000,
	planDirMtimeMs = -1,
): void {
	const key = normalizeCwd(cwd);
	const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 2000;
	activePathsCache.set(key, {
		paths: [...paths],
		expiresAt: Date.now() + ttl,
		planDirMtimeMs,
	});
}

/** Invalidate one cwd's active path list, or all when omitted. */
export function invalidateActivePlanPathsCache(cwd?: string): void {
	if (cwd === undefined) {
		activePathsCache.clear();
		return;
	}
	activePathsCache.delete(normalizeCwd(cwd));
}

/**
 * Invalidate active path cache for the project that owns this plan file.
 * Falls back to clearing all when the cwd cannot be derived.
 */
export function invalidateActivePlanPathsCacheForPlanPath(
	planPath: string,
): void {
	const cwd = resolveCwdFromPlanPath(planPath);
	if (cwd === undefined) {
		invalidateActivePlanPathsCache();
		return;
	}
	invalidateActivePlanPathsCache(cwd);
}
