/**
 * Plan archive lifecycle: completed plans move to `.snow/plan/archive/YYYY-MM-DD/`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	getPlanDir,
	parsePlanDocument,
	writePlanFrontmatter,
	type PlanDoc,
} from './planDocument.js';

function dateFolderName(date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

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
 * Mark a plan as archived and move it into the dated archive folder.
 * Returns the new file path.
 */
export async function archivePlan(doc: PlanDoc, cwd: string): Promise<string> {
	await writePlanFrontmatter(doc.filePath, {status: 'archived'});

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
	const planDir = getPlanDir(cwd);
	let entries: string[];
	try {
		entries = await fs.readdir(planDir);
	} catch {
		return [];
	}

	const archived: string[] = [];
	for (const entry of entries) {
		if (!entry.toLowerCase().endsWith('.md')) {
			continue;
		}
		try {
			const doc = await parsePlanDocument(path.join(planDir, entry));
			if (doc.frontmatter.status === 'completed') {
				archived.push(await archivePlan(doc, cwd));
			}
		} catch {
			// Skip unreadable files
		}
	}
	return archived;
}
