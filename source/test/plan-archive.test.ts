import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	archivePlan,
	sweepCompletedPlans,
} from '../utils/execution/planArchive.js';
import {parsePlanDocument} from '../utils/execution/planDocument.js';

const test = anyTest as unknown as TestFn;

const PLAN = (status: string) => `---
status: ${status}
current_phase: 1
created: '2026-07-25T00:00:00.000Z'
session: sess-1
---
# Demo

### Phase 1: X
- **Steps**:
  - [x] done
- **Done when**: ok
`;

async function makePlanDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-archive-'));
	await fs.mkdir(path.join(dir, '.snow', 'plan'), {recursive: true});
	return dir;
}

async function writePlan(dir: string, name: string, status: string) {
	const filePath = path.join(dir, '.snow', 'plan', name);
	await fs.writeFile(filePath, PLAN(status), 'utf8');
	return filePath;
}

test('archivePlan moves file to dated folder and marks archived', async t => {
	const dir = await makePlanDir();
	const filePath = await writePlan(dir, 'demo.md', 'completed');
	const doc = await parsePlanDocument(filePath);

	const target = await archivePlan(doc, dir);
	t.true(target.includes(path.join('.snow', 'plan', 'archive')));
	t.true(/\d{4}-\d{2}-\d{2}/.test(target));

	await t.throwsAsync(() => fs.access(filePath));
	const archived = await parsePlanDocument(target);
	t.is(archived.frontmatter.status, 'archived');
});

test('archivePlan avoids name collisions with -N suffix', async t => {
	const dir = await makePlanDir();
	const first = await parsePlanDocument(
		await writePlan(dir, 'demo.md', 'completed'),
	);
	const firstTarget = await archivePlan(first, dir);

	const second = await parsePlanDocument(
		await writePlan(dir, 'demo.md', 'completed'),
	);
	const secondTarget = await archivePlan(second, dir);

	t.not(firstTarget, secondTarget);
	t.true(path.basename(secondTarget).startsWith('demo-2'));
});

test('sweepCompletedPlans archives only completed plans', async t => {
	const dir = await makePlanDir();
	await writePlan(dir, 'done.md', 'completed');
	await writePlan(dir, 'running.md', 'executing');
	await writePlan(dir, 'draft.md', 'draft');

	const archived = await sweepCompletedPlans(dir);
	t.is(archived.length, 1);
	t.true(archived[0]!.includes('done'));

	const remaining = await fs.readdir(path.join(dir, '.snow', 'plan'));
	t.true(remaining.includes('running.md'));
	t.true(remaining.includes('draft.md'));
	t.false(remaining.includes('done.md'));

	t.deepEqual(await sweepCompletedPlans(path.join(dir, 'nope')), []);
});
