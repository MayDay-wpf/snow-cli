/**
 * Plan path helpers: date folders, active discovery, and write-path normalization.
 *
 * Layout:
 *   .snow/plan/
 *     YYYY-MM-DD/          # active plans (create day)
 *       task.md
 *     archive/
 *       YYYY-MM-DD/        # completed archives (archive day)
 *         task.md
 *     legacy-top-level.md  # still discovered as active
 */

import fs from 'node:fs/promises';
import type {Dirent} from 'node:fs';
import path from 'node:path';
import {
	getCachedActivePlanPaths,
	invalidateActivePlanPathsCache,
	setCachedActivePlanPaths,
} from './planCache.js';
import {measurePlanOperation} from './plan-metrics.js';

/** Re-export so callers can drop the short-lived active path list. */
export {invalidateActivePlanPathsCache};

const DATE_FOLDER_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dateFolderName(date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function isPlanDateFolderName(name: string): boolean {
	return DATE_FOLDER_RE.test(name);
}

export function getPlanDir(cwd: string): string {
	return path.resolve(cwd, '.snow', 'plan');
}

export function getPlanDateDir(cwd: string, date: Date = new Date()): string {
	return path.join(getPlanDir(cwd), dateFolderName(date));
}

/**
 * Absolute paths of active plan markdown files:
 * - top-level `.snow/plan/*.md` (legacy)
 * - `.snow/plan/YYYY-MM-DD/*.md`
 * Skips `archive/` (case-insensitive) and non-date directories.
 */
async function readPlanDirMtimeMs(planDir: string): Promise<number> {
	try {
		const stat = await fs.stat(planDir);
		return stat.mtimeMs;
	} catch {
		return -1;
	}
}

export async function listActivePlanMarkdownPaths(
	cwd: string,
): Promise<string[]> {
	return measurePlanOperation(
		{operation: 'discover', detail: 'active_paths'},
		async timing => {
			const planDir = getPlanDir(cwd);
			const planDirMtimeMs = await readPlanDirMtimeMs(planDir);
			const cached = getCachedActivePlanPaths(cwd);
			if (cached && cached.planDirMtimeMs === planDirMtimeMs) {
				timing.cache = 'hit';
				return [...cached.paths];
			}
			timing.cache = 'miss';

			let entries: Dirent[];
			try {
				entries = await fs.readdir(planDir, {withFileTypes: true});
			} catch {
				const empty: string[] = [];
				setCachedActivePlanPaths(cwd, empty, 2000, -1);
				return empty;
			}

			const results: string[] = [];
			for (const entry of entries) {
				if (entry.name.toLowerCase() === 'archive') {
					continue;
				}

				if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
					results.push(path.join(planDir, entry.name));
					continue;
				}

				if (entry.isDirectory() && isPlanDateFolderName(entry.name)) {
					const dateDir = path.join(planDir, entry.name);
					try {
						const nested = await fs.readdir(dateDir, {withFileTypes: true});
						for (const child of nested) {
							if (child.isFile() && child.name.toLowerCase().endsWith('.md')) {
								results.push(path.join(dateDir, child.name));
							}
						}
					} catch {
						// Unreadable date dir: skip
					}
				}
			}

			setCachedActivePlanPaths(cwd, results, 2000, planDirMtimeMs);
			return results;
		},
	);
}

function isPathInside(parent: string, child: string): boolean {
	const rel = path.relative(path.normalize(parent), path.normalize(child));
	return (
		rel === '' ||
		(!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
	);
}

/**
 * Redirect top-level `.snow/plan/foo.md` writes into today's date folder.
 * Leaves non-plan paths, archive paths, existing date-folder paths, and
 * non-md plan-root files unchanged. Preserves relative vs absolute input style.
 */
export function normalizePlanWritePath(
	filePath: string,
	cwd: string,
	now: Date = new Date(),
): string {
	const planDir = getPlanDir(cwd);
	const inputWasAbsolute = path.isAbsolute(filePath);
	const absInput = path.normalize(
		inputWasAbsolute ? filePath : path.resolve(cwd, filePath),
	);

	if (!isPathInside(planDir, absInput)) {
		return filePath;
	}

	const rel = path.relative(planDir, absInput);
	const parts = rel.split(path.sep).filter(part => part.length > 0);
	if (parts.length === 0) {
		return filePath;
	}

	if (parts[0]!.toLowerCase() === 'archive') {
		return filePath;
	}

	if (isPlanDateFolderName(parts[0]!)) {
		return filePath;
	}

	// Direct child of plan root: only redirect markdown plans
	if (parts.length === 1 && parts[0]!.toLowerCase().endsWith('.md')) {
		const redirectedAbs = path.join(planDir, dateFolderName(now), parts[0]!);
		if (inputWasAbsolute) {
			return redirectedAbs;
		}

		const relativeOut = path.relative(path.resolve(cwd), redirectedAbs);
		// path.relative can yield '' for cwd itself; keep a usable relative form
		return relativeOut.length > 0 ? relativeOut : redirectedAbs;
	}

	return filePath;
}
