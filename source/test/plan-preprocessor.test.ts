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

test('buildResumePlanNotice detects executing plans from other sessions', async t => {
	const dir = await makePlanDir(EXECUTING_PLAN);
	const notice = await buildResumePlanNotice(dir, 'other-session');
	t.truthy(notice?.includes('Unfinished Plan Detected'));
	t.truthy(notice?.includes('[executing] Demo plan'));
	t.truthy(notice?.includes('session=sess-1'));
	t.truthy(notice?.includes('phase=1/2'));
	t.truthy(notice?.includes(path.join('.snow', 'plan', 'demo.md')));
	t.truthy(notice?.includes('plan-manage {action:"adopt"'));
	t.truthy(notice?.includes('Do **not** silently adopt the newest plan'));

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
	t.truthy(notice?.includes('Continue: <absolute-or-relative-plan-path>'));
	t.truthy(notice?.includes('required when multiple candidates'));
});
