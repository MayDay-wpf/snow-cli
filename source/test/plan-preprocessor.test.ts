import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	formatPlanContext,
	buildPlanReminder,
	buildResumePlanNotice,
} from '../utils/core/planPreprocessor.js';
import {parsePlanDocument} from '../utils/execution/planDocument.js';
import {
	acquirePlanOwnerLock,
	getPlanOwnerLockPath,
	PLAN_OWNER_LOCK_SOFT_STALE_MS,
} from '../utils/execution/planOwnerLock.js';

const test = anyTest as unknown as TestFn;

const EXECUTING_PLAN = `---
status: executing
current_phase: 1
created: '2026-07-25T00:00:00.000Z'
session: sess-1
---
# Demo plan

### Phase 1: First
- **Files**: src/a.ts
- **Steps**:
  - [x] done step
  - [ ] pending step
- **Done when**: build passes

### Phase 2: Second
- **Steps**:
  - [ ] later
- **Done when**: ok
`;

async function makePlanDir(content?: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-planprep-'));
	if (content !== undefined) {
		await fs.mkdir(path.join(dir, '.snow', 'plan'), {recursive: true});
		await fs.writeFile(
			path.join(dir, '.snow', 'plan', 'demo.md'),
			content,
			'utf8',
		);
	}
	return dir;
}

test('formatPlanContext renders phase progress and instructions', async t => {
	const dir = await makePlanDir(EXECUTING_PLAN);
	const doc = await parsePlanDocument(
		path.join(dir, '.snow', 'plan', 'demo.md'),
	);
	const text = formatPlanContext(doc);
	t.true(text.includes('## Active Plan'));
	t.true(text.includes('Phase 1/2: First'));
	t.true(text.includes('**Files** (current phase write allowlist)'));
	t.true(text.includes('- src/a.ts'));
	t.true(text.includes('[x] done step'));
	t.true(text.includes('[ ] pending step'));
	t.true(text.includes('**Next step**: pending step'));
	t.true(text.includes('**Done when**: build passes'));
	t.true(text.includes('plan-manage'));
});

test('buildPlanReminder returns context only for active plans in plan mode', async t => {
	const dir = await makePlanDir(EXECUTING_PLAN);
	const reminder = await buildPlanReminder(dir, 'sess-1', true);
	t.truthy(reminder?.includes('Phase 1/2'));

	t.is(await buildPlanReminder(dir, 'sess-1', false), null);

	const draftDir = await makePlanDir(
		EXECUTING_PLAN.replace('status: executing', 'status: draft'),
	);
	t.is(await buildPlanReminder(draftDir, 'sess-1', true), null);

	const emptyDir = await makePlanDir();
	t.is(await buildPlanReminder(emptyDir, 'sess-1', true), null);
});

test('buildResumePlanNotice detects recoverable foreign hard-stale plans', async t => {
	const dir = await makePlanDir(EXECUTING_PLAN);
	// No lock → foreign_hard_stale for other-session; Continue without force is OK.
	const notice = await buildResumePlanNotice(dir, 'other-session');
	t.truthy(notice?.includes('Unfinished Plan Detected'));
	t.truthy(notice?.includes('[executing] Demo plan'));
	t.truthy(notice?.includes('session=sess-1'));
	t.truthy(notice?.includes('phase=1/2'));
	t.truthy(notice?.includes(path.join('.snow', 'plan', 'demo.md')));
	t.truthy(notice?.includes('ownership=foreign_hard_stale'));
	t.truthy(notice?.includes('plan-manage {action:"adopt"'));
	t.truthy(notice?.includes('without force'));
	t.truthy(notice?.includes('Do **not** silently adopt the newest plan'));
	t.falsy(notice?.includes('Foreign live owner present'));

	const emptyDir = await makePlanDir();
	t.is(await buildResumePlanNotice(emptyDir, 'x'), null);
});

test('buildResumePlanNotice lists multiple unfinished candidates explicitly', async t => {
	const dir = await makePlanDir(EXECUTING_PLAN);
	const secondPath = path.join(dir, '.snow', 'plan', 'second.md');
	await fs.writeFile(
		secondPath,
		EXECUTING_PLAN.replace('session: sess-1', 'session: sess-2').replace(
			'# Demo plan',
			'# Second plan',
		),
		'utf8',
	);

	const notice = await buildResumePlanNotice(dir, 'new-session');
	t.truthy(notice?.includes('Found 2 unfinished plan(s)'));
	t.truthy(notice?.includes('1. [executing]'));
	t.truthy(notice?.includes('2. [executing]'));
	t.truthy(notice?.includes('ownership='));
	t.truthy(notice?.includes('Continue: <absolute-or-relative-plan-path>'));
	t.truthy(notice?.includes('plan_path is required when multiple candidates'));
});

test('buildResumePlanNotice warns against Continue-stealing foreign_live', async t => {
	const dir = await makePlanDir(EXECUTING_PLAN);
	const planPath = path.join(dir, '.snow', 'plan', 'demo.md');
	const lock = await acquirePlanOwnerLock(dir, {
		planPath,
		sessionId: 'sess-1',
	});
	t.true(lock.ok);

	const notice = await buildResumePlanNotice(dir, 'other-session');
	t.truthy(notice);
	t.truthy(notice?.includes('ownership=foreign_live'));
	t.truthy(notice?.includes('Foreign live owner present'));
	t.truthy(notice?.includes('force:true'));
	t.truthy(notice?.includes('Do **not** Continue / adopt without force'));
	t.falsy(notice?.includes('without force. That rebinds'));

	await fs.unlink(getPlanOwnerLockPath(dir)).catch(() => {});
});

test('buildResumePlanNotice requires force for foreign_soft_stale', async t => {
	const dir = await makePlanDir(EXECUTING_PLAN);
	const planPath = path.join(dir, '.snow', 'plan', 'demo.md');
	const acquired = await acquirePlanOwnerLock(dir, {
		planPath,
		sessionId: 'sess-1',
	});
	t.true(acquired.ok);

	// Age the heartbeat into soft-stale while keeping pid alive (this process).
	const lockPath = getPlanOwnerLockPath(dir);
	const raw = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
		heartbeatAt: string;
		acquiredAt: string;
	};
	const old = new Date(
		Date.now() - PLAN_OWNER_LOCK_SOFT_STALE_MS - 60_000,
	).toISOString();
	raw.heartbeatAt = old;
	raw.acquiredAt = old;
	await fs.writeFile(lockPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

	const notice = await buildResumePlanNotice(dir, 'other-session');
	t.truthy(notice);
	t.truthy(notice?.includes('ownership=foreign_soft_stale'));
	t.truthy(notice?.includes('Foreign soft-stale owner present'));
	t.truthy(notice?.includes('never** auto-adopted') || notice?.includes('never auto-adopted') || notice?.includes('Soft-stale is **never**'));
	t.truthy(notice?.includes('force:true'));

	await fs.unlink(lockPath).catch(() => {});
});
