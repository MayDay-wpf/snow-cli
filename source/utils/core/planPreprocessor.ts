/**
 * Plan Mode progress context injection (mirrors todoPreprocessor).
 *
 * Builds a pinned reminder so the model keeps following the approved plan
 * across turns instead of drifting once the plan file scrolls out of context.
 */

import path from 'node:path';
import {
	findActivePlan,
	listUnfinishedPlans,
	type PlanDoc,
} from '../execution/planDocument.js';
import {readPlanOwnerLock} from '../execution/planOwnerLock.js';
import {
	classifyPlanOwnership,
	type PlanOwnershipClassification,
	type PlanOwnershipKind,
} from '../execution/planOwnership.js';
import {getPlanEvidencePath} from '../execution/planEvidence.js';

export function formatPlanContext(doc: PlanDoc): string {
	const total = doc.phases.length;
	const currentIndex = Math.max(1, doc.frontmatter.current_phase);
	const phase = doc.phases.find(p => p.index === currentIndex) ?? doc.phases[0];

	const lines: string[] = [
		'## Active Plan',
		'',
		`Plan file: ${doc.filePath}`,
		`Status: ${doc.frontmatter.status}`,
		`Acceptance policy: ${doc.frontmatter.acceptance_policy || 'standard'}`,
		`Evidence: ${getPlanEvidencePath(doc.filePath)}`,
		`Session: ${doc.frontmatter.session || '(none)'}`,
	];

	if (phase) {
		lines.push(`Phase ${phase.index}/${total}: ${phase.title}`, '');
		if (phase.delivers) {
			lines.push(`**Delivers**: ${phase.delivers}`, '');
		}

		if (phase.executionStrategy) {
			lines.push(`**Execution strategy**: ${phase.executionStrategy}`, '');
		}

		if (phase.files.length > 0) {
			lines.push('**Files** (current phase write allowlist):');
			for (const file of phase.files) {
				lines.push(`- ${file}`);
			}

			lines.push('');
		}

		if (phase.steps.length > 0) {
			lines.push('**Steps**:');
			for (const step of phase.steps) {
				lines.push(`${step.checked ? '[x]' : '[ ]'} ${step.text}`);
			}

			const next = phase.steps.find(s => !s.checked);
			if (next) {
				lines.push('', `**Next step**: ${next.text}`);
			}
		}

		if ((phase.checks ?? []).length > 0) {
			lines.push('', '**Checks**:');
			for (const check of phase.checks ?? []) {
				if (check.type === 'command') {
					lines.push(`- command: ${check.command}`);
				} else if (check.type === 'manual') {
					lines.push(`- manual: ${check.description}`);
				} else {
					lines.push('- diagnostics');
				}
			}
		}

		if (phase.doneWhen.length > 0) {
			lines.push('', `**Done when**: ${phase.doneWhen.join('; ')}`);
		}
	}

	lines.push(
		'',
		'**You MUST follow this plan.** After finishing a step call `plan-manage` with action "check_step"; ' +
			'after a phase meets its Done-when criteria call `plan-manage` with action "complete_phase" ' +
			"(it verifies phase checks, workspace scope, build, and diagnostics). Do not edit files outside the current phase's Files list — " +
			'if the plan needs to change, call `plan-manage` with action "amend" first. ' +
			'When every phase is done, call `plan-manage` with action "complete" to archive the plan.',
		'',
	);

	return lines.join('\n');
}

/**
 * Reminder for the active (approved/executing) plan of this session.
 * Returns null when there is nothing to remind about.
 */
export async function buildPlanReminder(
	cwd: string,
	sessionId: string | null | undefined,
	planMode: boolean,
): Promise<string | null> {
	if (!planMode) {
		return null;
	}

	try {
		const doc = await findActivePlan(cwd, sessionId);
		if (
			doc &&
			(doc.frontmatter.status === 'executing' ||
				doc.frontmatter.status === 'approved')
		) {
			return formatPlanContext(doc);
		}
	} catch {
		// Injection is best-effort.
	}

	return null;
}

const RECOVERABLE_KINDS = new Set<PlanOwnershipKind>([
	'mine_recoverable',
	'untagged_recoverable',
	'foreign_hard_stale',
]);

function formatLockShort(ownership: PlanOwnershipClassification): string {
	const {lock} = ownership;
	if (!lock) {
		return 'lock=(none)';
	}

	const soft = ownership.softStale === true;
	const hard = ownership.stale === true;
	const staleLabel = hard ? 'hard' : soft ? 'soft' : 'fresh';
	return `lock=pid=${lock.pid} alive=${String(
		ownership.pidAlive,
	)} ${staleLabel}`;
}

