/**
 * Pure helpers for rendering an active Plan Mode document in the CLI
 * before the user approves execution via askuser.
 *
 * The plan lives on disk under `.snow/plan/**`; approval UI used to only show
 * the askuser question text. This module formats a compact, scannable preview
 * so users can review phases/files/steps in-terminal without opening the file.
 */

import type {PlanDoc, PlanPhase} from '../execution/planDocument.js';

export type PlanApprovalPreviewOptions = {
	/** Max steps shown per phase (default 8). */
	maxStepsPerPhase?: number;
	/** Max files shown per phase (default 6). */
	maxFilesPerPhase?: number;
	/** Max phases shown (default 8). */
	maxPhases?: number;
};

function basenameOfPath(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	return parts[parts.length - 1] || filePath;
}

function formatFileList(files: string[], maxFiles: number): string {
	if (files.length === 0) {
		return '(none listed)';
	}

	const shown = files.slice(0, maxFiles).map(f => {
		const cleaned = f.replace(/\s*\(.*\)\s*$/, '').trim() || f;
		return basenameOfPath(cleaned);
	});
	const extra = files.length - shown.length;
	return extra > 0
		? `${shown.join(', ')} · +${extra} more`
		: shown.join(', ');
}

function formatPhase(
	phase: PlanPhase,
	options: Required<PlanApprovalPreviewOptions>,
): string[] {
	const lines: string[] = [
		`### Phase ${phase.index}: ${phase.title || '(untitled)'}`,
	];

	if (phase.files.length > 0) {
		lines.push(
			`Files: ${formatFileList(phase.files, options.maxFilesPerPhase)}`,
		);
	}

	if (phase.steps.length > 0) {
		lines.push('Steps:');
		const shown = phase.steps.slice(0, options.maxStepsPerPhase);
		for (const step of shown) {
			lines.push(`  ${step.checked ? '[x]' : '[ ]'} ${step.text}`);
		}
		const extra = phase.steps.length - shown.length;
		if (extra > 0) {
			lines.push(`  … +${extra} more steps`);
		}
	}

	if (phase.doneWhen.length > 0) {
		lines.push(`Done when: ${phase.doneWhen.join('; ')}`);
	}

	return lines;
}

/**
 * Detect whether an askuser question is about approving / continuing a plan.
 * Used so we only inject the plan document preview on plan-related prompts.
 */
export function isPlanApprovalQuestion(question: string | undefined): boolean {
	if (!question || typeof question !== 'string') {
		return false;
	}

	const q = question.trim().toLowerCase();
	if (!q) {
		return false;
	}

	return (
		q.includes('plan') ||
		q.includes('计划') ||
		q.includes('implementation') ||
		q.includes('execute') ||
		q.includes('执行') ||
		q.includes('.snow/plan') ||
		q.includes('continue this plan') ||
		q.includes('继续该计划') ||
		q.includes('继续此计划')
	);
}

/**
 * Format a PlanDoc into plain-text lines for the TUI approval panel.
 * Keeps the preview compact: metadata + phases/steps/files, not full prose.
 */
export function formatPlanApprovalPreview(
	doc: PlanDoc,
	options: PlanApprovalPreviewOptions = {},
): string {
	const opts: Required<PlanApprovalPreviewOptions> = {
		maxStepsPerPhase: options.maxStepsPerPhase ?? 8,
		maxFilesPerPhase: options.maxFilesPerPhase ?? 6,
		maxPhases: options.maxPhases ?? 8,
	};

	const title =
		doc.frontmatter.title?.trim() ||
		doc.title?.trim() ||
		basenameOfPath(doc.filePath);
	const status = doc.frontmatter.status || 'draft';
	const complexity = doc.frontmatter.complexity || 'simple';
	const phaseCount = doc.phases.length;

	const lines: string[] = [
		'📋 Plan Document',
		`Title: ${title}`,
		`Status: ${status} · Complexity: ${complexity} · Phases: ${phaseCount}`,
		`Path: ${doc.filePath}`,
	];

	if (doc.affectedFiles.length > 0) {
		lines.push(
			`Affected: ${formatFileList(doc.affectedFiles, opts.maxFilesPerPhase)}`,
		);
	}

	if (phaseCount === 0) {
		lines.push('', '(No ### Phase N sections parsed yet)');
		return lines.join('\n');
	}

	lines.push('');
	const phases = doc.phases.slice(0, opts.maxPhases);
	for (let i = 0; i < phases.length; i++) {
		const phase = phases[i]!;
		lines.push(...formatPhase(phase, opts));
		if (i < phases.length - 1) {
			lines.push('');
		}
	}

	const hiddenPhases = phaseCount - phases.length;
	if (hiddenPhases > 0) {
		lines.push('', `… +${hiddenPhases} more phases (open the plan file for full detail)`);
	}

	return lines.join('\n');
}
