/**
 * Complexity-tiered plan markdown template generator.
 */

import type {
	PlanComplexity,
	PlanExecutionStrategy,
	PlanPhaseCheck,
} from './planDocument.js';
import {validatePlanCheckCommand} from './planCommandPolicy.js';

export type PlanTemplatePhaseInput = {
	title: string;
	delivers?: string;
	executionStrategy?: PlanExecutionStrategy;
	checks?: PlanPhaseCheck[];
	files?: string[];
	steps?: string[];
	doneWhen?: string;
};

export type PlanDecisionInput = {
	decision: string;
	choice: string;
	reason?: string;
	alternatives?: string[];
};

export type PlanTestSeamInput = {
	seam: string;
	behavior: string;
	testType?: string;
};

export type PlanEvidenceInput = {
	claim: string;
	source: string;
};

export type PlanAdrCandidateInput = {
	decision: string;
	rationale: string;
};

export type PlanBriefInput = {
	problemStatement?: string;
	solution?: string;
	outOfScope?: string[];
	resolvedDecisions?: PlanDecisionInput[];
	testSeams?: PlanTestSeamInput[];
	evidence?: PlanEvidenceInput[];
	adrCandidates?: PlanAdrCandidateInput[];
};

export type BuildPlanMarkdownInput = PlanBriefInput & {
	title: string;
	session?: string;
	complexity?: PlanComplexity;
	acceptancePolicy?: 'standard' | 'strict';
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
		...(phase.delivers?.trim()
			? [`- **Delivers**: ${phase.delivers.trim()}`]
			: []),
		...(phase.executionStrategy
			? [`- **Execution strategy**: ${phase.executionStrategy}`]
			: []),
		'- **Files**:',
		...files.map(f => `  - ${f}`),
		'- **Steps**:',
		...steps.map(s => `  - [ ] ${s}`),
		...(phase.checks && phase.checks.length > 0
			? [
					'- **Checks**:',
					...phase.checks.map(check => {
						if (check.type === 'command') {
							return `  - command: ${check.command}`;
						}

						if (check.type === 'manual') {
							return `  - manual: ${check.description}`;
						}

						return '  - diagnostics';
					}),
			  ]
			: []),
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

	const object = raw as Record<string, unknown>;
	const titleRaw = object['title'];
	const title =
		typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : '';
	if (!title) {
		return null;
	}

	const filesRaw = object['files'];
	const files = Array.isArray(filesRaw)
		? filesRaw.filter(
				(f): f is string => typeof f === 'string' && f.trim().length > 0,
		  )
		: undefined;
	const stepsRaw = object['steps'];
	const steps = Array.isArray(stepsRaw)
		? stepsRaw.filter(
				(s): s is string => typeof s === 'string' && s.trim().length > 0,
		  )
		: undefined;
	const doneWhenRaw = object['doneWhen'];
	const doneWhenSnake = object['done_when'];
	const doneWhen =
		typeof doneWhenRaw === 'string'
			? doneWhenRaw
			: typeof doneWhenSnake === 'string'
			? doneWhenSnake
			: undefined;
	const deliversRaw = object['delivers'];
	const delivers =
		typeof deliversRaw === 'string' ? deliversRaw.trim() : undefined;
	const strategyRaw =
		object['executionStrategy'] ?? object['execution_strategy'];
	const executionStrategy =
		strategyRaw === 'standard' || strategyRaw === 'tdd'
			? strategyRaw
			: undefined;
	const checksRaw = object['checks'];
	const checks: PlanPhaseCheck[] = [];
	if (Array.isArray(checksRaw)) {
		for (const rawCheck of checksRaw) {
			if (
				!rawCheck ||
				typeof rawCheck !== 'object' ||
				Array.isArray(rawCheck)
			) {
				continue;
			}

			const check = rawCheck as Record<string, unknown>;
			if (check['type'] === 'diagnostics') {
				checks.push({type: 'diagnostics'});
			} else if (
				check['type'] === 'command' &&
				typeof check['command'] === 'string' &&
				check['command'].trim()
			) {
				checks.push({type: 'command', command: check['command'].trim()});
			} else if (
				check['type'] === 'manual' &&
				typeof check['description'] === 'string' &&
				check['description'].trim()
			) {
				checks.push({
					type: 'manual',
					description: check['description'].trim(),
				});
			}
		}
	}

	return {
		title,
		...(delivers ? {delivers} : {}),
		...(executionStrategy ? {executionStrategy} : {}),
		...(checks.length > 0 ? {checks} : {}),
		...(files && files.length > 0 ? {files} : {}),
		...(steps && steps.length > 0 ? {steps} : {}),
		...(doneWhen?.trim() ? {doneWhen: doneWhen.trim()} : {}),
	};
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value
		.map(item => nonEmptyString(item))
		.filter((item): item is string => Boolean(item));
	return items.length > 0 ? items : undefined;
}