function summarizeUnfinished(
	doc: PlanDoc,
	index: number,
	ownership: PlanOwnershipClassification,
): string {
	const total = doc.phases.length;
	const current = Math.max(1, doc.frontmatter.current_phase || 1);
	const title =
		doc.frontmatter.title?.trim() ||
		doc.title?.trim() ||
		path.basename(doc.filePath);
	const owner = doc.frontmatter.session || '(none)';
	return (
		`${index}. [${doc.frontmatter.status}] ${title} | ownership=${ownership.kind} | ` +
		`session=${owner} | phase=${current}/${total || '?'} | ` +
		`${formatLockShort(ownership)} | ${doc.filePath}`
	);
}

function buildAdoptGuidance(input: {
	hasForeignLive: boolean;
	hasForeignSoft: boolean;
	hasRecoverable: boolean;
	multiple: boolean;
}): string[] {
	const lines: string[] = [
		'',
		'Before starting new work, use `askuser-ask_question` with purpose="plan_resume" and options like:',
	];

	if (input.hasRecoverable && !input.hasForeignLive && !input.hasForeignSoft) {
		lines.push(
			'- "Continue this plan" / "继续该计划" (when only one unfinished plan)',
			'- "Continue: <absolute-or-relative-plan-path>" when multiple plans exist',
		);
	} else {
		lines.push(
			'- Prefer "Start over" / "开始新计划" or wait — do **not** treat Continue as a silent lock steal',
			'- If the user insists on takeover: "Force continue: <plan-path>" (requires force adopt)',
		);
	}

	lines.push(
		'- "Start over" / "开始新计划" (do NOT adopt; optionally abandon old plans first)',
		'- "Abandon old" then archive via plan-manage',
		'',
	);

	if (input.hasForeignLive) {
		lines.push(
			'**Foreign live owner present.** Another session/process holds a live lock. ' +
				'Do **not** Continue / adopt without force — that would race the live owner. ' +
				'Ask the user to wait or finish that session. Only if they insist: ' +
				'`plan-manage {action:"adopt", plan_path:"...", force:true, reason:"..."}`.',
			'',
		);
	}

	if (input.hasForeignSoft) {
		lines.push(
			'**Foreign soft-stale owner present.** PID may still be alive but heartbeat is old (possible zombie). ' +
				'Soft-stale is **never** auto-adopted. Continue without force is forbidden. ' +
				'If the user confirms takeover: ' +
				'`plan-manage {action:"adopt", plan_path:"...", force:true, reason:"..."}`.',
			'',
		);
	}

	if (input.hasRecoverable) {
		const pathHint = input.multiple
			? 'plan_path is required when multiple candidates exist. '
			: '';
		lines.push(
			'Choosing **Continue** for a recoverable plan should call ' +
				'`plan-manage {action:"adopt", plan_path:"..."}` without force. ' +
				pathHint +
				'That rebinds session id, sets status=executing, restores the plan gate/scope, ' +
				'and acquires the repo owner lock. Resume from the first unchecked step of the current phase.',
			'',
		);
	}

	lines.push(
		'Do **not** silently adopt the newest plan without user confirmation.',
		'plan-manage list labels each plan with ownership=… — use that before adopting.',
		'',
	);

	return lines;
}

/**
 * When this session has no active plan but unfinished plans exist on disk
 * (any session), prompt the model to ask the user about resuming.
 */
export async function buildResumePlanNotice(
	cwd: string,
	sessionId: string | null | undefined,
): Promise<string | null> {
	try {
		// If this session already owns an executing/approved plan, no resume banner.
		const mine = await findActivePlan(cwd, sessionId);
		if (
			mine &&
			(mine.frontmatter.status === 'executing' ||
				mine.frontmatter.status === 'approved')
		) {
			return null;
		}

		const unfinished = await listUnfinishedPlans(cwd, {
			sessionId: sessionId ?? undefined,
			includeDraftsWithProgress: true,
		});
		if (unfinished.length === 0) {
			return null;
		}

		const lock = await readPlanOwnerLock(cwd);
		const classified = unfinished.map(doc => ({
			doc,
			ownership: classifyPlanOwnership({
				cwd,
				sessionId,
				plan: {
					filePath: doc.filePath,
					frontmatter: {
						status: doc.frontmatter.status,
						session: doc.frontmatter.session,
					},
				},
				lock,
			}),
		}));

		const hasForeignLive = classified.some(
			c => c.ownership.kind === 'foreign_live',
		);
		const hasForeignSoft = classified.some(
			c => c.ownership.kind === 'foreign_soft_stale',
		);
		const hasRecoverable = classified.some(c =>
			RECOVERABLE_KINDS.has(c.ownership.kind),
		);

		const lines = [
			'## Unfinished Plan Detected',
			'',
			`Found ${unfinished.length} unfinished plan(s) under .snow/plan/.`,
			'',
			...classified.map((c, i) =>
				summarizeUnfinished(c.doc, i + 1, c.ownership),
			),
			...buildAdoptGuidance({
				hasForeignLive,
				hasForeignSoft,
				hasRecoverable,
				multiple: unfinished.length > 1,
			}),
		];

		return lines.join('\n');
	} catch {
		return null;
	}
}
