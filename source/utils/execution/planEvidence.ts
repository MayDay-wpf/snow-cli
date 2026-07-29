import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import type {PlanAcceptanceDetail} from './planAcceptance.js';
import {replacePlanFileAtomically} from './plan-persistence.js';

export type PlanAcceptanceEvidenceEntry = {
	id?: string;
	phase: number;
	status: 'passed' | 'failed';
	startedAt: string;
	completedAt: string;
	durationMs: number;
	phaseChecks: PlanAcceptanceDetail[];
	globalAcceptance: PlanAcceptanceDetail[];
	manualConfirmations: string[];
	workspace: {
		available: boolean;
		changedFiles: string[];
		outOfScopeFiles: string[];
	};
	summary: string;
};

export type PlanEvidenceDocument = {
	version: 1;
	updatedAt: string;
	entries: PlanAcceptanceEvidenceEntry[];
};

const evidenceWrites = new Map<string, Promise<void>>();
const MAX_EVIDENCE_ENTRIES = 500;

export function getPlanEvidencePath(planPath: string): string {
	return `${planPath}.evidence.json`;
}

export async function readPlanEvidence(
	planPath: string,
): Promise<PlanEvidenceDocument> {
	try {
		const raw = await fs.readFile(getPlanEvidencePath(planPath), 'utf8');
		const parsed = JSON.parse(raw) as Partial<PlanEvidenceDocument>;
		return {
			version: 1,
			updatedAt:
				typeof parsed.updatedAt === 'string'
					? parsed.updatedAt
					: new Date(0).toISOString(),
			entries: Array.isArray(parsed.entries) ? parsed.entries : [],
		};
	} catch (error: any) {
		if (error?.code === 'ENOENT') {
			return {version: 1, updatedAt: new Date(0).toISOString(), entries: []};
		}

		throw error;
	}
}

/** Append one immutable acceptance attempt using a per-plan write queue. */
export async function appendPlanEvidence(
	planPath: string,
	entry: PlanAcceptanceEvidenceEntry,
): Promise<void> {
	const evidencePath = getPlanEvidencePath(planPath);
	const previous = evidenceWrites.get(evidencePath) ?? Promise.resolve();
	const write = previous
		.catch(() => undefined)
		.then(async () => {
			const current = await readPlanEvidence(planPath);
			const completedAt = entry.completedAt || new Date().toISOString();
			const entries = [
				...current.entries,
				{...entry, id: entry.id ?? randomUUID(), completedAt},
			].slice(-MAX_EVIDENCE_ENTRIES);
			await replacePlanFileAtomically(
				evidencePath,
				JSON.stringify({version: 1, updatedAt: completedAt, entries}, null, 2) +
					'\n',
			);
		});
	evidenceWrites.set(evidencePath, write);
	try {
		await write;
	} finally {
		if (evidenceWrites.get(evidencePath) === write) {
			evidenceWrites.delete(evidencePath);
		}
	}
}
