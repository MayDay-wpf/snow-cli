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
		phase.steps && phase.steps.length > 0
			? phase.steps
			: ['Implement changes'];
	const doneWhen = phase.doneWhen?.trim() || 'build passes; no diagnostic errors';

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

/**
 * Build a full plan markdown document (frontmatter + body) for the given tier.
 */
export function buildPlanMarkdown(input: BuildPlanMarkdownInput): string {
	const title = input.title.trim() || 'Untitled plan';
	const complexity: PlanComplexity = input.complexity || 'simple';
	const session = input.session ?? '';
	const created = new Date().toISOString();
	const context =
		input.context?.trim() ||
		`Plan for: ${title}`;

	const phases = defaultPhases(title, complexity, input.phases);
	const allFiles = [
		...new Set(phases.flatMap(p => p.files ?? []).filter(Boolean)),
	];

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

	const body: string[] = [`# ${title}`, '', '## Context', '', context, ''];

	if (complexity === 'medium' || complexity === 'complex') {
		body.push('## Analysis', '');
		if (allFiles.length > 0) {
			body.push('- **Affected files**:');
			for (const file of allFiles) {
				body.push(`  - ${file}`);
			}
		} else {
			body.push('- **Affected files**: (fill in after exploration)');
		}
		body.push('');
	}

	body.push('## Phases', '');
	phases.forEach((phase, i) => {
		body.push(renderPhase(i + 1, phase));
	});

	if (complexity === 'complex') {
		body.push(
			'## Risks & Mitigations',
			'',
			'| Risk | Impact | Mitigation |',
			'|------|--------|------------|',
			'| (fill in) |  |  |',
			'',
			'## Rollback Strategy',
			'',
			'Revert the changes from each phase in reverse order if acceptance fails.',
			'',
		);
	}

	return frontmatterLines.join('\n') + body.join('\n');
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
