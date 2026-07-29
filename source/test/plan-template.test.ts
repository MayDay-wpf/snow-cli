import anyTest, {type TestFn} from 'ava';
import matter from 'gray-matter';
import {
	buildPlanMarkdown,
	parsePlanBriefArgs,
	parsePlanPhasesArg,
	slugifyPlanTitle,
	stripPlanFrontmatter,
	validatePlanStructuredArgs,
} from '../utils/execution/planTemplate.js';
import {
	normalizeFrontmatter,
	parsePhasesFromMarkdown,
	validatePlanDocument,
	type PlanDoc,
} from '../utils/execution/planDocument.js';

const test = anyTest as unknown as TestFn;

test('slugifyPlanTitle produces kebab-case', t => {
	t.is(slugifyPlanTitle('Add JWT Auth!'), 'add-jwt-auth');
	t.is(slugifyPlanTitle('  '), 'plan');
});

test('stripPlanFrontmatter removes leading yaml only', t => {
	const withFm = `---
status: draft
title: "Demo"
---
# Demo

## Context

hello
`;
	t.is(stripPlanFrontmatter(withFm).trimStart().startsWith('# Demo'), true);
	t.false(stripPlanFrontmatter(withFm).includes('status: draft'));

	const bare = '# Already body\n\ncontent';
	t.is(stripPlanFrontmatter(bare), bare);

	const noClose = '---\nstatus: draft\n# incomplete';
	t.is(stripPlanFrontmatter(noClose), noClose);
});

test('parsePlanPhasesArg normalizes valid phases and drops junk', t => {
	const phases = parsePlanPhasesArg([
		{
			title: 'Implement',
			delivers: '  visible behavior  ',
			execution_strategy: 'tdd',
			checks: [
				{type: 'command', command: '  npm test  '},
				{type: 'diagnostics'},
				{type: 'manual', description: '  inspect output  '},
				{type: 'unknown'},
			],
			files: ['src/a.ts', '', 42],
			steps: ['do work', null],
			done_when: 'tests pass',
		},
		{title: '  '},
		'not-an-object',
		{title: 'Verify', steps: ['check'], doneWhen: 'build passes'},
	]);
	t.is(phases.length, 2);
	t.deepEqual(phases[0], {
		title: 'Implement',
		delivers: 'visible behavior',
		executionStrategy: 'tdd',
		checks: [
			{type: 'command', command: 'npm test'},
			{type: 'diagnostics'},
			{type: 'manual', description: 'inspect output'},
		],
		files: ['src/a.ts'],
		steps: ['do work'],
		doneWhen: 'tests pass',
	});
	t.deepEqual(phases[1], {
		title: 'Verify',
		steps: ['check'],
		doneWhen: 'build passes',
	});
	t.deepEqual(parsePlanPhasesArg(undefined), []);
	t.deepEqual(parsePlanPhasesArg({title: 'x'}), []);
});

test('parsePlanBriefArgs normalizes JSON fields and drops incomplete items', t => {
	const brief = parsePlanBriefArgs({
		problem_statement: '  Users cannot inspect plans  ',
		solution: 'Render structured input as Markdown',
		out_of_scope: ['DAG scheduling', '', 42],
		resolved_decisions: [
			{
				decision: 'Storage format',
				choice: 'Markdown',
				reason: 'Human-readable',
				alternatives: ['JSON files', ''],
			},
			{decision: 'Missing choice'},
		],
		test_seams: [
			{
				seam: 'plan-manage',
				behavior: 'creates a plan',
				test_type: 'integration',
			},
			{seam: '', behavior: 'ignored'},
		],
		evidence: [{claim: 'Plans are Markdown', source: 'planDocument.ts'}],
		adr_candidates: [
			{
				decision: 'Keep linear phases',
				rationale: 'State machine compatibility',
			},
		],
	});

	t.deepEqual(brief, {
		problemStatement: 'Users cannot inspect plans',
		solution: 'Render structured input as Markdown',
		outOfScope: ['DAG scheduling'],
		resolvedDecisions: [
			{
				decision: 'Storage format',
				choice: 'Markdown',
				reason: 'Human-readable',
				alternatives: ['JSON files'],
			},
		],
		testSeams: [
			{
				seam: 'plan-manage',
				behavior: 'creates a plan',
				testType: 'integration',
			},
		],
		evidence: [{claim: 'Plans are Markdown', source: 'planDocument.ts'}],
		adrCandidates: [
			{
				decision: 'Keep linear phases',
				rationale: 'State machine compatibility',
			},
		],
	});
});

test('validatePlanStructuredArgs reports precise malformed JSON paths', t => {
	const errors = validatePlanStructuredArgs({
		out_of_scope: ['valid', 42],
		test_seams: [{seam: 'api'}],
		phases: [
			{
				title: 'TDD slice',
				executionStrategy: 'fast',
				checks: [{type: 'command'}, {type: 'manual'}, {type: 'mystery'}],
			},
		],
	});
	t.true(errors.includes('out_of_scope[1]: required string'));
	t.true(errors.includes('test_seams[0].behavior: required string'));
	t.true(errors.includes('phases[0].executionStrategy: expected standard|tdd'));
	t.true(errors.includes('phases[0].checks[0].command: required string'));
	t.true(errors.includes('phases[0].checks[1].description: required string'));
	t.true(
		errors.includes(
			'phases[0].checks[2].type: expected command|diagnostics|manual',
		),
	);
	t.true(
		validatePlanStructuredArgs({acceptance_policy: 'eventually'}).includes(
			'acceptance_policy: expected standard|strict',
		),
	);
	t.true(
		validatePlanStructuredArgs({
			phases: [
				{
					title: 'Unsafe',
					checks: [{type: 'command', command: 'npm test > result.txt'}],
				},
			],
		}).some(error => error.includes('shell control operator')),
	);
});