function objectArray<T>(
	value: unknown,
	parse: (item: Record<string, unknown>) => T | null,
): T[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items: T[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
		const parsed = parse(raw as Record<string, unknown>);
		if (parsed) items.push(parsed);
	}

	return items.length > 0 ? items : undefined;
}

/** Normalize plan-manage structured brief fields from JSON tool arguments. */
export function parsePlanBriefArgs(raw: unknown): PlanBriefInput {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const object = raw as Record<string, unknown>;
	const problemStatement = nonEmptyString(
		object['problem_statement'] ?? object['problemStatement'],
	);
	const solution = nonEmptyString(object['solution']);
	const outOfScope = stringArray(
		object['out_of_scope'] ?? object['outOfScope'],
	);
	const resolvedDecisions = objectArray(
		object['resolved_decisions'] ?? object['resolvedDecisions'],
		item => {
			const decision = nonEmptyString(item['decision']);
			const choice = nonEmptyString(item['choice']);
			if (!decision || !choice) return null;
			const reason = nonEmptyString(item['reason']);
			const alternatives = stringArray(item['alternatives']);
			return {
				decision,
				choice,
				...(reason ? {reason} : {}),
				...(alternatives ? {alternatives} : {}),
			};
		},
	);
	const testSeams = objectArray(
		object['test_seams'] ?? object['testSeams'],
		item => {
			const seam = nonEmptyString(item['seam']);
			const behavior = nonEmptyString(item['behavior']);
			if (!seam || !behavior) return null;
			const testType = nonEmptyString(item['test_type'] ?? item['testType']);
			return {
				seam,
				behavior,
				...(testType ? {testType} : {}),
			};
		},
	);
	const evidence = objectArray(object['evidence'], item => {
		const claim = nonEmptyString(item['claim']);
		const source = nonEmptyString(item['source']);
		return claim && source ? {claim, source} : null;
	});
	const adrCandidates = objectArray(
		object['adr_candidates'] ?? object['adrCandidates'],
		item => {
			const decision = nonEmptyString(item['decision']);
			const rationale = nonEmptyString(item['rationale']);
			return decision && rationale ? {decision, rationale} : null;
		},
	);
	return {
		...(problemStatement ? {problemStatement} : {}),
		...(solution ? {solution} : {}),
		...(outOfScope ? {outOfScope} : {}),
		...(resolvedDecisions ? {resolvedDecisions} : {}),
		...(testSeams ? {testSeams} : {}),
		...(evidence ? {evidence} : {}),
		...(adrCandidates ? {adrCandidates} : {}),
	};
}

