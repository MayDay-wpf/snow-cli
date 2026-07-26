import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executePlanManageTool} from '../mcp/planManage.js';
import {parsePlanDocument} from '../utils/execution/planDocument.js';
import {sessionManager, type Session} from '../utils/session/sessionManager.js';

const test = anyTest as unknown as TestFn;

const PLAN = `---
status: executing
current_phase: 1
created: '2026-07-25T00:00:00.000Z'
session: ''
---
# Demo

### Phase 1: First
- **Files**:
  - src/a.ts
- **Steps**:
  - [ ] step one
  - [ ] step two
- **Done when**: build passes
`;

async function makePlanDir(): Promise<{dir: string; planPath: string}> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-planmanage-'));
	await fs.mkdir(path.join(dir, '.snow', 'plan'), {recursive: true});
	const planPath = path.join(dir, '.snow', 'plan', 'demo.md');
	await fs.writeFile(planPath, PLAN, 'utf8');
	return {dir, planPath};
}

function resultText(result: any): string {
	return result?.content?.[0]?.text ?? '';
}
function run(dir: string, args: any) {
	return executePlanManageTool('manage', args, undefined, dir);
}

function setTestSession(id: string): void {
	const now = Date.now();
	sessionManager.setCurrentSession({
		id,
		title: 'test',
		summary: '',
		createdAt: now,
		updatedAt: now,
		messages: [],
		messageCount: 0,
		projectId: 'test',
		projectPath: process.cwd(),
	} as Session);
}

test('rejects unknown actions and missing plan', async t => {
	const {dir} = await makePlanDir();
	const bad = await run(dir, {action: 'bogus'});
	t.true(bad.isError === true);

	const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-empty-'));
	const noPlan = await run(empty, {action: 'check_step', step_index: 1});
	t.true(noPlan.isError === true);
	t.true(resultText(noPlan).includes('no active plan'));
});

test('check_step marks steps and reports remaining', async t => {
	const {dir, planPath} = await makePlanDir();
	const outOfRange = await run(dir, {action: 'check_step', step_index: 9});
	t.true(outOfRange.isError === true);
	t.true(resultText(outOfRange).includes('out of range'));

	const ok = await run(dir, {action: 'check_step', step_index: 1});
	t.falsy(ok.isError);
	t.true(resultText(ok).includes('step two'));

	const doc = await parsePlanDocument(planPath);
	t.true(doc.phases[0]!.steps[0]!.checked);
	t.false(doc.phases[0]!.steps[1]!.checked);
});

test('complete_phase refuses while steps are unchecked', async t => {
	const {dir} = await makePlanDir();
	const result = await run(dir, {action: 'complete_phase'});
	t.true(result.isError === true);
	t.true(resultText(result).includes('unchecked steps'));
});

test('amend appends files and steps and records reason', async t => {
	const {dir, planPath} = await makePlanDir();
	const missingReason = await run(dir, {
		action: 'amend',
		add_files: ['src/b.ts'],
	});
	t.true(missingReason.isError === true);

	const ok = await run(dir, {
		action: 'amend',
		reason: 'scope grew',
		add_files: ['src/b.ts'],
		add_steps: ['extra step'],
	});
	t.falsy(ok.isError);

	const doc = await parsePlanDocument(planPath);
	t.true(doc.phases[0]!.files.includes('src/b.ts'));
	t.true(doc.phases[0]!.steps.some(s => s.text === 'extra step'));
	t.true(doc.raw.includes('> Amended: scope grew'));
});

test('get and status summarize active plan', async t => {
	const {dir} = await makePlanDir();
	const get = await run(dir, {action: 'get'});
	t.falsy(get.isError);
	t.true(resultText(get).includes('Status: executing'));
	t.true(resultText(get).includes('Next step:'));

	const status = await run(dir, {action: 'status'});
	t.falsy(status.isError);
	t.true(resultText(status).includes('status=executing'));
});

test('list returns active plans without requiring session match', async t => {
	const {dir} = await makePlanDir();
	const list = await run(dir, {action: 'list'});
	t.falsy(list.isError);
	t.true(resultText(list).includes('Active plans'));
	t.true(resultText(list).includes('demo.md'));
});

test('uncheck_step clears a checked step', async t => {
	const {dir, planPath} = await makePlanDir();
	await run(dir, {action: 'check_step', step_index: 1});
	let doc = await parsePlanDocument(planPath);
	t.true(doc.phases[0]!.steps[0]!.checked);

	const unchecked = await run(dir, {action: 'uncheck_step', step_index: 1});
	t.falsy(unchecked.isError);
	doc = await parsePlanDocument(planPath);
	t.false(doc.phases[0]!.steps[0]!.checked);
});

test('create writes plan under date dir', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-plancreate-'));
	const created = await run(dir, {
		action: 'create',
		title: 'Add Feature X',
		complexity: 'simple',
		context: 'why we need it',
	});
	t.falsy(created.isError);
	const text = resultText(created);
	t.true(text.includes('Created draft plan'));
	t.true(text.includes(path.join('.snow', 'plan')));
	t.true(text.includes('add-feature-x.md'));

	const match = text.match(/Created draft plan at (.+?) \(complexity=/);
	t.truthy(match);
	const planPath = match![1]!.trim();
	const doc = await parsePlanDocument(planPath);
	t.is(doc.frontmatter.status, 'draft');
	t.is(doc.frontmatter.complexity, 'simple');
	t.true(doc.phases.length >= 1);
});

