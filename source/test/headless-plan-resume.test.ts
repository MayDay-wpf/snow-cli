import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {tryResumeHeadlessPlan} from '../utils/execution/headlessPlanResume.js';
import {
	getPlanApproved,
	resetAllPlanGates,
} from '../utils/execution/planModeGate.js';
import {
	acquirePlanOwnerLock,
	getPlanOwnerLockPath,
	readPlanOwnerLock,
} from '../utils/execution/planOwnerLock.js';

const test = anyTest as unknown as TestFn;

const VALID_PLAN = `---
status: draft
current_phase: 1
created: '2026-07-25T00:00:00.000Z'
session: s-headless
---
# Demo

### Phase 1: Only phase
- **Files**: src/exists.ts
- **Steps**:
  - [ ] do the thing
- **Done when**: build passes
`;

async function makePlanDir(
	content = VALID_PLAN,
	filename = 'demo.md',
): Promise<{cwd: string; planPath: string}> {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-headless-plan-'));
	await fs.mkdir(path.join(cwd, '.snow', 'plan'), {recursive: true});
	await fs.mkdir(path.join(cwd, 'src'), {recursive: true});
	await fs.writeFile(path.join(cwd, 'src', 'exists.ts'), 'x', 'utf8');
	const planPath = path.join(cwd, '.snow', 'plan', filename);
	await fs.writeFile(planPath, content, 'utf8');
	return {cwd, planPath};
}

test.beforeEach(() => {
	resetAllPlanGates();
});

test('default headless remains planMode false without opt-in', async t => {
	const {cwd} = await makePlanDir(
		VALID_PLAN.replace('status: draft', 'status: executing'),
	);
	const result = await tryResumeHeadlessPlan({
		cwd,
		sessionId: 's-headless',
	});
	t.false(result.planMode);
	t.false(result.approved);
	t.false(getPlanApproved('s-headless'));
});

test('enablePlan without executing plan does not unlock writes', async t => {
	const {cwd} = await makePlanDir(); // draft
	const result = await tryResumeHeadlessPlan({
		cwd,
		sessionId: 's-headless',
		enablePlan: true,
	});
	t.false(result.planMode);
	t.false(result.approved);
	t.false(getPlanApproved('s-headless'));
	t.truthy(result.message?.includes('no executing plan'));
});

test('enablePlan restores gate for matching executing session plan', async t => {
	const content = VALID_PLAN.replace('status: draft', 'status: executing');
	const {cwd} = await makePlanDir(content);
	const result = await tryResumeHeadlessPlan({
		cwd,
		sessionId: 's-headless',
		enablePlan: true,
	});
	t.true(result.planMode);
	t.true(result.approved);
	t.true(getPlanApproved('s-headless'));
	t.is((await readPlanOwnerLock(cwd))?.sessionId, 's-headless');
});

test('plan-file resumes approved plan without askuser', async t => {
	const content = VALID_PLAN.replace('status: draft', 'status: approved');
	const {cwd, planPath} = await makePlanDir(content);
	const result = await tryResumeHeadlessPlan({
		cwd,
		sessionId: 's-new',
		planFile: planPath,
	});
	t.true(result.planMode);
	t.true(result.approved);
	t.true(getPlanApproved('s-new'));
	t.is(result.planPath, planPath);

	const updated = await fs.readFile(planPath, 'utf8');
	t.true(updated.includes('status: executing'));
	t.true(updated.includes('session: s-new'));
});

test('plan-file refuses draft status', async t => {
	const {cwd, planPath} = await makePlanDir(); // draft
	const result = await tryResumeHeadlessPlan({
		cwd,
		sessionId: 's-new',
		planFile: planPath,
	});
	t.false(result.planMode);
	t.false(result.approved);
	t.false(getPlanApproved('s-new'));
	t.truthy(result.message?.includes('status=draft'));
});

test('plan-file fails when owner lock held by another session', async t => {
	const content = VALID_PLAN.replace('status: draft', 'status: executing');
	const {cwd, planPath} = await makePlanDir(content);
	await acquirePlanOwnerLock(cwd, {
		planPath,
		sessionId: 'foreign',
	});

	const result = await tryResumeHeadlessPlan({
		cwd,
		sessionId: 's-new',
		planFile: planPath,
	});
	t.false(result.planMode);
	t.false(result.approved);
	t.truthy(result.message?.toLowerCase().includes('lock'));

	// cleanup lock file if present
	try {
		await fs.unlink(getPlanOwnerLockPath(cwd));
	} catch {
		// ignore
	}
});
