/**
 * Headless Plan Mode resume (Phase 3/4)
 *
 * Headless never uses interactive askuser for plan approval. Opt-in only:
 * resume a preapproved/executing plan from disk (session match or explicit path).
 * If restore/adopt fails, planMode stays off so writes remain unlocked only via YOLO,
 * not via a false plan gate unlock.
 *
 * Ownership / isolation rules for --plan-file:
 * - same session / hard-stale foreign / untagged recoverable → resume allowed
 *   (acquire without force)
 * - live foreign / soft-stale foreign → FAIL by default (no silent force adopt)
 * - Optional takeover: forceTakeover=true + non-empty forceReason may steal a
 *   live/soft-stale foreign lock (writes a takeover note). Prefer interactive
 *   plan-manage adopt when possible.
 */

import path from 'node:path';
import {
	getPlanWriteOptions,
	mutatePlanDocument,
	parsePlanDocument,
} from './planDocument.js';
import {
	classifyPlanDocOwnership,
	getPlanApproved,
	restorePlanGateFromDisk,
	setPlanApproved,
	setPlanScope,
	resolvePlanScopeFiles,
} from './planModeGate.js';
import {
	acquirePlanOwnerLock,
	formatOwnerLockConflict,
	releasePlanOwnerLock,
	type PlanOwnerLockConflict,
} from './planOwnerLock.js';
import {recordPlanEvent} from '../telemetry/otel.js';

function formatHeadlessLockConflict(conflict: PlanOwnerLockConflict): string {
	try {
		return formatOwnerLockConflict(conflict);
	} catch {
		return `lock session=${conflict.lock.sessionId} pid=${conflict.lock.pid}`;
	}
}

export type HeadlessPlanResumeInput = {
	cwd: string;
	sessionId?: string | null;
	/** Absolute or cwd-relative path from --plan-file */
	planFile?: string | null;
	/** Opt-in: try restore when --plan / --yolo-p is set without a path */
	enablePlan?: boolean;
	/**
	 * Explicit takeover of a live/soft-stale foreign owner (requires forceReason).
	 * Default false — headless never silently steals a live lock.
	 */
	forceTakeover?: boolean;
	/** Required when forceTakeover is true; recorded as a takeover note. */
	forceReason?: string | null;
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
		const forceTakeover = input.forceTakeover === true;
		const forceReason =
			typeof input.forceReason === 'string' ? input.forceReason.trim() : '';
		const result = await resumeFromPlanFile(cwd, sessionId, planFile, {
			forceTakeover,
			forceReason,
		});
		if (result.approved) {
			recordPlanEvent({
				event: 'approve',
				sessionId: sessionId || undefined,
				planPath: result.planPath,
				status: 'executing',
				reason: forceTakeover
					? 'headless-plan-file-force-takeover'
					: 'headless-plan-file',
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
	options: {forceTakeover: boolean; forceReason: string} = {
		forceTakeover: false,
		forceReason: '',
	},
): Promise<HeadlessPlanResumeResult> {
	const planPath = path.isAbsolute(planFile)
		? planFile
		: path.resolve(cwd, planFile);
	const {forceTakeover, forceReason} = options;

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

	// Ownership check BEFORE lock acquire: never silent-force live/soft-stale foreign.
	const ownership = await classifyPlanDocOwnership(cwd, doc, sessionId);
	const needsForceTakeover =
		ownership.kind === 'foreign_live' ||
		ownership.kind === 'foreign_soft_stale';

	if (needsForceTakeover) {
		if (!forceTakeover) {
			return {
				planMode: false,
				approved: false,
				planPath: doc.filePath,
				message:
					`Headless plan resume refused: ownership=${ownership.kind}. ` +
					`${ownership.summary} ` +
					'Headless will not silently take over a live/soft-stale foreign plan. ' +
					'Finish or abandon it first, pass forceTakeover+forceReason, ' +
					'or use interactive plan-manage adopt with force=true reason=... .',
			};
		}
		if (!forceReason) {
			return {
				planMode: false,
				approved: false,
				planPath: doc.filePath,
				message:
					`Headless forceTakeover requires forceReason (ownership=${ownership.kind}). ` +
					'Soft-stale is never auto-adopted without force+reason.',
			};
		}
	} else if (
		!ownership.canAdoptWithoutForce &&
		ownership.kind !== 'mine_active' &&
		ownership.kind !== 'none'
	) {
		return {
			planMode: false,
			approved: false,
			planPath: doc.filePath,
			message:
				`Headless plan resume refused: ownership=${ownership.kind}. ` +
				`${ownership.summary}`,
		};
	}

	const boundSession = sessionId || doc.frontmatter.session || '';
	const currentPhase = Math.max(1, doc.frontmatter.current_phase || 1);

	// force=true only when caller explicitly requested takeover of live/soft foreign.
	const lockResult = await acquirePlanOwnerLock(cwd, {
		planPath: doc.filePath,
		sessionId: boundSession,
		force: needsForceTakeover && forceTakeover,
	});
	if (!lockResult.ok) {
		return {
			planMode: false,
			approved: false,
			planPath: doc.filePath,
			message:
				`Headless plan resume failed: owner lock unavailable for ${doc.filePath}. ` +
				`${formatHeadlessLockConflict(lockResult.conflict)} ` +
				'Hard-stale/same-session can resume; live foreign requires forceTakeover+forceReason.',
		};
	}

	try {
		await mutatePlanDocument(
			doc.filePath,
			({content}) => {
				const patch = {
					frontmatter: {
						session: boundSession,
						status: 'executing' as const,
						current_phase: currentPhase,
					},
				};
				if (!(lockResult.tookOver && forceReason)) {
					return patch;
				}
				const body = content.endsWith('\n') ? content : `${content}\n`;
				return {
					...patch,
					content:
						body +
						`\n> Owner takeover: ${forceReason} (${new Date()
							.toISOString()
							.slice(0, 10)})\n`,
				};
			},
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

	const takeoverNote =
		lockResult.tookOver && forceReason
			? ` (force takeover: ${forceReason})`
			: '';
	return {
		planMode: true,
		approved: true,
		planPath: updated.filePath,
		message: `Headless plan resumed: ${updated.filePath} (phase ${currentPhase})${takeoverNote}`,
	};
}
