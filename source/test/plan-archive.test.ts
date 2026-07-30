import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	archivePlan,
	sweepCompletedPlans,
	sweepPlans,
} from '../utils/execution/planArchive.js';
import {parsePlanDocument} from '../utils/execution/planDocument.js';
import {
	appendPlanEvidence,
	getPlanEvidencePath,
	readPlanEvidence,
} from '../utils/execution/planEvidence.js';

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

async function writePlan(
	dir: string,
	name: string,
	status: string,
	subdir?: string,
) {
	const planDir = subdir
		? path.join(dir, '.snow', 'plan', subdir)
		: path.join(dir, '.snow', 'plan');
	await fs.mkdir(planDir, {recursive: true});
	const filePath = path.join(planDir, name);
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

test('archivePlan moves JSON acceptance evidence with the plan', async t => {
	const dir = await makePlanDir();
	const filePath = await writePlan(dir, 'evidence.md', 'completed');
	await appendPlanEvidence(filePath, {
		phase: 1,
		status: 'passed',
		startedAt: '2026-07-29T00:00:00.000Z',
		completedAt: '2026-07-29T00:00:01.000Z',
		durationMs: 1000,
		phaseChecks: [],
		globalAcceptance: [],
		manualConfirmations: [],
		workspace: {available: true, changedFiles: [], outOfScopeFiles: []},
		summary: 'passed',
	});

	const target = await archivePlan(await parsePlanDocument(filePath), dir);
	await t.throwsAsync(async () => fs.access(getPlanEvidencePath(filePath)));
	await fs.access(getPlanEvidencePath(target));
	t.is((await readPlanEvidence(target)).entries.length, 1);
});

test('archivePlan can mark abandoned final status', async t => {
	const dir = await makePlanDir();
	const filePath = await writePlan(dir, 'drop.md', 'executing');
	const doc = await parsePlanDocument(filePath);
	const target = await archivePlan(doc, dir, 'abandoned');
	const archived = await parsePlanDocument(target);
	t.is(archived.frontmatter.status, 'abandoned');
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

test('sweepCompletedPlans archives completed plans inside date dirs', async t => {
	const dir = await makePlanDir();
	const donePath = await writePlan(dir, 'done.md', 'completed', '2026-07-20');
	const runningPath = await writePlan(
		dir,
		'running.md',
		'executing',
		'2026-07-20',
	);

	const archived = await sweepCompletedPlans(dir);
	t.is(archived.length, 1);
	t.true(archived[0]!.includes(path.join('archive')));
	t.true(path.basename(archived[0]!).startsWith('done'));

	await t.throwsAsync(() => fs.access(donePath));
	await fs.access(runningPath);
});

test('sweepPlans archives draft+completed and protects executing by default', async t => {
	const dir = await makePlanDir();
	const draftPath = await writePlan(dir, 'draft.md', 'draft');
	const donePath = await writePlan(dir, 'done.md', 'completed');
	const runningPath = await writePlan(dir, 'running.md', 'executing');
	const result = await sweepPlans(dir, {
		statuses: ['draft', 'completed', 'executing'],
		sessionId: 'sess-1',
		reason: 'cleanup',
	});

	t.is(result.archived.length, 2);
	t.true(result.archived.some(item => item.source === draftPath));
	t.true(result.archived.some(item => item.source === donePath));
	t.true(result.skipped.some(item => item.source === runningPath));
	await fs.access(runningPath);
});

test('sweepPlans dry_run does not move files', async t => {
	const dir = await makePlanDir();
	const draftPath = await writePlan(dir, 'draft.md', 'draft');
	const result = await sweepPlans(dir, {
		statuses: ['draft'],
		dryRun: true,
		sessionId: 'sess-1',
	});
	t.is(result.archived.length, 1);
	t.is(result.archived[0]!.target, '(dry-run)');
	await fs.access(draftPath);
});

test('sweepPlans planPaths whitelist filters sources', async t => {
	const dir = await makePlanDir();
	const keep = await writePlan(dir, 'keep.md', 'draft');
	const drop = await writePlan(dir, 'drop.md', 'draft');
	const result = await sweepPlans(dir, {
		statuses: ['draft'],
		planPaths: [drop],
		sessionId: 'sess-1',
		reason: 'whitelist',
	});
	t.is(result.archived.length, 1);
	t.is(result.archived[0]!.source, drop);
	await fs.access(keep);
	await t.throwsAsync(() => fs.access(drop));
});

test('sweepPlans defaults to current session and excludes legacy plans', async t => {
	const dir = await makePlanDir();
	const mine = await writePlan(dir, 'mine.md', 'draft');
	const foreign = await writePlan(dir, 'foreign.md', 'draft');
	const legacy = await writePlan(dir, 'legacy.md', 'draft');
	await fs.writeFile(
		foreign,
		(
			await fs.readFile(foreign, 'utf8')
		).replace('session: sess-1', 'session: sess-2'),
		'utf8',
	);
	await fs.writeFile(
		legacy,
		(
			await fs.readFile(legacy, 'utf8')
		).replace('session: sess-1', "session: ''"),
		'utf8',
	);

	const result = await sweepPlans(dir, {
		statuses: ['draft'],
		sessionId: 'sess-1',
		reason: 'session cleanup',
	});
	t.deepEqual(
		result.archived.map(item => item.source),
		[mine],
	);
	await fs.access(foreign);
	await fs.access(legacy);
});

test('sweepPlans abandoned notes stamp updated_at and survive archive CAS', async t => {
	const dir = await makePlanDir();
	const draftPath = await writePlan(dir, 'draft.md', 'draft');
	const result = await sweepPlans(dir, {
		statuses: ['draft'],
		sessionId: 'sess-1',
		reason: 'note-cas-check',
	});
	t.is(result.archived.length, 1);
	t.is(result.errors.length, 0);
	const archived = await parsePlanDocument(result.archived[0]!.target);
	t.true(archived.raw.includes('> Batch archived: note-cas-check'));
	t.truthy(archived.frontmatter.updated_at);
	await t.throwsAsync(() => fs.access(draftPath));
});

test('sweepPlans scope=all archives across sessions', async t => {
	const dir = await makePlanDir();
	const mine = await writePlan(dir, 'mine.md', 'draft');
	const foreign = await writePlan(dir, 'foreign.md', 'draft');
	await fs.writeFile(
		foreign,
		(
			await fs.readFile(foreign, 'utf8')
		).replace('session: sess-1', 'session: sess-2'),
		'utf8',
	);

	const result = await sweepPlans(dir, {
		statuses: ['draft'],
		scope: 'all',
		reason: 'global cleanup',
	});
	t.deepEqual(
		result.archived.map(item => item.source).sort(),
		[mine, foreign].sort(),
	);
});