test('buildPlanMarkdown simple has context + one phase', t => {
	const md = buildPlanMarkdown({title: 'Demo', complexity: 'simple'});
	const parsed = matter(md);
	const fm = normalizeFrontmatter(parsed.data);
	t.is(fm.status, 'draft');
	t.is(fm.complexity, 'simple');
	t.is(fm.acceptance_policy, 'standard');
	t.is(fm.title, 'Demo');
	t.true(md.includes('## Context'));
	t.false(md.includes('## Analysis'));
	t.false(md.includes('## Risks'));
	const {phases} = parsePhasesFromMarkdown(parsed.content);
	t.is(phases.length, 1);
	t.true(phases[0]!.steps.length > 0);
});

test('buildPlanMarkdown persists strict acceptance policy', t => {
	const parsed = matter(
		buildPlanMarkdown({title: 'Strict plan', acceptancePolicy: 'strict'}),
	);
	t.is(normalizeFrontmatter(parsed.data).acceptance_policy, 'strict');
});

test('buildPlanMarkdown medium adds analysis', t => {
	const md = buildPlanMarkdown({
		title: 'Medium plan',
		complexity: 'medium',
		phases: [
			{
				title: 'Implement',
				files: ['src/a.ts'],
				steps: ['do work'],
			},
		],
	});
	t.true(md.includes('## Analysis'));
	t.true(md.includes('src/a.ts'));
	t.false(md.includes('## Rollback'));
});

test('buildPlanMarkdown accepts custom analysis/risks text', t => {
	const md = buildPlanMarkdown({
		title: 'Custom sections',
		complexity: 'simple',
		analysis: 'Custom analysis body with **bold**.',
		risks: 'Custom risk: migrations may fail.',
		rollback: 'Restore previous config snapshot.',
		phases: [
			{
				title: 'Ship',
				files: ['src/feature.ts (new)'],
				steps: ['land change'],
				doneWhen: 'build passes',
			},
		],
	});
	t.true(md.includes('## Analysis'));
	t.true(md.includes('Custom analysis body with **bold**.'));
	t.true(md.includes('## Risks & Mitigations'));
	t.true(md.includes('Custom risk: migrations may fail.'));
	t.true(md.includes('## Rollback Strategy'));
	t.true(md.includes('Restore previous config snapshot.'));
	// Custom analysis replaces the default affected-files bullet list.
	t.false(md.includes('- **Affected files**:'));
});

test('buildPlanMarkdown renders structured brief and phase strategy', t => {
	const md = buildPlanMarkdown({
		title: 'Structured plan',
		problemStatement: 'Planning facts are easy to lose.',
		solution: 'Accept structured JSON and render stable Markdown.',
		resolvedDecisions: [
			{
				decision: 'Persistence',
				choice: 'Markdown',
				reason: 'Preserve review workflows',
				alternatives: ['JSON-only files'],
			},
		],
		testSeams: [
			{
				seam: 'plan-manage',
				behavior: 'round-trips phase metadata',
				testType: 'AVA',
			},
		],
		evidence: [
			{claim: 'The parser consumes Markdown', source: 'planDocument.ts'},
		],
		adrCandidates: [
			{
				decision: 'Remain linear',
				rationale: 'Changing the state machine is costly',
			},
		],
		outOfScope: ['DAG execution'],
		phases: [
			{
				title: 'Vertical slice',
				delivers: 'A structured plan can be created and read back',
				executionStrategy: 'tdd',
				checks: [
					{
						type: 'command',
						command: 'npx ava source/test/plan-template.test.ts',
					},
					{type: 'diagnostics'},
				],
				steps: ['add the behavior'],
				doneWhen: 'tests pass',
			},
		],
	});

	for (const heading of [
		'## Problem Statement',
		'## Solution',
		'## Resolved Decisions',
		'## Test Seams',
		'## Evidence',
		'## ADR Candidates',
		'## Out of Scope',
	]) {
		t.true(md.includes(heading));
	}

	t.true(md.includes('The parser consumes Markdown - planDocument.ts'));
	const {phases} = parsePhasesFromMarkdown(matter(md).content);
	t.is(phases[0]!.delivers, 'A structured plan can be created and read back');
	t.is(phases[0]!.executionStrategy, 'tdd');
	t.deepEqual(phases[0]!.checks, [
		{
			type: 'command',
			command: 'npx ava source/test/plan-template.test.ts',
		},
		{type: 'diagnostics'},
	]);
});

test('buildPlanMarkdown complex pads second phase and risks/rollback', t => {
	const md = buildPlanMarkdown({
		title: 'Complex plan',
		complexity: 'complex',
		phases: [{title: 'Implement', steps: ['code']}],
	});
	const parsed = matter(md);
	const {phases} = parsePhasesFromMarkdown(parsed.content);
	t.true(phases.length >= 2);
	t.true(md.includes('## Risks & Mitigations'));
	t.true(md.includes('## Rollback Strategy'));

	const doc: PlanDoc = {
		filePath: 'x.md',
		frontmatter: normalizeFrontmatter(parsed.data),
		title: 'Complex plan',
		affectedFiles: [],
		phases,
		raw: parsed.content,
		legacy: false,
		eol: '\n',
		mtimeMs: 0,
	};
	const issues = validatePlanDocument(doc, process.cwd()).filter(
		i => i.code === 'complex_missing_sections',
	);
	t.deepEqual(issues, []);
});
