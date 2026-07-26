/**
 * Compact Plan Mode progress labels for StatusLine / terminal chrome.
 * Pure helpers — no React, no I/O.
 */

import type {PlanDoc} from '../execution/planDocument.js';

function basenameOfPath(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	return parts[parts.length - 1] || filePath;
}

/**
 * Short label for StatusLine, e.g. `⚐ Plan P1/3 · 2/5` or `⚐ Plan (draft)`.
 */
export function formatPlanProgressLabel(doc: PlanDoc): string {
	const status = doc.frontmatter.status || 'draft';
	const totalPhases = doc.phases.length;
	const currentPhase = Math.max(0, doc.frontmatter.current_phase);
	const phase =
		doc.phases.find(p => p.index === Math.max(1, currentPhase)) ??
		doc.phases[0];
	const phaseChecked = phase?.steps.filter(s => s.checked).length ?? 0;
	const phaseTotal = phase?.steps.length ?? 0;

	if (status === 'draft' || status === 'approved') {
		const phasePart =
			totalPhases > 0 ? ` · ${totalPhases} phase${totalPhases === 1 ? '' : 's'}` : '';
		return `⚐ Plan (${status})${phasePart}`;
	}

	if (status === 'executing' || status === 'completed') {
		const phaseIndex = phase?.index ?? Math.max(1, currentPhase);
		const phasePart =
			totalPhases > 0 ? `P${phaseIndex}/${totalPhases}` : `P${phaseIndex}`;
		const stepPart =
			phaseTotal > 0 ? ` · ${phaseChecked}/${phaseTotal}` : '';
		return `⚐ Plan ${phasePart}${stepPart}`;
	}

	return `⚐ Plan (${status})`;
}

/**
 * Slightly longer progress for tooltips / logs.
 * e.g. `executing · Add auth · phase 1/3 · next: wire routes`
 */
export function formatPlanProgressDetail(doc: PlanDoc): string {
	const title =
		doc.frontmatter.title?.trim() ||
		doc.title?.trim() ||
		basenameOfPath(doc.filePath);
	const status = doc.frontmatter.status || 'draft';
	const totalPhases = doc.phases.length;
	const currentPhase = Math.max(1, doc.frontmatter.current_phase || 1);
	const phase =
		doc.phases.find(p => p.index === currentPhase) ?? doc.phases[0];
	const next = phase?.steps.find(s => !s.checked);
	const phasePart =
		totalPhases > 0
			? `phase ${phase?.index ?? currentPhase}/${totalPhases}`
			: `phase ${currentPhase}`;
	const nextPart = next ? ` · next: ${next.text}` : '';
	return `${status} · ${title} · ${phasePart}${nextPart}`;
}
