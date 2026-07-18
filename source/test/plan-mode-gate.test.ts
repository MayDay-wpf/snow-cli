import anyTest, {type TestFn} from 'ava';
import path from 'node:path';

import {
	classifyPlanGateDecision,
	collectFilesystemPaths,
	evaluatePlanGate,
	getPlanApproved,
	isAllowedUnapprovedWritePath,
	isPlanApprovalAnswer,
	isPlanDirPath,
	isTrellisTasksDirPath,
	maybeApprovePlanFromAskUser,
	onPlanModeChange,
	resetAllPlanGates,
	resetPlanGate,
	setPlanApproved,
} from '../utils/execution/planModeGate.js';

const test = anyTest as unknown as TestFn;

test.beforeEach(() => {
	resetAllPlanGates();
});

test('isPlanDirPath allows .snow/plan and subpaths', t => {
	const cwd = process.cwd();
	t.true(isPlanDirPath('.snow/plan/demo.md', cwd));
	t.true(isPlanDirPath(path.join('.snow', 'plan', 'a', 'b.md'), cwd));
	t.true(isPlanDirPath(path.resolve(cwd, '.snow/plan/x.md'), cwd));
});

test('isPlanDirPath rejects business paths and escape', t => {
	const cwd = process.cwd();
	t.false(isPlanDirPath('src/app.ts', cwd));
	t.false(isPlanDirPath('.snow/other.md', cwd));
	t.false(isPlanDirPath('.snow/plan/../secrets.txt', cwd));
	t.false(isPlanDirPath('../../../etc/passwd', cwd));
});

test('isTrellisTasksDirPath allows task artifacts and rejects escape', t => {
	const cwd = process.cwd();
	t.true(isTrellisTasksDirPath('.trellis/tasks/07-18-demo/prd.md', cwd));
	t.true(
		isTrellisTasksDirPath(
			path.join('.trellis', 'tasks', 'x', 'design.md'),
			cwd,
		),
	);
	t.false(isTrellisTasksDirPath('.trellis/spec/index.md', cwd));
	t.false(isTrellisTasksDirPath('.trellis/tasks/../secrets.txt', cwd));
	t.false(isAllowedUnapprovedWritePath('src/app.ts', cwd));
	t.true(isAllowedUnapprovedWritePath('.snow/plan/x.md', cwd));
	t.true(isAllowedUnapprovedWritePath('.trellis/tasks/x/prd.md', cwd));
});

test('collectFilesystemPaths supports string and batch forms', t => {
	t.deepEqual(collectFilesystemPaths({filePath: 'a.md'}), ['a.md']);
	t.deepEqual(collectFilesystemPaths({filePath: ['a.md', 'b.md']}), [
		'a.md',
		'b.md',
	]);
	t.deepEqual(
		collectFilesystemPaths({
			filePath: [
				{path: 'p1.md', content: 'x'},
				{path: 'p2.md', content: 'y'},
			],
		}),
		['p1.md', 'p2.md'],
	);
});

test('classify allows planning tools and plan writes', t => {
	const cwd = process.cwd();
	t.is(classifyPlanGateDecision('filesystem-read', {}, cwd), 'allow');
	t.is(classifyPlanGateDecision('ace-search', {}, cwd), 'allow');
	t.is(classifyPlanGateDecision('skill-execute', {}, cwd), 'allow');
	t.is(classifyPlanGateDecision('askuser-ask_question', {}, cwd), 'allow');
	t.is(
		classifyPlanGateDecision(
			'filesystem-create',
			{filePath: '.snow/plan/x.md', content: '# plan'},
			cwd,
		),
		'allow',
	);
	t.is(
		classifyPlanGateDecision(
			'filesystem-create',
			{filePath: '.trellis/tasks/demo/prd.md', content: '# prd'},
			cwd,
		),
		'allow',
	);
	t.is(
		classifyPlanGateDecision(
			'filesystem-replaceedit',
			{
				filePath: '.trellis/tasks/demo/implement.md',
				searchContent: 'a',
				replaceContent: 'b',
			},
			cwd,
		),
		'allow',
	);
	t.is(
		classifyPlanGateDecision('subagent-agent_explore', {prompt: 'x'}, cwd),
		'allow',
	);
});

test('classify blocks business writes, terminal, general agent', t => {
	const cwd = process.cwd();
	t.is(
		classifyPlanGateDecision(
			'filesystem-create',
			{filePath: 'src/a.ts', content: 'x'},
			cwd,
		),
		'block',
	);
	t.is(
		classifyPlanGateDecision('terminal-execute', {command: 'npm test'}, cwd),
		'block',
	);
	t.is(
		classifyPlanGateDecision('subagent-agent_general', {prompt: 'x'}, cwd),
		'block',
	);
	t.is(
		classifyPlanGateDecision('subagent-agent_debug', {prompt: 'x'}, cwd),
		'block',
	);
	t.is(
		classifyPlanGateDecision('team-spawn_teammate', {prompt: 'x'}, cwd),
		'block',
	);
	t.is(classifyPlanGateDecision('team-create_task', {}, cwd), 'block');
});

