/**
 * Compact Plan Mode progress labels for StatusLine / terminal chrome.
 * Display strings are localized; plan frontmatter status values stay English.
 */

import type {PlanDoc} from '../execution/planDocument.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/translations.js';

export type PlanProgressLabels = {
	planBadge: string;
	planStatusDraft: string;
	planStatusApproved: string;
	planStatusExecuting: string;
	planStatusCompleted: string;
	planStatusArchived: string;
	planStatusAbandoned: string;
	/** Template with {count} */
	planPhaseCount: string;
	/** Template with {current} and {total} */
	planPhaseProgress: string;
	planNextStep: string;
};

const EN_FALLBACK: PlanProgressLabels = {
	planBadge: '⚐ Plan',
	planStatusDraft: 'Draft',
	planStatusApproved: 'Approved',
	planStatusExecuting: 'Executing',
	planStatusCompleted: 'Completed',
	planStatusArchived: 'Archived',
	planStatusAbandoned: 'Abandoned',
	planPhaseCount: '{count} phase(s)',
	planPhaseProgress: 'phase {current}/{total}',
	planNextStep: 'next',
};

function resolveLabels(override?: PlanProgressLabels): PlanProgressLabels {
	if (override) {
		return override;
	}
	try {
		const chat = translations[getCurrentLanguage()]?.chatScreen;
		if (!chat?.planBadge) {
			return EN_FALLBACK;
		}
		return {
			planBadge: chat.planBadge,
			planStatusDraft: chat.planStatusDraft,
			planStatusApproved: chat.planStatusApproved,
			planStatusExecuting: chat.planStatusExecuting,
			planStatusCompleted: chat.planStatusCompleted,
			planStatusArchived: chat.planStatusArchived,
			planStatusAbandoned: chat.planStatusAbandoned,
			planPhaseCount: chat.planPhaseCount,
			planPhaseProgress: chat.planPhaseProgress,
			planNextStep: chat.planNextStep,
		};
	} catch {
		return EN_FALLBACK;
	}
}

function localizeStatus(
	status: string,
	labels: PlanProgressLabels,
): string {
	switch (status) {
		case 'draft':
			return labels.planStatusDraft;
		case 'approved':
			return labels.planStatusApproved;
		case 'executing':
			return labels.planStatusExecuting;
		case 'completed':
			return labels.planStatusCompleted;
		case 'archived':
			return labels.planStatusArchived;
		case 'abandoned':
			return labels.planStatusAbandoned;
		default:
			return status;
	}
}

function formatPhaseCount(count: number, labels: PlanProgressLabels): string {
	// English singular/plural polish when using the default en template.
	if (labels.planPhaseCount === EN_FALLBACK.planPhaseCount) {
		return count === 1 ? '1 phase' : `${count} phases`;
	}
	return labels.planPhaseCount.replace(/\{count\}/g, String(count));
}

function basenameOfPath(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	return parts[parts.length - 1] || filePath;
}

/**
 * Short label for StatusLine, e.g. `⚐ Plan P1/3 · 2/5` or `⚐ 计划（草稿）`.
 */
export function formatPlanProgressLabel(
	doc: PlanDoc,
	labelsOverride?: PlanProgressLabels,
): string {
	const labels = resolveLabels(labelsOverride);
	const status = doc.frontmatter.status || 'draft';
	const totalPhases = doc.phases.length;
	const currentPhase = Math.max(0, doc.frontmatter.current_phase);
	const phase =
		doc.phases.find(p => p.index === Math.max(1, currentPhase)) ??
		doc.phases[0];
	const phaseChecked = phase?.steps.filter(s => s.checked).length ?? 0;
	const phaseTotal = phase?.steps.length ?? 0;
	const badge = labels.planBadge;

	if (status === 'draft' || status === 'approved') {
		const statusLabel = localizeStatus(status, labels);
		const phasePart =
			totalPhases > 0 ? ` · ${formatPhaseCount(totalPhases, labels)}` : '';
		return `${badge} (${statusLabel})${phasePart}`;
	}

	if (status === 'executing' || status === 'completed') {
		const phaseIndex = phase?.index ?? Math.max(1, currentPhase);
		const phasePart =
			totalPhases > 0 ? `P${phaseIndex}/${totalPhases}` : `P${phaseIndex}`;
		const stepPart =
			phaseTotal > 0 ? ` · ${phaseChecked}/${phaseTotal}` : '';
		return `${badge} ${phasePart}${stepPart}`;
	}

	return `${badge} (${localizeStatus(status, labels)})`;
}

/**
 * Slightly longer progress for tooltips / logs.
 * e.g. `执行中 · Add auth · 阶段 1/3 · 下一步: wire routes`
 */
export function formatPlanProgressDetail(
	doc: PlanDoc,
	labelsOverride?: PlanProgressLabels,
): string {
	const labels = resolveLabels(labelsOverride);
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
	const phaseIndex = phase?.index ?? currentPhase;
	const phasePart =
		totalPhases > 0
			? labels.planPhaseProgress
					.replace(/\{current\}/g, String(phaseIndex))
					.replace(/\{total\}/g, String(totalPhases))
			: labels.planPhaseProgress
					.replace(/\{current\}/g, String(currentPhase))
					.replace(/\{total\}/g, String(currentPhase));
	const nextPart = next ? ` · ${labels.planNextStep}: ${next.text}` : '';
	return `${localizeStatus(status, labels)} · ${title} · ${phasePart}${nextPart}`;
}
