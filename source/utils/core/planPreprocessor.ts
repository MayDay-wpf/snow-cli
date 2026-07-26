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
import {readPlanOwnerLock, isLockStale} from '../execution/planOwnerLock.js';

export function formatPlanContext(doc: PlanDoc): string {
	const total = doc.phases.length;
	const currentIndex = Math.max(1, doc.frontmatter.current_phase);
	const phase = doc.phases.find(p => p.index === currentIndex) ?? doc.phases[0];

	const lines: string[] = [
		'## Active Plan',
		'',
		`Plan file: ${doc.filePath}`,
		`Status: ${doc.frontmatter.status}`,
		`Session: ${doc.frontmatter.session || '(none)'}`,
	];

	if (phase) {
		lines.push(`Phase ${phase.index}/${total}: ${phase.title}`, '');
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
		if (phase.doneWhen.length > 0) {
			lines.push('', `**Done when**: ${phase.doneWhen.join('; ')}`);
		}
	}

	lines.push(
		'',
		'**You MUST follow this plan.** After finishing a step call `plan-manage` with action "check_step"; ' +
			'after a phase meets its Done-when criteria call `plan-manage` with action "complete_phase" ' +
			"(it runs build + diagnostics acceptance). Do not edit files outside the current phase's Files list — " +
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

function summarizeUnfinished(doc: PlanDoc, index: number): string {
	const total = doc.phases.length;
	const current = Math.max(1, doc.frontmatter.current_phase || 1);
	const title =
		doc.frontmatter.title?.trim() ||
		doc.title?.trim() ||
		path.basename(doc.filePath);
	const owner = doc.frontmatter.session || '(none)';
	return (
		`${index}. [${doc.frontmatter.status}] ${title} | session=${owner} | ` +
		`phase=${current}/${total || '?'} | ${doc.filePath}`
	);
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
			sessionId,
			includeDraftsWithProgress: true,
		});
		if (unfinished.length === 0) {
			return null;
		}

		const lock = await readPlanOwnerLock(cwd);
		let lockLine = '';
		if (lock) {
			const {stale, pidAlive} = isLockStale(lock);
			lockLine =
				`Owner lock: session=${lock.sessionId || '(none)'} pid=${lock.pid} ` +
				`(alive=${String(pidAlive)}, stale=${String(stale)}) plan=${lock.planPath}`;
		}

		const lines = [
			'## Unfinished Plan Detected',
			'',
			`Found ${unfinished.length} unfinished plan(s) under .snow/plan/.`,
			'',
			...unfinished.map((doc, i) => summarizeUnfinished(doc, i + 1)),
		];
		if (lockLine) {
			lines.push('', lockLine);
		}
		lines.push(
			'',
			'Before starting new work, use `askuser-ask_question` with options like:',
			'- "Continue this plan" / "继续该计划" (when only one unfinished plan)',
			'- "Continue: <absolute-or-relative-plan-path>" when multiple plans exist',
			'- "Start over" / "开始新计划" (do NOT adopt; optionally abandon old plans first)',
			'- "Abandon old" then archive via plan-manage',
			'',
			'Choosing **Continue** should call `plan-manage {action:"adopt", plan_path:"..."}` ' +
				'(required when multiple candidates). That rebinds session id, sets status=executing, ' +
				'restores the plan gate/scope, and acquires the repo owner lock. ' +
				'Resume from the first unchecked step of the current phase.',
			'',
			'Do **not** silently adopt the newest plan without user confirmation.',
			'',
		);
		return lines.join('\n');
	} catch {
		return null;
	}
}