test('evaluatePlanGate respects planMode and approval state', t => {
	const cwd = process.cwd();
	const sessionId = 's1';

	// planMode off → always allow
	t.true(
		evaluatePlanGate({
			planMode: false,
			sessionId,
			toolName: 'terminal-execute',
			args: {command: 'ls'},
			cwd,
		}).allow,
	);

	// planMode on, unapproved → block terminal
	const blocked = evaluatePlanGate({
		planMode: true,
		sessionId,
		toolName: 'terminal-execute',
		args: {command: 'ls'},
		cwd,
	});
	t.false(blocked.allow);
	t.truthy(blocked.message?.includes('Plan Mode gate'));
	t.truthy(blocked.message?.includes('.trellis/tasks/**'));

	// plan writes allowed while unapproved
	t.true(
		evaluatePlanGate({
			planMode: true,
			sessionId,
			toolName: 'filesystem-create',
			args: {filePath: '.snow/plan/demo.md', content: '#x'},
			cwd,
		}).allow,
	);

	// trellis task writes allowed while unapproved (P0.5)
	t.true(
		evaluatePlanGate({
			planMode: true,
			sessionId,
			toolName: 'filesystem-edit',
			args: {filePath: '.trellis/tasks/demo/prd.md', content: '#prd'},
			cwd,
		}).allow,
	);

	// mixed batch with business path still blocked
	t.false(
		evaluatePlanGate({
			planMode: true,
			sessionId,
			toolName: 'filesystem-create',
			args: {
				filePath: [
					{path: '.trellis/tasks/demo/a.md', content: 'a'},
					{path: 'src/a.ts', content: 'b'},
				],
			},
			cwd,
		}).allow,
	);

	setPlanApproved(sessionId, true);
	t.true(
		evaluatePlanGate({
			planMode: true,
			sessionId,
			toolName: 'terminal-execute',
			args: {command: 'ls'},
			cwd,
		}).allow,
	);
});

test('isPlanApprovalAnswer matches explicit approvals', t => {
	t.true(
		isPlanApprovalAnswer({
			question: 'Implementation plan ready. Proceed?',
			selected: 'Yes - Execute the entire plan',
		}),
	);
	t.true(
		isPlanApprovalAnswer({
			question: '计划已创建，是否执行？',
			selected: '开始执行',
		}),
	);
	t.true(
		isPlanApprovalAnswer({
			question: '计划已创建，是否执行？',
			selected: '执行',
		}),
	);
	t.false(
		isPlanApprovalAnswer({
			question: 'Implementation plan ready. Proceed?',
			selected: 'Let me review the plan first',
		}),
	);
	t.false(
		isPlanApprovalAnswer({
			question: 'Implementation plan ready. Proceed?',
			selected: 'Modify the plan',
		}),
	);
	// Bare short tokens without plan-ish question must not unlock
	t.false(
		isPlanApprovalAnswer({
			question: 'Delete this file?',
			selected: '执行',
		}),
	);
	t.false(
		isPlanApprovalAnswer({
			question: '',
			selected: 'Yes',
		}),
	);
	t.false(
		isPlanApprovalAnswer({
			selected: '是',
		}),
	);
});

test('maybeApprovePlanFromAskUser sets and resets approval', t => {
	const sessionId = 's-approve';
	t.false(getPlanApproved(sessionId));

	maybeApprovePlanFromAskUser({
		planMode: true,
		sessionId,
		question: 'Plan ready. Proceed?',
		selected: 'Yes - Execute the entire plan',
	});
	t.true(getPlanApproved(sessionId));

	maybeApprovePlanFromAskUser({
		planMode: true,
		sessionId,
		question: 'Plan ready. Proceed?',
		selected: 'Modify the plan',
	});
	t.false(getPlanApproved(sessionId));
});

test('session isolation and plan mode change reset', t => {
	setPlanApproved('a', true);
	setPlanApproved('b', true);
	t.true(getPlanApproved('a'));
	t.true(getPlanApproved('b'));

	resetPlanGate('a');
	t.false(getPlanApproved('a'));
	t.true(getPlanApproved('b'));

	onPlanModeChange(false, 'b');
	t.false(getPlanApproved('b'));

	setPlanApproved('b', true);
	onPlanModeChange(true, 'b');
	t.false(getPlanApproved('b'));
});
