import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	parsePlanDocument,
	parsePhasesFromMarkdown,
	normalizeFrontmatter,
	writePlanFrontmatter,
	setStepChecked,
	validatePlanDocument,
	findSessionPlanFiles,
	findActivePlan,
	getPlanWriteOptions,
	PlanWriteConflictError,
	listUnfinishedPlans,
	findForeignExecutingPlans,
} from '../utils/execution/planDocument.js';
import {
	dateFolderName,
	normalizePlanWritePath,
} from '../utils/execution/planPaths.js';

const test = anyTest as unknown as TestFn;

async function makeTmpDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'snow-plan-test-'));
}

const SAMPLE_PLAN = `---
status: executing
current_phase: 1
created: '2026-07-25T00:00:00.000Z'
session: sess-1
---
# Add auth

## Affected files

- \`src/a.ts\`
- src/b.ts (new)

### Phase 1: Middleware
- **Delivers**: authenticated requests reach protected handlers
- **Execution strategy**: tdd
- **Files**: src/a.ts
- **Steps**:
  - [x] create middleware
  - [ ] wire into app
- **Checks**:
  - command: npx ava source/test/auth.test.ts
  - diagnostics
- **Done when**: build passes

### Phase 2: Endpoints
- **Files**:
  - \`src/b.ts\`
- **Steps**:
  - [ ] add login endpoint
- **Done when**:
  - no diagnostics
`;

async function writeSamplePlan(
	dir: string,
	name = 'auth.md',
	content = SAMPLE_PLAN,
	subdir?: string,
) {
	const planDir = subdir
		? path.join(dir, '.snow', 'plan', subdir)
		: path.join(dir, '.snow', 'plan');
	await fs.mkdir(planDir, {recursive: true});
	const filePath = path.join(planDir, name);
	await fs.writeFile(filePath, content, 'utf8');
	return filePath;
}

test('normalizeFrontmatter fills defaults and rejects invalid values', t => {
	const fm = normalizeFrontmatter({status: 'bogus', current_phase: -3});
	t.is(fm.status, 'draft');
	t.is(fm.current_phase, 0);
	t.is(fm.session, '');
});

test('normalizeFrontmatter parses abandoned status and complexity tiers', t => {
	const fm = normalizeFrontmatter({
		status: 'abandoned',
		complexity: 'complex',
		title: ' My Plan ',
		updated_at: '2026-07-26T01:00:00.000Z',
	});
	t.is(fm.status, 'abandoned');
	t.is(fm.complexity, 'complex');
	t.is(fm.title, 'My Plan');
	t.is(fm.updated_at, '2026-07-26T01:00:00.000Z');

	const ignored = normalizeFrontmatter({complexity: 'huge'});
	t.is(ignored.complexity, undefined);
});

test('parsePlanDocument parses frontmatter, phases, files, steps', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(dir);
	const doc = await parsePlanDocument(filePath);

	t.false(doc.legacy);
	t.is(doc.frontmatter.status, 'executing');
	t.is(doc.frontmatter.current_phase, 1);
	t.is(doc.frontmatter.session, 'sess-1');
	t.is(doc.title, 'Add auth');
	t.deepEqual(doc.affectedFiles, ['src/a.ts', 'src/b.ts (new)']);
	t.is(doc.phases.length, 2);

	const p1 = doc.phases[0]!;
	t.is(p1.index, 1);
	t.is(p1.title, 'Middleware');
	t.is(p1.delivers, 'authenticated requests reach protected handlers');
	t.is(p1.executionStrategy, 'tdd');
	t.deepEqual(p1.files, ['src/a.ts']);
	t.is(p1.steps.length, 2);
	t.true(p1.steps[0]!.checked);
	t.false(p1.steps[1]!.checked);
	t.deepEqual(p1.checks, [
		{type: 'command', command: 'npx ava source/test/auth.test.ts'},
		{type: 'diagnostics'},
	]);
	t.deepEqual(p1.doneWhen, ['build passes']);

	const p2 = doc.phases[1]!;
	t.deepEqual(p2.files, ['src/b.ts']);
	t.deepEqual(p2.doneWhen, ['no diagnostics']);
});