/** Validate structured JSON before tolerant normalization drops malformed data. */
export function validatePlanStructuredArgs(raw: unknown): string[] {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
	const object = raw as Record<string, unknown>;
	const errors: string[] = [];
	if (
		object['acceptance_policy'] !== undefined &&
		object['acceptance_policy'] !== 'standard' &&
		object['acceptance_policy'] !== 'strict'
	) {
		errors.push('acceptance_policy: expected standard|strict');
	}

	const validateObjectArray = (field: string, required: string[]) => {
		const value = object[field];
		if (value === undefined) return;
		if (!Array.isArray(value)) {
			errors.push(`${field}: expected an array`);
			return;
		}

		for (const [index, item] of value.entries()) {
			if (!item || typeof item !== 'object' || Array.isArray(item)) {
				errors.push(`${field}[${index}]: expected an object`);
				continue;
			}

			for (const key of required) {
				if (!nonEmptyString((item as Record<string, unknown>)[key])) {
					errors.push(`${field}[${index}].${key}: required string`);
				}
			}
		}
	};

	if (object['out_of_scope'] !== undefined) {
		if (!Array.isArray(object['out_of_scope'])) {
			errors.push('out_of_scope: expected an array');
		} else {
			for (const [index, value] of object['out_of_scope'].entries()) {
				if (!nonEmptyString(value)) {
					errors.push(`out_of_scope[${index}]: required string`);
				}
			}
		}
	}

	validateObjectArray('resolved_decisions', ['decision', 'choice']);
	validateObjectArray('test_seams', ['seam', 'behavior']);
	validateObjectArray('evidence', ['claim', 'source']);
	validateObjectArray('adr_candidates', ['decision', 'rationale']);

	if (object['phases'] !== undefined) {
		if (!Array.isArray(object['phases'])) {
			errors.push('phases: expected an array');
		} else {
			for (const [phaseIndex, rawPhase] of object['phases'].entries()) {
				if (
					!rawPhase ||
					typeof rawPhase !== 'object' ||
					Array.isArray(rawPhase)
				) {
					errors.push(`phases[${phaseIndex}]: expected an object`);
					continue;
				}

				const phase = rawPhase as Record<string, unknown>;
				if (!nonEmptyString(phase['title'])) {
					errors.push(`phases[${phaseIndex}].title: required string`);
				}

				const strategy =
					phase['executionStrategy'] ?? phase['execution_strategy'];
				if (
					strategy !== undefined &&
					strategy !== 'standard' &&
					strategy !== 'tdd'
				) {
					errors.push(
						`phases[${phaseIndex}].executionStrategy: expected standard|tdd`,
					);
				}

				if (phase['checks'] !== undefined) {
					if (!Array.isArray(phase['checks'])) {
						errors.push(`phases[${phaseIndex}].checks: expected an array`);
					} else {
						for (const [checkIndex, rawCheck] of phase['checks'].entries()) {
							const prefix = `phases[${phaseIndex}].checks[${checkIndex}]`;
							if (
								!rawCheck ||
								typeof rawCheck !== 'object' ||
								Array.isArray(rawCheck)
							) {
								errors.push(`${prefix}: expected an object`);
								continue;
							}

							const check = rawCheck as Record<string, unknown>;
							if (
								!['command', 'diagnostics', 'manual'].includes(
									String(check['type']),
								)
							) {
								errors.push(
									`${prefix}.type: expected command|diagnostics|manual`,
								);
							} else if (
								check['type'] === 'command' &&
								!nonEmptyString(check['command'])
							) {
								errors.push(`${prefix}.command: required string`);
							} else if (check['type'] === 'command') {
								const command = nonEmptyString(check['command'])!;
								const policyError = validatePlanCheckCommand(command);
								if (policyError) {
									errors.push(`${prefix}.command: ${policyError}`);
								}
							} else if (
								check['type'] === 'manual' &&
								!nonEmptyString(check['description'])
							) {
								errors.push(`${prefix}.description: required string`);
							}
						}
					}
				}
			}
		}
	}

	return errors;
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
	if (input.problemStatement?.trim()) {
		body.push('## Problem Statement', '', input.problemStatement.trim(), '');
	}

	if (input.solution?.trim()) {
		body.push('## Solution', '', input.solution.trim(), '');
	}

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

	if (input.resolvedDecisions && input.resolvedDecisions.length > 0) {
		body.push('## Resolved Decisions', '');
		for (const item of input.resolvedDecisions) {
			body.push(
				`- **Decision**: ${item.decision}`,
				`  - **Choice**: ${item.choice}`,
			);
			if (item.reason) body.push(`  - **Reason**: ${item.reason}`);
			if (item.alternatives && item.alternatives.length > 0) {
				body.push(
					`  - **Alternatives rejected**: ${item.alternatives.join('; ')}`,
				);
			}
		}

		body.push('');
	}

	if (input.testSeams && input.testSeams.length > 0) {
		body.push('## Test Seams', '');
		for (const item of input.testSeams) {
			body.push(
				`- **${item.seam}**: ${item.behavior}${
					item.testType ? ` (${item.testType})` : ''
				}`,
			);
		}

		body.push('');
	}

	if (input.evidence && input.evidence.length > 0) {
		body.push('## Evidence', '');
		for (const item of input.evidence) {
			body.push(`- ${item.claim} - ${item.source}`);
		}

		body.push('');
	}

	if (input.adrCandidates && input.adrCandidates.length > 0) {
		body.push('## ADR Candidates', '');
		for (const item of input.adrCandidates) {
			body.push(`- **${item.decision}**: ${item.rationale}`);
		}

		body.push('');
	}

	if (input.outOfScope && input.outOfScope.length > 0) {
		body.push(
			'## Out of Scope',
			'',
			...input.outOfScope.map(x => `- ${x}`),
			'',
		);
	}

	body.push('## Phases', '');
	for (const [i, phase] of phases.entries()) {
		body.push(renderPhase(i + 1, phase));
	}

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
	const acceptancePolicy = input.acceptancePolicy ?? 'standard';
	const created = new Date().toISOString();

	const frontmatterLines = [
		'---',
		'status: draft',
		'current_phase: 0',
		`created: '${created}'`,
		`session: '${escapeYamlString(session)}'`,
		`title: "${escapeYamlString(title)}"`,
		`complexity: ${complexity}`,
		`acceptance_policy: ${acceptancePolicy}`,
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
		problemStatement: input.problemStatement,
		solution: input.solution,
		outOfScope: input.outOfScope,
		resolvedDecisions: input.resolvedDecisions,
		testSeams: input.testSeams,
		evidence: input.evidence,
		adrCandidates: input.adrCandidates,
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

/** Kebab-case slug from a title. */
export function slugifyPlanTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z\d\u4E00-\u9FFF]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return slug || 'plan';
}

export {type PlanComplexity} from './planDocument.js';
