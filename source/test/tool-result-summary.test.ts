import anyTest, {type TestFn} from 'ava';

import {getToolResultSummary} from '../utils/ui/toolResultSummary.js';

const test = anyTest as unknown as TestFn;
const dot = '\u00b7';
const arrow = '\u2192';

test('filesystem-read summary includes basename and line count', t => {
	const result = JSON.stringify({
		content: 'a\nb\nc',
		startLine: 1,
		endLine: 3,
		totalLines: 3,
	});
	const summary = getToolResultSummary('filesystem-read', result, {
		displayArgs: [
			{
				key: 'filePath',
				value: '"E:\\code\\snow-cli\\source\\ui\\MessageRenderer.tsx"',
			},
		],
	});
	t.is(summary, `MessageRenderer.tsx ${dot} 3 lines`);
});

test('filesystem-read summary falls back to line count without path context', t => {
	const result = JSON.stringify({content: 'one\ntwo'});
	const summary = getToolResultSummary('filesystem-read', result);
	t.is(summary, '2 lines');
});

test('filesystem-read batch summary uses file names from rawArgs', t => {
	const result = JSON.stringify({
		content: [
			{type: 'text', text: 'a'},
			{type: 'text', text: 'b'},
		],
		totalFiles: 2,
	});
	const summary = getToolResultSummary('filesystem-read', result, {
		rawArgs: {
			filePath: ['a/MessageRenderer.tsx', 'b/StatusLine.tsx'],
		},
	});
	t.is(summary, 'MessageRenderer.tsx, StatusLine.tsx');
});

test('plan-manage check_step remaining summary', t => {
	const text =
		'Step 2 checked. Remaining steps in phase 1: polish UI | write tests';
	const summary = getToolResultSummary('plan-manage', text, {
		displayArgs: [{key: 'action', value: '"check_step"'}],
	});
	t.is(summary, `P1 S2 checked ${dot} 2 left`);
});

test('plan-manage check_step phase done summary', t => {
	const text =
		'Step 3 checked. All steps of phase 2 are done - call plan-manage complete_phase';
	const summary = getToolResultSummary('plan-manage', text);
	t.is(summary, `P2 S3 checked ${dot} phase done`);
});

test('plan-manage complete_phase advance summary', t => {
	const text =
		'Phase 1 accepted (build ok). Now on phase 2: Update prompts and docs.\nSteps:\n- [ ] a';
	const summary = getToolResultSummary('plan-manage', text);
	t.is(summary, `P1 accepted ${arrow} P2 Update prompts and docs`);
});

test('plan-manage acceptance failed summary', t => {
	const text =
		'Phase 3 acceptance FAILED - fix the issues and call complete_phase again.\nerror';
	const summary = getToolResultSummary('plan-manage', text);
	t.is(summary, 'P3 acceptance failed');
});

test('plan-manage amend summary', t => {
	const text = 'Plan amended (phase 2): +2 files, +1 steps. Scope refreshed.';
	const summary = getToolResultSummary('plan-manage', text);
	t.is(summary, `P2 amended ${dot} +2 files ${dot} +1 steps`);
});