test('parsePlanDocument marks legacy files without frontmatter', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(
		dir,
		'legacy.md',
		'# Old plan\n\n### Phase 1: X\n- **Steps**:\n  - [ ] do it\n- **Done when**: done\n',
	);
	const doc = await parsePlanDocument(filePath);
	t.true(doc.legacy);
	t.is(doc.frontmatter.status, 'draft');
	t.is(doc.phases.length, 1);
});

test('parsePhasesFromMarkdown supports Chinese section labels and uppercase X', t => {
	const {phases} = parsePhasesFromMarkdown(
		[
			'### Phase 1: 中间件',
			'- **交付**: 请求可以通过鉴权',
			'- **执行策略**: standard',
			'- **文件**: src/a.ts',
			'- **步骤**:',
			'  - [X] 完成一步',
			'- **完成标准**: 构建通过',
		].join('\n'),
	);
	t.is(phases.length, 1);
	t.is(phases[0]!.delivers, '请求可以通过鉴权');
	t.is(phases[0]!.executionStrategy, 'standard');
	t.deepEqual(phases[0]!.files, ['src/a.ts']);
	t.true(phases[0]!.steps[0]!.checked);
	t.deepEqual(phases[0]!.doneWhen, ['构建通过']);
});

test('parsePhasesFromMarkdown normalizes file paths with descriptions', t => {
	const {phases} = parsePhasesFromMarkdown(
		[
			'### Phase 1: Parser',
			'- **Files**:',
			'  - `src/a.ts` — existing file reason',
			'  - src/b.ts - another reason',
			'  - `src/new.ts` (new) — create it',
			'  - src/new-zh.ts (新建) - create it',
			'- **Steps**:',
			'  - [ ] update parser',
			'- **Done when**: tests pass',
		].join('\n'),
	);

	t.deepEqual(phases[0]!.files, [
		'src/a.ts',
		'src/b.ts',
		'src/new.ts (new)',
		'src/new-zh.ts (新建)',
	]);
});

test('validatePlanDocument rejects broken phase sequencing and invalid current phase', async t => {
	const dir = await makeTmpDir();
	const doc = await parsePlanDocument(
		await writeSamplePlan(
			dir,
			'bad-sequence.md',
			SAMPLE_PLAN.replace('current_phase: 1', 'current_phase: 3').replace(
				'### Phase 2: Endpoints',
				'### Phase 4: Endpoints',
			),
		),
	);
	const codes = new Set(
		validatePlanDocument(doc, dir).map(issue => issue.code),
	);
	t.true(codes.has('phase_sequence'));
	t.true(codes.has('current_phase_invalid'));
});

test('validatePlanDocument requires a command check for TDD phases', async t => {
	const dir = await makeTmpDir();
	const doc = await parsePlanDocument(
		await writeSamplePlan(
			dir,
			'tdd-without-command.md',
			SAMPLE_PLAN.replace(
				'- **Checks**:\n  - command: npx ava source/test/auth.test.ts\n  - diagnostics\n',
				'- **Checks**:\n  - diagnostics\n',
			),
		),
	);
	t.true(
		validatePlanDocument(doc, dir).some(
			issue => issue.code === 'tdd_no_command_check',
		),
	);
});

test('validatePlanDocument rejects unsafe command checks from Markdown', async t => {
	const dir = await makeTmpDir();
	const doc = await parsePlanDocument(
		await writeSamplePlan(
			dir,
			'unsafe-check.md',
			SAMPLE_PLAN.replace(
				'npx ava source/test/auth.test.ts',
				'npm test && git push origin main',
			),
		),
	);
	t.true(
		validatePlanDocument(doc, dir).some(
			issue => issue.code === 'unsafe_check_command',
		),
	);
});

