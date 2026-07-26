/**
 * Plan Mode progress context injection (mirrors todoPreprocessor).
 *
 * Builds a pinned reminder so the model keeps following the approved plan
 * across turns instead of drifting once the plan file scrolls out of context.
 */

import {
	findActivePlan,
	findSessionPlanFiles,
	type PlanDoc,
} from '../execution/planDocument.js';

export function formatPlanContext(doc: PlanDoc): string {
	const total = doc.phases.length;
	const currentIndex = Math.max(1, doc.frontmatter.current_phase);
	const phase = doc.phases.find(p => p.index === currentIndex) ?? doc.phases[0];

	const lines: string[] = [
		'## Active Plan',
		'',
		`Plan file: ${doc.filePath}`,
		`Status: ${doc.frontmatter.status}`,
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

/**
 * When no plan is active for this session but an executing plan exists on
 * disk (any session), prompt the model to ask the user about resuming it.
 */
export async function buildResumePlanNotice(
	cwd: string,
	sessionId: string | null | undefined,
): Promise<string | null> {
	// Scans plans from ALL sessions; sessionId reserved for future filtering.
	void sessionId;
	try {
		const docs = await findSessionPlanFiles(cwd, null);
		const executing = docs
			.filter(d => d.frontmatter.status === 'executing')
			.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
		if (!executing) {
			return null;
		}
		const total = executing.phases.length;
		const current = Math.max(1, executing.frontmatter.current_phase);
		return [
			'## Unfinished Plan Detected',
			'',
			`An in-progress plan exists: ${executing.filePath} (Phase ${current}/${total}).`,
			'',
			'Before starting new work, use `askuser-ask_question` with options ' +
				'["Continue this plan", "Start over"] (or 继续该计划 / 开始新计划). ' +
				'Choosing **Continue this plan** machine-adopts the unfinished plan into this session ' +
				'(rebinds session id, status=executing, restores the plan gate and scope). ' +
				'You may also call `plan-manage {action:"adopt"}` explicitly. ' +
				'Resume from the first unchecked step of the current phase.',
			'',
		].join('\n');
	} catch {
		return null;
	}
}
