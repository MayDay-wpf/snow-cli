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
} from '../utils/execution/planDocument.js';

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
- **Files**: src/a.ts
- **Steps**:
  - [x] create middleware
  - [ ] wire into app
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
) {
	const planDir = path.join(dir, '.snow', 'plan');
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
	t.deepEqual(p1.files, ['src/a.ts']);
	t.is(p1.steps.length, 2);
	t.true(p1.steps[0]!.checked);
	t.false(p1.steps[1]!.checked);
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
			'- **文件**: src/a.ts',
			'- **步骤**:',
			'  - [X] 完成一步',
			'- **完成标准**: 构建通过',
		].join('\n'),
	);
	t.is(phases.length, 1);
	t.deepEqual(phases[0]!.files, ['src/a.ts']);
	t.true(phases[0]!.steps[0]!.checked);
	t.deepEqual(phases[0]!.doneWhen, ['构建通过']);
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
