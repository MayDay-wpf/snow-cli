/**
 * Complexity-tiered plan markdown template generator.
 */

import type {PlanComplexity} from './planDocument.js';

export type {PlanComplexity};

export type PlanTemplatePhaseInput = {
	title: string;
	files?: string[];
	steps?: string[];
	doneWhen?: string;
};

export type BuildPlanMarkdownInput = {
	title: string;
	session?: string;
	complexity?: PlanComplexity;
	context?: string;
	phases?: PlanTemplatePhaseInput[];
	/** Optional freeform analysis markdown (inserted under ## Analysis). */
	analysis?: string;
	/** Optional risks section body (complex plans). */
	risks?: string;
	/** Optional rollback section body (complex plans). */
	rollback?: string;
	/** When true, emit Analysis even for simple plans if analysis/files present. */
	includeAnalysis?: boolean;
};

function escapeYamlString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderPhase(index: number, phase: PlanTemplatePhaseInput): string {
	const files =
		phase.files && phase.files.length > 0
			? phase.files
			: ['(list files to touch)'];
	const steps =
		phase.steps && phase.steps.length > 0 ? phase.steps : ['Implement changes'];
	const doneWhen =
		phase.doneWhen?.trim() || 'build passes; no diagnostic errors';

	const lines = [
		`### Phase ${index}: ${phase.title}`,
		'- **Files**:',
		...files.map(f => `  - ${f}`),
		'- **Steps**:',
		...steps.map(s => `  - [ ] ${s}`),
		`- **Done when**: ${doneWhen}`,
		'',
	];
	return lines.join('\n');
}

function defaultPhases(
	title: string,
	complexity: PlanComplexity,
	inputPhases?: PlanTemplatePhaseInput[],
): PlanTemplatePhaseInput[] {
	const phases =
		inputPhases && inputPhases.length > 0
			? [...inputPhases]
			: [{title: 'Implement', steps: [`Implement: ${title}`]}];

	if (complexity === 'complex' && phases.length < 2) {
		phases.push({
			title: 'Verify',
			steps: ['Run acceptance checks', 'Confirm no regressions'],
			doneWhen: 'build passes; diagnostics clean',
		});
	}

	return phases;
}

function normalizePhaseInput(raw: unknown): PlanTemplatePhaseInput | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const obj = raw as Record<string, unknown>;
	const titleRaw = obj['title'];
	const title =
		typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : '';
	if (!title) {
		return null;
	}
	const filesRaw = obj['files'];
	const files = Array.isArray(filesRaw)
		? filesRaw.filter(
				(f): f is string => typeof f === 'string' && f.trim().length > 0,
		  )
		: undefined;
	const stepsRaw = obj['steps'];
	const steps = Array.isArray(stepsRaw)
		? stepsRaw.filter(
				(s): s is string => typeof s === 'string' && s.trim().length > 0,
		  )
		: undefined;
	const doneWhenRaw = obj['doneWhen'];
	const doneWhenSnake = obj['done_when'];
	const doneWhen =
		typeof doneWhenRaw === 'string'
			? doneWhenRaw
			: typeof doneWhenSnake === 'string'
			? doneWhenSnake
			: undefined;
	return {
		title,
		...(files && files.length > 0 ? {files} : {}),
		...(steps && steps.length > 0 ? {steps} : {}),
		...(doneWhen?.trim() ? {doneWhen: doneWhen.trim()} : {}),
	};
}

/** Parse plan-manage create/write_body `phases` argument into template phases. */
export function parsePlanPhasesArg(raw: unknown): PlanTemplatePhaseInput[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: PlanTemplatePhaseInput[] = [];
	for (const item of raw) {
		const phase = normalizePhaseInput(item);
		if (phase) {
			out.push(phase);
		}
	}
	return out;
}

/**
 * Build body-only markdown (no frontmatter) from structured fields.
 * Used by write_body when phases are provided without full body_markdown.
 */
export function buildPlanBodyMarkdown(
	input: Omit<BuildPlanMarkdownInput, 'session'>,
): string {
	const title = input.title.trim() || 'Untitled plan';
	const complexity: PlanComplexity = input.complexity || 'simple';
	const context = input.context?.trim() || `Plan for: ${title}`;
	const phases = defaultPhases(title, complexity, input.phases);
	const allFiles = [
		...new Set(phases.flatMap(p => p.files ?? []).filter(Boolean)),
	];

	const body: string[] = [`# ${title}`, '', '## Context', '', context, ''];

	const wantAnalysis =
		input.includeAnalysis === true ||
		Boolean(input.analysis?.trim()) ||
		complexity === 'medium' ||
		complexity === 'complex';

	if (wantAnalysis) {
		body.push('## Analysis', '');
		if (input.analysis?.trim()) {
			body.push(input.analysis.trim(), '');
		} else if (allFiles.length > 0) {
			body.push('- **Affected files**:');
			for (const file of allFiles) {
				body.push(`  - ${file}`);
			}
			body.push('');
		} else {
			body.push('- **Affected files**: (fill in after exploration)', '');
		}
	}

	body.push('## Phases', '');
	phases.forEach((phase, i) => {
		body.push(renderPhase(i + 1, phase));
	});

	const wantRisks =
		complexity === 'complex' ||
		Boolean(input.risks?.trim()) ||
		Boolean(input.rollback?.trim());

	if (wantRisks) {
		body.push(
			'## Risks & Mitigations',
			'',
			input.risks?.trim() ||
				[
					'| Risk | Impact | Mitigation |',
					'|------|--------|------------|',
					'| (fill in) |  |  |',
				].join('\n'),
			'',
			'## Rollback Strategy',
			'',
			input.rollback?.trim() ||
				'Revert the changes from each phase in reverse order if acceptance fails.',
			'',
		);
	}

	return body.join('\n');
}

/**
 * Build a full plan markdown document (frontmatter + body) for the given tier.
 */
export function buildPlanMarkdown(input: BuildPlanMarkdownInput): string {
	const title = input.title.trim() || 'Untitled plan';
	const complexity: PlanComplexity = input.complexity || 'simple';
	const session = input.session ?? '';
	const created = new Date().toISOString();

	const frontmatterLines = [
		'---',
		'status: draft',
		'current_phase: 0',
		`created: '${created}'`,
		`session: '${escapeYamlString(session)}'`,
		`title: "${escapeYamlString(title)}"`,
		`complexity: ${complexity}`,
		`updated_at: '${created}'`,
		'---',
		'',
	];

	const body = buildPlanBodyMarkdown({
		title,
		complexity,
		context: input.context,
		phases: input.phases,
		analysis: input.analysis,
		risks: input.risks,
		rollback: input.rollback,
		includeAnalysis: input.includeAnalysis,
	});

	return frontmatterLines.join('\n') + body;
}

/** Strip leading yaml frontmatter from a markdown document if present. */
export function stripPlanFrontmatter(markdown: string): string {
	const text = markdown.replace(/^\uFEFF/, '');
	if (!text.startsWith('---')) {
		return text;
	}
	const end = text.indexOf('\n---', 3);
	if (end === -1) {
		return text;
	}
	const after = text.slice(end + 4);
	return after.replace(/^\r?\n/, '');
}

/** kebab-case slug from a title. */
export function slugifyPlanTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return slug || 'plan';
}
