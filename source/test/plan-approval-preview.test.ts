import anyTest, {type TestFn} from 'ava';
import {
	formatPlanApprovalPreview,
	isPlanApprovalQuestion,
} from '../utils/ui/planApprovalPreview.js';
import type {PlanDoc} from '../utils/execution/planDocument.js';

const test = anyTest as unknown as TestFn;

function makeDoc(partial?: Partial<PlanDoc>): PlanDoc {
	return {
		filePath: 'E:/code/demo/.snow/plan/2026-07-26/add-auth.md',
		frontmatter: {
			status: 'draft',
			current_phase: 0,
			created: '2026-07-26T00:00:00.000Z',
			session: 'sess-1',
			title: 'Add auth',
			complexity: 'medium',
		},
		title: 'Add auth',
		affectedFiles: ['src/auth.ts', 'src/middleware/auth.ts (new)'],
		phases: [
			{
				index: 1,
				title: 'Middleware',
				files: ['src/middleware/auth.ts (new)'],
				steps: [
					{text: 'Create middleware', checked: false, line: 10},
					{text: 'Wire into app', checked: false, line: 11},
				],
				doneWhen: ['build passes'],
			},
			{
				index: 2,
				title: 'Login endpoints',
				files: ['src/routes/login.ts (new)', 'src/auth.ts'],
				steps: [{text: 'Add login route', checked: false, line: 20}],
				doneWhen: ['login works'],
			},
		],
		raw: '# Add auth',
		legacy: false,
		eol: '\n',
		mtimeMs: Date.now(),
		...partial,
	};
}

test('isPlanApprovalQuestion matches plan-related prompts', t => {
	t.true(
		isPlanApprovalQuestion(
			'Implementation plan created at .snow/plan/2026-07-26/add-auth.md. Proceed?',
		),
	);
	t.true(isPlanApprovalQuestion('计划已写好，是否执行整个计划？'));
	t.true(isPlanApprovalQuestion('Continue this plan or start over?'));
	t.false(isPlanApprovalQuestion('Which color theme do you prefer?'));
	t.false(isPlanApprovalQuestion(''));
	t.false(isPlanApprovalQuestion(undefined));
});

test('formatPlanApprovalPreview shows title, path, phases and steps', t => {
	const text = formatPlanApprovalPreview(makeDoc());
	t.true(text.includes('📋 Plan Document'));
	t.true(text.includes('Title: Add auth'));
	t.true(text.includes('Status: draft · Complexity: medium · Phases: 2'));
	t.true(text.includes('add-auth.md') || text.includes('Path:'));
	t.true(text.includes('### Phase 1: Middleware'));
	t.true(text.includes('[ ] Create middleware'));
	t.true(text.includes('### Phase 2: Login endpoints'));
	t.true(text.includes('Done when: build passes'));
	t.true(text.includes('auth.ts'));
});

test('formatPlanApprovalPreview truncates long step lists', t => {
	const steps = Array.from({length: 12}, (_, i) => ({
		text: `Step ${i + 1}`,
		checked: false,
		line: i,
	}));
	const text = formatPlanApprovalPreview(
		makeDoc({
			phases: [
				{
					index: 1,
					title: 'Big phase',
					files: [],
					steps,
					doneWhen: ['ok'],
				},
			],
		}),
		{maxStepsPerPhase: 3},
	);
	t.true(text.includes('[ ] Step 1'));
	t.true(text.includes('[ ] Step 3'));
	t.false(text.includes('[ ] Step 4'));
	t.true(text.includes('+9 more steps'));
});

test('formatPlanApprovalPreview handles empty phases', t => {
	const text = formatPlanApprovalPreview(makeDoc({phases: []}));
	t.true(text.includes('No ### Phase N sections'));
});