test('validatePlanDocument reports all issue codes', async t => {
	const dir = await makeTmpDir();
	const noPhases = await parsePlanDocument(
		await writeSamplePlan(dir, 'empty.md', '# Nothing here\n'),
	);
	t.deepEqual(
		validatePlanDocument(noPhases, dir).map(i => i.code),
		['no_phases'],
	);

	const bad = await parsePlanDocument(
		await writeSamplePlan(
			dir,
			'bad.md',
			[
				'### Phase 1: X',
				'- **Files**: does/not/exist.ts',
				'',
				'### Phase 2: Y',
				'- **Steps**:',
				'  - [ ] a step',
				'- **Done when**: ok',
			].join('\n'),
		),
	);
	const codes = validatePlanDocument(bad, dir).map(i => i.code);
	t.true(codes.includes('phase_no_steps'));
	t.true(codes.includes('phase_no_done_when'));
	t.true(codes.includes('missing_file'));
});

test('validatePlanDocument accepts existing files and (new) markers', async t => {
	const dir = await makeTmpDir();
	await fs.mkdir(path.join(dir, 'src'), {recursive: true});
	await fs.writeFile(path.join(dir, 'src', 'a.ts'), 'x', 'utf8');
	const doc = await parsePlanDocument(await writeSamplePlan(dir));
	t.deepEqual(validatePlanDocument(doc, dir), []);
});

test('validatePlanDocument tolerates legacy path descriptions', async t => {
	const directory = await makeTmpDir();
	await fs.mkdir(path.join(directory, 'src'), {recursive: true});
	await fs.writeFile(path.join(directory, 'src', 'a.ts'), 'x', 'utf8');
	const document = await parsePlanDocument(await writeSamplePlan(directory));

	// Simulate a previously parsed/cached plan whose file entries were not cleaned.
	document.affectedFiles = [
		'`src/a.ts` — existing file reason',
		'`src/new.ts` (new) — create it',
	];

	t.deepEqual(validatePlanDocument(document, directory), []);
});

test('validatePlanDocument requires Risks or Rollback for complex plans', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(
		dir,
		'complex.md',
		[
			'---',
			'status: draft',
			'current_phase: 0',
			"created: '2026-07-26T00:00:00.000Z'",
			"session: ''",
			'complexity: complex',
			'---',
			'# Complex',
			'',
			'### Phase 1: X',
			'- **Steps**:',
			'  - [ ] do it',
			'- **Done when**: done',
			'',
		].join('\n'),
	);
	const doc = await parsePlanDocument(filePath);
	const codes = validatePlanDocument(doc, dir).map(i => i.code);
	t.true(codes.includes('complex_missing_sections'));
});

test('setStepChecked toggles only the target step line', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(dir);
	await setStepChecked(filePath, 1, 2, true);
	const doc = await parsePlanDocument(filePath);
	t.true(doc.phases[0]!.steps[1]!.checked);
	t.true(doc.phases[0]!.steps[0]!.checked);
	t.false(doc.phases[1]!.steps[0]!.checked);
	// Frontmatter preserved
	t.is(doc.frontmatter.session, 'sess-1');
});

test('setStepChecked rejects out-of-range indexes', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(dir);
	await t.throwsAsync(() => setStepChecked(filePath, 9, 1, true));
	await t.throwsAsync(() => setStepChecked(filePath, 1, 9, true));
});

test('writePlanFrontmatter merges patch and upgrades legacy files', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(
		dir,
		'legacy.md',
		'# Old plan\nbody\n',
	);
	await writePlanFrontmatter(filePath, {status: 'executing', session: 's9'});
	const doc = await parsePlanDocument(filePath);
	t.false(doc.legacy);
	t.is(doc.frontmatter.status, 'executing');
	t.is(doc.frontmatter.session, 's9');
	t.true(doc.raw.includes('# Old plan'));
	const entries = await fs.readdir(path.dirname(filePath));
	t.false(entries.some(entry => entry.endsWith('.tmp')));
});

