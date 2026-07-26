/**
 * Headless Plan Mode resume (Phase 4)
 *
 * Headless never uses interactive askuser for plan approval. Opt-in only:
 * resume a preapproved/executing plan from disk (session match or explicit path).
 * If restore/adopt fails, planMode stays off so writes remain unlocked only via YOLO,
 * not via a false plan gate unlock.
 */

import path from 'node:path';
import {
	getPlanWriteOptions,
	mutatePlanDocument,
	parsePlanDocument,
} from './planDocument.js';
import {
	getPlanApproved,
	restorePlanGateFromDisk,
	setPlanApproved,
	setPlanScope,
	resolvePlanScopeFiles,
} from './planModeGate.js';
import {acquirePlanOwnerLock, releasePlanOwnerLock} from './planOwnerLock.js';
import {recordPlanEvent} from '../telemetry/otel.js';

export type HeadlessPlanResumeInput = {
	cwd: string;
	sessionId?: string | null;
	/** Absolute or cwd-relative path from --plan-file */
	planFile?: string | null;
	/** Opt-in: try restore when --plan / --yolo-p is set without a path */
	enablePlan?: boolean;
};

export type HeadlessPlanResumeResult = {
	/** Whether planMode should be enabled for this headless run */
	planMode: boolean;
	/** Whether the gate is approved (writes unlocked under scope) */
	approved: boolean;
	planPath?: string;
	message?: string;
};

/**
 * Attempt headless plan resume. Safe default: planMode false / unapproved.
 */
export async function tryResumeHeadlessPlan(
	input: HeadlessPlanResumeInput,
): Promise<HeadlessPlanResumeResult> {
	const cwd = input.cwd || process.cwd();
	const sessionId = input.sessionId ?? null;
	const planFile =
		typeof input.planFile === 'string' && input.planFile.trim()
			? input.planFile.trim()
			: null;
	const enablePlan = Boolean(input.enablePlan) || Boolean(planFile);

	if (!enablePlan) {
		return {planMode: false, approved: false};
	}

	// Explicit plan file: adopt-like rebind without interactive askuser.
	if (planFile) {
		const result = await resumeFromPlanFile(cwd, sessionId, planFile);
		if (result.approved) {
			recordPlanEvent({
				event: 'approve',
				sessionId: sessionId || undefined,
				planPath: result.planPath,
				status: 'executing',
				reason: 'headless-plan-file',
			});
		}
		return result;
	}

	// --plan / --yolo-p without path: restore only if this session already has executing plan.
	await restorePlanGateFromDisk(cwd, sessionId);
	if (getPlanApproved(sessionId)) {
		recordPlanEvent({
			event: 'approve',
			sessionId: sessionId || undefined,
			status: 'executing',
			reason: 'headless-restore-from-disk',
		});
		return {
			planMode: true,
			approved: true,
			message: 'Restored plan gate from executing plan on disk',
		};
	}

	// Opt-in without a preapproved/executing plan: keep planMode false so we
	// do not enter unapproved plan gate (which would block writes with no
	// interactive way to approve in headless).
	return {
		planMode: false,
		approved: false,
		message:
			'Headless plan opt-in ignored: no executing plan for this session. ' +
			'Use --plan-file <path> after interactive approval, or resume the same sessionId.',
	};
}

async function resumeFromPlanFile(
	cwd: string,
	sessionId: string | null,
	planFile: string,
): Promise<HeadlessPlanResumeResult> {
	const planPath = path.isAbsolute(planFile)
		? planFile
		: path.resolve(cwd, planFile);

	let doc;
	try {
		doc = await parsePlanDocument(planPath);
	} catch (error) {
		return {
			planMode: false,
			approved: false,
			planPath,
			message: `Headless plan resume failed: cannot parse ${planPath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}

	if (!['approved', 'executing'].includes(doc.frontmatter.status)) {
		return {
			planMode: false,
			approved: false,
			planPath,
			message:
				`Headless plan resume refused: status=${doc.frontmatter.status}. ` +
				'Only approved/executing plans can be resumed without interactive askuser.',
		};
	}

	const boundSession = sessionId || doc.frontmatter.session || '';
	const currentPhase = Math.max(1, doc.frontmatter.current_phase || 1);

	const lockResult = await acquirePlanOwnerLock(cwd, {
		planPath: doc.filePath,
		sessionId: boundSession,
	});
	if (!lockResult.ok) {
		return {
			planMode: false,
			approved: false,
			planPath: doc.filePath,
			message: `Headless plan resume failed: owner lock unavailable for ${doc.filePath}`,
		};
	}

	try {
		await mutatePlanDocument(
			doc.filePath,
			() => ({
				frontmatter: {
					session: boundSession,
					status: 'executing',
					current_phase: currentPhase,
				},
			}),
			getPlanWriteOptions(doc),
		);
	} catch (error) {
		await releasePlanOwnerLock(cwd, {
			planPath: doc.filePath,
			sessionId: boundSession,
		});
		return {
			planMode: false,
			approved: false,
			planPath: doc.filePath,
			message: `Headless plan resume failed while rebinding plan: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}

	const updated = await parsePlanDocument(doc.filePath);
	setPlanApproved(sessionId, true);
	setPlanScope(sessionId, {
		planPath: updated.filePath,
		files: resolvePlanScopeFiles(updated),
		cwd,
	});

	return {
		planMode: true,
		approved: true,
		planPath: updated.filePath,
		message: `Headless plan resumed: ${updated.filePath} (phase ${currentPhase})`,
	};
}
