import anyTest, {type TestFn} from 'ava';
import {
	buildPlanMarkdown,
	slugifyPlanTitle,
} from '../utils/execution/planTemplate.js';
import {
	normalizeFrontmatter,
	parsePhasesFromMarkdown,
	validatePlanDocument,
	type PlanDoc,
} from '../utils/execution/planDocument.js';
import matter from 'gray-matter';

const test = anyTest as unknown as TestFn;

test('slugifyPlanTitle produces kebab-case', t => {
	t.is(slugifyPlanTitle('Add JWT Auth!'), 'add-jwt-auth');
	t.is(slugifyPlanTitle('  '), 'plan');
});

test('buildPlanMarkdown simple has context + one phase', t => {
	const md = buildPlanMarkdown({title: 'Demo', complexity: 'simple'});
	const parsed = matter(md);
	const fm = normalizeFrontmatter(parsed.data);
	t.is(fm.status, 'draft');
	t.is(fm.complexity, 'simple');
	t.is(fm.title, 'Demo');
	t.true(md.includes('## Context'));
	t.false(md.includes('## Analysis'));
	t.false(md.includes('## Risks'));
	const {phases} = parsePhasesFromMarkdown(parsed.content);
	t.is(phases.length, 1);
	t.true(phases[0]!.steps.length >= 1);
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