test('writePlanFrontmatter fills created when empty and stamps updated_at', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(
		dir,
		'empty-created.md',
		[
			'---',
			'status: draft',
			'current_phase: 0',
			"created: ''",
			"session: ''",
			'---',
			'# X',
			'',
			'### Phase 1: Y',
			'- **Steps**:',
			'  - [ ] a',
			'- **Done when**: ok',
			'',
		].join('\n'),
	);
	await writePlanFrontmatter(filePath, {status: 'draft'});
	const doc = await parsePlanDocument(filePath);
	t.truthy(doc.frontmatter.created);
	t.not(doc.frontmatter.created, '');
	t.truthy(doc.frontmatter.updated_at);
	t.true(doc.frontmatter.updated_at!.includes('T'));
});

test('findSessionPlanFiles filters by session with legacy fallback', async t => {
	const dir = await makeTmpDir();
	await writeSamplePlan(dir, 'a.md');
	await writeSamplePlan(
		dir,
		'b.md',
		SAMPLE_PLAN.replace('session: sess-1', 'session: sess-2'),
	);

	const forSess1 = await findSessionPlanFiles(dir, 'sess-1');
	t.is(forSess1.length, 1);
	t.is(path.basename(forSess1[0]!.filePath), 'a.md');

	// Unknown session + all plans tagged to other sessions → no adoption
	t.is((await findSessionPlanFiles(dir, 'sess-unknown')).length, 0);

	// Untagged (legacy) plan → adopted as fallback
	await writeSamplePlan(
		dir,
		'legacy.md',
		SAMPLE_PLAN.replace('session: sess-1', "session: ''"),
	);
	const fallback = await findSessionPlanFiles(dir, 'sess-unknown');
	t.is(fallback.length, 1);
	t.is(path.basename(fallback[0]!.filePath), 'legacy.md');
});

test('findActivePlan prefers executing over draft and returns null when none', async t => {
	const dir = await makeTmpDir();
	t.is(await findActivePlan(dir, 'sess-1'), null);

	await writeSamplePlan(
		dir,
		'draft.md',
		SAMPLE_PLAN.replace('status: executing', 'status: draft'),
	);
	await writeSamplePlan(dir, 'exec.md');
	const active = await findActivePlan(dir, 'sess-1');
	t.is(active?.frontmatter.status, 'executing');

	await writeSamplePlan(
		dir,
		'done.md',
		SAMPLE_PLAN.replace('status: executing', 'status: completed'),
	);
	const stillExec = await findActivePlan(dir, 'sess-1');
	t.is(stillExec?.frontmatter.status, 'executing');
});

test('findSessionPlanFiles discovers plans in date subdirs and ignores archive', async t => {
	const dir = await makeTmpDir();
	await writeSamplePlan(dir, 'legacy.md');
	await writeSamplePlan(dir, 'day-one.md', SAMPLE_PLAN, '2026-07-20');
	await writeSamplePlan(
		dir,
		'day-two.md',
		SAMPLE_PLAN.replace('session: sess-1', 'session: sess-2'),
		'2026-07-21',
	);
	await writeSamplePlan(
		dir,
		'archived.md',
		SAMPLE_PLAN.replace('status: executing', 'status: archived'),
		path.join('archive', '2026-07-22'),
	);
	// Non-date folders must be ignored
	await writeSamplePlan(dir, 'misc.md', SAMPLE_PLAN, 'notes');

	const all = await findSessionPlanFiles(dir, null);
	const basenames = all.map(d => path.basename(d.filePath)).sort();
	t.deepEqual(basenames, ['day-one.md', 'day-two.md', 'legacy.md']);

	const forSess1 = await findSessionPlanFiles(dir, 'sess-1');
	t.deepEqual(forSess1.map(d => path.basename(d.filePath)).sort(), [
		'day-one.md',
		'legacy.md',
	]);
	t.true(
		forSess1.some(d =>
			d.filePath.includes(path.join('2026-07-20', 'day-one.md')),
		),
	);
});