test.serial('abandon archives plan with abandoned status', async t => {
	const {dir, planPath} = await makePlanDir();
	const missing = await run(dir, {action: 'abandon'});
	t.true(missing.isError === true);

	const ok = await run(dir, {action: 'abandon', reason: 'no longer needed'});
	t.falsy(ok.isError);
	t.true(resultText(ok).includes('abandoned'));
	await t.throwsAsync(() => fs.access(planPath));

	const archivedPath = resultText(ok)
		.match(/archived to (.+?)\.?$/)?.[1]
		?.trim()
		.replace(/\.$/, '');
	t.truthy(archivedPath);
	const archived = await parsePlanDocument(archivedPath!);
	t.is(archived.frontmatter.status, 'abandoned');
	t.true(archived.raw.includes('> Abandoned: no longer needed'));
});

test.serial(
	'adopt rebinds executing plan session and approves gate',
	async t => {
		const {dir, planPath} = await makePlanDir();
		// Tag plan to another session
		const content = await fs.readFile(planPath, 'utf8');
		await fs.writeFile(
			planPath,
			content.replace("session: ''", 'session: other-session'),
			'utf8',
		);

		const {getPlanApproved, resetAllPlanGates} = await import(
			'../utils/execution/planModeGate.js'
		);
		resetAllPlanGates();
		// No live session in unit tests → gate key resolves to 'default' via null.
		t.false(getPlanApproved(null));

		const ok = await run(dir, {action: 'adopt', plan_path: planPath});
		t.falsy(ok.isError);
		t.true(resultText(ok).includes('Adopted plan'));

		const doc = await parsePlanDocument(planPath);
		t.is(doc.frontmatter.status, 'executing');
		// Rebinds away from other-session (empty when sessionManager has no current session).
		t.not(doc.frontmatter.session, 'other-session');
		t.true(getPlanApproved(null));
	},
);

test.serial('archive_batch dry_run and default protects executing', async t => {
	const {dir, planPath} = await makePlanDir();
	const draftPath = path.join(dir, '.snow', 'plan', 'old-draft.md');
	await fs.writeFile(
		draftPath,
		`---
status: draft
current_phase: 0
created: '2026-07-25T00:00:00.000Z'
session: ''
---
# Old Draft

### Phase 1: X
- **Steps**:
  - [x] done
- **Done when**: ok
`,
		'utf8',
	);

	const dry = await run(dir, {
		action: 'archive_batch',
		statuses: ['draft', 'executing'],
		dry_run: true,
	});
	t.falsy(dry.isError);
	const dryText = resultText(dry);
	t.true(dryText.includes('dry-run'));
	t.true(dryText.includes('old-draft.md'));
	// executing demo.md should be skipped/protected in dry-run listing only if not matched;
	// with statuses including executing but include_executing false, executing is protected.
	await fs.access(planPath);
	await fs.access(draftPath);

	const real = await run(dir, {
		action: 'archive_batch',
		statuses: ['draft'],
		reason: 'unit-test cleanup',
	});
	t.falsy(real.isError);
	t.true(resultText(real).includes('archived'));
	await t.throwsAsync(() => fs.access(draftPath));
	// executing plan remains
	await fs.access(planPath);
});

test.serial('archive_batch include_executing requires reason', async t => {
	const {dir} = await makePlanDir();
	const missing = await run(dir, {
		action: 'archive_batch',
		include_executing: true,
		statuses: ['executing'],
	});
	t.true(missing.isError === true);
	t.true(resultText(missing).includes('requires "reason"'));
});

test.serial(
	'archive_batch defaults to current session and scope=all requires reason',
	async t => {
		const {dir} = await makePlanDir();
		setTestSession('sess-current');
		const planDir = path.join(dir, '.snow', 'plan');
		const mine = path.join(planDir, 'mine.md');
		const foreign = path.join(planDir, 'foreign.md');
		await fs.writeFile(
			mine,
			PLAN.replace("session: ''", 'session: sess-current').replace(
				'status: executing',
				'status: draft',
			),
			'utf8',
		);
		await fs.writeFile(
			foreign,
			PLAN.replace("session: ''", 'session: sess-foreign').replace(
				'status: executing',
				'status: draft',
			),
			'utf8',
		);

		const scoped = await run(dir, {
			action: 'archive_batch',
			statuses: ['draft'],
			reason: 'current session cleanup',
		});
		t.falsy(scoped.isError);
		await t.throwsAsync(() => fs.access(mine));
		await fs.access(foreign);

		const missingReason = await run(dir, {
			action: 'archive_batch',
			statuses: ['draft'],
			scope: 'all',
		});
		t.true(missingReason.isError === true);
		t.true(resultText(missingReason).includes('scope="all"'));
	},
);

test.serial.afterEach.always(() => {
	sessionManager.clearCurrentSession();
});
