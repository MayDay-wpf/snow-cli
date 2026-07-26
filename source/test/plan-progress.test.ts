import anyTest, {type TestFn} from 'ava';
import {
	formatPlanProgressDetail,
	formatPlanProgressLabel,
} from '../utils/ui/planProgress.js';
import type {PlanDoc} from '../utils/execution/planDocument.js';

const test = anyTest as unknown as TestFn;

function makeDoc(partial?: Partial<PlanDoc>): PlanDoc {
	return {
		filePath: 'E:/code/demo/.snow/plan/2026-07-26/add-auth.md',
		frontmatter: {
			status: 'executing',
			current_phase: 1,
			created: '2026-07-26T00:00:00.000Z',
			session: 'sess-1',
			title: 'Add auth',
			complexity: 'medium',
		},
		title: 'Add auth',
		affectedFiles: ['src/auth.ts'],
		phases: [
			{
				index: 1,
				title: 'Middleware',
				files: ['src/auth.ts'],
				steps: [
					{text: 'Create middleware', checked: true, line: 10},
					{text: 'Wire into app', checked: false, line: 11},
				],
				doneWhen: ['build passes'],
			},
			{
				index: 2,
				title: 'Routes',
				files: ['src/routes.ts'],
				steps: [{text: 'Add login', checked: false, line: 20}],
				doneWhen: ['ok'],
			},
		],
		raw: '# Add auth',
		legacy: false,
		eol: '\n',
		mtimeMs: Date.now(),
		...partial,
	};
}

test('formatPlanProgressLabel shows phase and step counts while executing', t => {
	const label = formatPlanProgressLabel(makeDoc());
	t.is(label, '⚐ Plan P1/2 · 1/2');
});

test('formatPlanProgressLabel shows draft status', t => {
	const label = formatPlanProgressLabel(
		makeDoc({
			frontmatter: {
				status: 'draft',
				current_phase: 0,
				created: '2026-07-26T00:00:00.000Z',
				session: 'sess-1',
			},
		}),
	);
	t.true(label.startsWith('⚐ Plan (draft)'));
	t.true(label.includes('2 phases'));
});

test('formatPlanProgressDetail includes next step', t => {
	const detail = formatPlanProgressDetail(makeDoc());
	t.true(detail.includes('executing'));
	t.true(detail.includes('Add auth'));
	t.true(detail.includes('phase 1/2'));
	t.true(detail.includes('next: Wire into app'));
});
