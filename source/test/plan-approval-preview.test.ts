import anyTest, {type TestFn} from 'ava';
import {
	computePlanPreviewScrollWindow,
	computePlanPreviewVisibleRows,
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
			acceptance_policy: 'strict',
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
				checks: [
					{type: 'command', command: 'npm test'},
					{type: 'diagnostics'},
					{type: 'manual', description: 'verify login flow'},
				],
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
	t.true(text.includes('Acceptance policy: strict'));
	t.true(
		text.includes(
			'Evidence: E:/code/demo/.snow/plan/2026-07-26/add-auth.md.evidence.json',
		),
	);
	t.true(text.includes('add-auth.md') || text.includes('Path:'));
	t.true(text.includes('### Phase 1: Middleware'));
	t.true(text.includes('[ ] Create middleware'));
	t.true(text.includes('### Phase 2: Login endpoints'));
	t.true(text.includes('Done when: build passes'));
	t.true(text.includes('Checks:'));
	t.true(text.includes('command: npm test'));
	t.true(text.includes('diagnostics'));
	t.true(text.includes('manual: verify login flow'));
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

test('computePlanPreviewVisibleRows clamps by terminal size', t => {
	t.is(computePlanPreviewVisibleRows(40), 16);
	t.is(computePlanPreviewVisibleRows(30), 12);
	t.is(computePlanPreviewVisibleRows(20), 8);
	t.is(computePlanPreviewVisibleRows(5), 8);
	t.is(
		computePlanPreviewVisibleRows(50, {
			minRows: 4,
			maxRows: 10,
			reservedRows: 10,
		}),
		10,
	);
	t.is(computePlanPreviewVisibleRows(Number.NaN), 8);
});

test('computePlanPreviewScrollWindow short content does not scroll', t => {
	const window = computePlanPreviewScrollWindow(5, 0, 10);
	t.false(window.canScroll);
	t.is(window.clampedOffset, 0);
	t.is(window.visibleStart, 0);
	t.is(window.visibleEnd, 5);
	t.is(window.hiddenAbove, 0);
	t.is(window.hiddenBelow, 0);
});

test('computePlanPreviewScrollWindow clamps long content and offset', t => {
	const window = computePlanPreviewScrollWindow(30, 100, 10);
	t.true(window.canScroll);
	t.is(window.clampedOffset, 20);
	t.is(window.visibleStart, 20);
	t.is(window.visibleEnd, 30);
	t.is(window.hiddenAbove, 20);
	t.is(window.hiddenBelow, 0);

	const mid = computePlanPreviewScrollWindow(30, 5, 10);
	t.is(mid.clampedOffset, 5);
	t.is(mid.visibleEnd, 15);
	t.is(mid.hiddenAbove, 5);
	t.is(mid.hiddenBelow, 15);

	const resized = computePlanPreviewScrollWindow(12, 8, 16);
	t.false(resized.canScroll);
	t.is(resized.clampedOffset, 0);
	t.is(resized.visibleEnd, 12);
});
