import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	buildScopeWarningMessage,
	classifyPlanGateDecision,
	collectFilesystemPaths,
	evaluatePlanGate,
	getPlanApproved,
	isAllowedUnapprovedWritePath,
	isPlanApprovalAnswer,
	isPlanDirPath,
	isTrellisTasksDirPath,
	isWithinPlanScope,
	maybeApprovePlanFromAskUser,
	onPlanModeChange,
	resetAllPlanGates,
	resetPlanGate,
	setPlanApproved,
	setPlanScope,
	validatePlanBeforeApproval,
} from '../utils/execution/planModeGate.js';

const test = anyTest as unknown as TestFn;

const VALID_PLAN = `---
status: draft
current_phase: 0
created: '2026-07-25T00:00:00.000Z'
session: s-approve
---
# Demo

### Phase 1: Only phase
- **Files**: src/exists.ts
- **Steps**:
  - [ ] do the thing
- **Done when**: build passes
`;

async function makePlanDir(content = VALID_PLAN): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-gate-test-'));
	await fs.mkdir(path.join(dir, '.snow', 'plan'), {recursive: true});
	await fs.mkdir(path.join(dir, 'src'), {recursive: true});
	await fs.writeFile(path.join(dir, 'src', 'exists.ts'), 'x', 'utf8');
	await fs.writeFile(
		path.join(dir, '.snow', 'plan', 'demo.md'),
		content,
		'utf8',
	);
	return dir;
}

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

test('isPlanApprovalAnswer matches CONTINUE resume phrases', t => {
	t.true(
		isPlanApprovalAnswer({
			question: 'Resume unfinished plan?',
			selected: 'Continue this plan',
		}),
	);
	t.true(
		isPlanApprovalAnswer({
			question: '继续未完成计划？',
			selected: '继续该计划',
		}),
	);
	t.true(
		isPlanApprovalAnswer({
			question: 'Plan resume',
			selected: 'resume plan',
		}),
	);
	t.true(
		isPlanApprovalAnswer({
			question: '继续？',
			selected: '继续此计划',
		}),
	);
});

test('isPlanApprovalAnswer matches explicit approvals', t => {
	t.true(
		isPlanApprovalAnswer({
			question: 'Proceed with the plan?',
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

test('maybeApprovePlanFromAskUser approves valid plan and persists frontmatter', async t => {
	const sessionId = 's-approve';
	const cwd = await makePlanDir();
	t.false(getPlanApproved(sessionId));

	const result = await maybeApprovePlanFromAskUser({
		planMode: true,
		sessionId,
		cwd,
		question: 'Plan ready. Proceed?',
		selected: 'Yes - Execute the entire plan',
	});
	t.true(result.approved);
	t.true(getPlanApproved(sessionId));

	const raw = await fs.readFile(
		path.join(cwd, '.snow', 'plan', 'demo.md'),
		'utf8',
	);
	t.true(raw.includes('status: executing'));
	t.true(raw.includes('current_phase: 1'));

	const reset = await maybeApprovePlanFromAskUser({
		planMode: true,
		sessionId,
		cwd,
		question: 'Plan ready. Proceed?',
		selected: 'Modify the plan',
	});
	t.false(reset.approved);
	t.false(getPlanApproved(sessionId));
});

test('maybeApprovePlanFromAskUser rejects approval without a plan file', async t => {
	const sessionId = 's-noplan';
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-gate-empty-'));
	const result = await maybeApprovePlanFromAskUser({
		planMode: true,
		sessionId,
		cwd,
		question: 'Plan ready. Proceed?',
		selected: 'Yes - Execute the entire plan',
	});
	t.false(result.approved);
	t.truthy(result.error?.includes('no plan file'));
	t.false(getPlanApproved(sessionId));
});

test('validatePlanBeforeApproval rejects structurally invalid plans', async t => {
	const cwd = await makePlanDir(
		VALID_PLAN.replace(
			/- \*\*Steps\*\*:[\s\S]*?- \*\*Done when\*\*/,
			'- **Done when**',
		),
	);
	const result = await validatePlanBeforeApproval(cwd, 's-approve');
	t.false(result.ok);
	if (!result.ok) {
		t.true(result.message.includes('Steps'));
	}
});

test('validatePlanBeforeApproval rejects plans referencing missing files', async t => {
	const cwd = await makePlanDir(
		VALID_PLAN.replace('src/exists.ts', 'src/ghost.ts'),
	);
	const result = await validatePlanBeforeApproval(cwd, 's-approve');
	t.false(result.ok);
	if (!result.ok) {
		t.true(result.message.includes('ghost.ts'));
	}
});

test('plan scope: soft warning outside scope, always allow plan dir', async t => {
	const sessionId = 's-scope';
	const cwd = await makePlanDir();
	setPlanApproved(sessionId, true);
	setPlanScope(sessionId, {
		planPath: path.join(cwd, '.snow', 'plan', 'demo.md'),
		files: ['src/exists.ts'],
		cwd,
	});

	t.true(isWithinPlanScope('src/exists.ts', cwd, sessionId));
	t.true(isWithinPlanScope(path.join(cwd, 'SRC', 'exists.ts'), cwd, sessionId));
	t.false(isWithinPlanScope('src/other.ts', cwd, sessionId));
	t.true(isWithinPlanScope('.snow/plan/demo.md', cwd, sessionId));

	const inScope = evaluatePlanGate({
		planMode: true,
		sessionId,
		toolName: 'filesystem-edit',
		args: {filePath: 'src/exists.ts'},
		cwd,
	});
	t.true(inScope.allow);
	t.falsy(inScope.warning);

	const outScope = evaluatePlanGate({
		planMode: true,
		sessionId,
		toolName: 'filesystem-edit',
		args: {filePath: 'src/other.ts'},
		cwd,
	});
	t.true(outScope.allow);
	t.truthy(outScope.warning?.includes('Plan Scope Warning'));

	// Empty scope → unrestricted
	resetPlanGate(sessionId);
	setPlanApproved(sessionId, true);
	t.true(isWithinPlanScope('src/anything.ts', cwd, sessionId));

	t.true(
		buildScopeWarningMessage('filesystem-edit', ['x.ts']).includes('amend'),
	);
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