test('writePlanFrontmatter rejects stale updated_at and mtime revisions', async t => {
	const dir = await makeTmpDir();
	const filePath = await writeSamplePlan(dir);
	const doc = await parsePlanDocument(filePath);

	await writePlanFrontmatter(filePath, {status: 'approved'});

	const err = await t.throwsAsync(
		() =>
			writePlanFrontmatter(
				filePath,
				{status: 'executing'},
				getPlanWriteOptions(doc),
			),
		{instanceOf: PlanWriteConflictError},
	);
	t.true(String(err?.message).includes('updated_at mismatch'));

	const fresh = await parsePlanDocument(filePath);
	await setStepChecked(filePath, 1, 2, true);
	const conflictErr = await t.throwsAsync(
		() => setStepChecked(filePath, 1, 1, true, getPlanWriteOptions(fresh)),
		{instanceOf: PlanWriteConflictError},
	);
	const msg = String(conflictErr?.message);
	t.true(msg.includes('updated_at mismatch') || msg.includes('mtime mismatch'));
});

test('listUnfinishedPlans and findForeignExecutingPlans cover multi-plan resume', async t => {
	const dir = await makeTmpDir();
	await writeSamplePlan(dir, 'exec-a.md');
	await writeSamplePlan(
		dir,
		'exec-b.md',
		SAMPLE_PLAN.replace('session: sess-1', 'session: sess-2'),
	);
	await writeSamplePlan(
		dir,
		'draft-progress.md',
		SAMPLE_PLAN.replace('status: executing', 'status: draft'),
	);
	await writeSamplePlan(
		dir,
		'draft-empty.md',
		SAMPLE_PLAN.replace('status: executing', 'status: draft').replace(
			'- [x] create middleware',
			'- [ ] create middleware',
		),
	);

	const unfinished = await listUnfinishedPlans(dir);
	t.deepEqual(
		unfinished.map(d => path.basename(d.filePath)).sort(),
		['draft-progress.md', 'exec-a.md', 'exec-b.md'].sort(),
	);
	t.is(unfinished[0]!.frontmatter.status, 'executing');

	const foreign = await findForeignExecutingPlans(dir, 'sess-1');
	t.deepEqual(
		foreign.map(d => path.basename(d.filePath)),
		['exec-b.md'],
	);
});

test('normalizePlanWritePath redirects top-level plan md into today folder', t => {
	const cwd = path.resolve(path.sep + path.join('tmp', 'snow-plan-cwd'));
	const today = dateFolderName(new Date('2026-07-26T12:00:00'));
	const now = new Date('2026-07-26T12:00:00');

	const relativeIn = path.join('.snow', 'plan', 'task.md');
	const relativeOut = normalizePlanWritePath(relativeIn, cwd, now);
	t.is(relativeOut, path.join('.snow', 'plan', today, 'task.md'));

	const absoluteIn = path.join(cwd, '.snow', 'plan', 'task.md');
	const absoluteOut = normalizePlanWritePath(absoluteIn, cwd, now);
	t.is(absoluteOut, path.join(cwd, '.snow', 'plan', today, 'task.md'));

	const alreadyDated = path.join('.snow', 'plan', '2026-07-20', 'task.md');
	t.is(normalizePlanWritePath(alreadyDated, cwd, now), alreadyDated);

	const archivePath = path.join('.snow', 'plan', 'archive', today, 'task.md');
	t.is(normalizePlanWritePath(archivePath, cwd, now), archivePath);

	const nonMd = path.join('.snow', 'plan', 'notes.txt');
	t.is(normalizePlanWritePath(nonMd, cwd, now), nonMd);

	const outside = path.join('src', 'a.ts');
	t.is(normalizePlanWritePath(outside, cwd, now), outside);
});
