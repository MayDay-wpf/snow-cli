/**
 * Plan archive lifecycle: completed plans move to `.snow/plan/archive/YYYY-MM-DD/`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	getPlanWriteOptions,
	mutatePlanDocument,
	parsePlanDocument,
	writePlanFrontmatter,
	type PlanDoc,
	type PlanStatus,
} from './planDocument.js';
import {
	dateFolderName,
	getPlanDir,
	listActivePlanMarkdownPaths,
} from './planPaths.js';

async function moveFile(from: string, to: string): Promise<void> {
	try {
		await fs.rename(from, to);
	} catch {
		// Windows cross-device / locked-file fallback
		await fs.copyFile(from, to);
		await fs.unlink(from);
	}
}

/**
 * Mark a plan as archived/abandoned and move it into the dated archive folder.
 * Returns the new file path.
 */
export async function archivePlan(
	doc: PlanDoc,
	cwd: string,
	finalStatus: 'archived' | 'abandoned' = 'archived',
): Promise<string> {
	await writePlanFrontmatter(
		doc.filePath,
		{status: finalStatus},
		getPlanWriteOptions(doc),
	);

	const archiveDir = path.join(getPlanDir(cwd), 'archive', dateFolderName());
	await fs.mkdir(archiveDir, {recursive: true});

	const base = path.basename(doc.filePath);
	const ext = path.extname(base);
	const stem = base.slice(0, base.length - ext.length);
	let target = path.join(archiveDir, base);
	for (let n = 2; ; n++) {
		try {
			await fs.access(target);
			target = path.join(archiveDir, `${stem}-${n}${ext}`);
		} catch {
			break;
		}
	}

	await moveFile(doc.filePath, target);
	return target;
}

/**
 * Archive every completed plan left in `.snow/plan/`. Best-effort sweep used
 * as a fallback when plan mode is turned off. Returns archived target paths.
 */
export async function sweepCompletedPlans(cwd: string): Promise<string[]> {
	const result = await sweepPlans(cwd, {
		statuses: ['completed'],
		scope: 'all',
	});
	return result.archived.map(item => item.target);
}

export type SweepPlansOptions = {
	/** Status filter. Default: draft + completed + abandoned (never executing). */
	statuses?: PlanStatus[];
	/** When true, allow `executing` if present in statuses. Requires reason. */
	includeExecuting?: boolean;
	/** Optional absolute/relative path whitelist. */
	planPaths?: string[];
	/** If true, only list matches without moving files. */
	dryRun?: boolean;
	/** Default session scope avoids archiving another session's plans. */
	scope?: 'session' | 'all';
	/** Current session id used when scope=session. Untagged plans are excluded. */
	sessionId?: string | null;
	/** Reason recorded for non-completed batch archives. */
	reason?: string;
};

export type SweepPlansItem = {
	source: string;
	target: string;
	status: PlanStatus;
	finalStatus: 'archived' | 'abandoned';
};

export type SweepPlansResult = {
	archived: SweepPlansItem[];
	skipped: Array<{source: string; reason: string}>;
	errors: Array<{source: string; error: string}>;
	dryRun: boolean;
};

const DEFAULT_BATCH_STATUSES: PlanStatus[] = [
	'draft',
	'completed',
	'abandoned',
];

function normalizeStatuses(input?: PlanStatus[]): PlanStatus[] {
	if (!input || input.length === 0) {
		return [...DEFAULT_BATCH_STATUSES];
	}
	const allowed = new Set<PlanStatus>([
		'draft',
		'approved',
		'executing',
		'completed',
		'archived',
		'abandoned',
	]);
	const out: PlanStatus[] = [];
	for (const s of input) {
		if (allowed.has(s) && !out.includes(s)) {
			out.push(s);
		}
	}
	return out.length > 0 ? out : [...DEFAULT_BATCH_STATUSES];
}

function resolveWhitelist(
	cwd: string,
	planPaths?: string[],
): Set<string> | null {
	if (!planPaths || planPaths.length === 0) {
		return null;
	}
	const set = new Set<string>();
	for (const p of planPaths) {
		if (typeof p !== 'string' || !p.trim()) continue;
		const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p);
		set.add(abs);
	}
	return set.size > 0 ? set : null;
}

async function appendBatchNote(doc: PlanDoc, reason: string): Promise<void> {
	await mutatePlanDocument(
		doc.filePath,
		({content}) => {
			const body = content.endsWith('\n') ? content : `${content}\n`;
			return {
				content:
					body +
					`\n> Batch archived: ${reason} (${new Date()
						.toISOString()
						.slice(0, 10)})\n`,
			};
		},
		getPlanWriteOptions(doc),
	);
}

/**
 * Batch-archive active plans matching status/path filters.
 * Default statuses exclude `executing` for safety.
 */
export async function sweepPlans(
	cwd: string,
	options: SweepPlansOptions = {},
): Promise<SweepPlansResult> {
	const dryRun = Boolean(options.dryRun);
	const includeExecuting = Boolean(options.includeExecuting);
	const scope = options.scope ?? 'session';
	const statuses = normalizeStatuses(options.statuses);
	const statusSet = new Set(statuses);

	if (statusSet.has('executing') && !includeExecuting) {
		statusSet.delete('executing');
	}

	const whitelist = resolveWhitelist(cwd, options.planPaths);
	const planPaths = await listActivePlanMarkdownPaths(cwd);
	const archived: SweepPlansItem[] = [];
	const skipped: Array<{source: string; reason: string}> = [];
	const errors: Array<{source: string; error: string}> = [];

	for (const planPath of planPaths) {
		const normalized = path.normalize(planPath);
		if (whitelist && !whitelist.has(normalized)) {
			skipped.push({source: planPath, reason: 'not in plan_paths whitelist'});
			continue;
		}

		try {
			const doc = await parsePlanDocument(planPath);
			const status = doc.frontmatter.status;

			if (
				scope === 'session' &&
				doc.frontmatter.session !== (options.sessionId || '')
			) {
				skipped.push({
					source: planPath,
					reason: `session=${
						doc.frontmatter.session || '(none)'
					} outside current session scope`,
				});
				continue;
			}

			if (status === 'executing' && !includeExecuting) {
				skipped.push({
					source: planPath,
					reason: 'executing protected (pass include_executing=true)',
				});
				continue;
			}

			if (!statusSet.has(status)) {
				skipped.push({
					source: planPath,
					reason: `status=${status} not in filter`,
				});
				continue;
			}

			const finalStatus: 'archived' | 'abandoned' =
				status === 'completed' ? 'archived' : 'abandoned';

			if (dryRun) {
				archived.push({
					source: planPath,
					target: '(dry-run)',
					status,
					finalStatus,
				});
				continue;
			}

			if (finalStatus === 'abandoned') {
				const reason =
					options.reason?.trim() ||
					'batch archive via plan-manage archive_batch';
				await appendBatchNote(doc, reason);
			}

			const refreshed = await parsePlanDocument(planPath);
			const target = await archivePlan(refreshed, cwd, finalStatus);
			archived.push({
				source: planPath,
				target,
				status,
				finalStatus,
			});
		} catch (error) {
			errors.push({
				source: planPath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {archived, skipped, errors, dryRun};
}
