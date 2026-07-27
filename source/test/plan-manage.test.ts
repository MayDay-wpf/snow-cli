import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executePlanManageTool} from '../mcp/planManage.js';
import {parsePlanDocument} from '../utils/execution/planDocument.js';
import {
	acquirePlanOwnerLock,
	getPlanOwnerLockPath,
} from '../utils/execution/planOwnerLock.js';
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

/** Untagged executing plans need adopt before mutations (ownership gate). */
async function makeMutablePlan(): Promise<{dir: string; planPath: string}> {
	const {dir, planPath} = await makePlanDir();
	// Ownership mine_active requires a non-empty session bound to this process.
	setTestSession('sess-test');
	const adopted = await run(dir, {action: 'adopt', plan_path: planPath});
	if (adopted.isError) {
		throw new Error(`adopt failed: ${resultText(adopted)}`);
	}
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

test.serial('check_step marks steps and reports remaining', async t => {
	const {dir, planPath} = await makeMutablePlan();
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

test.serial('complete_phase refuses while steps are unchecked', async t => {
	const {dir} = await makeMutablePlan();
	const result = await run(dir, {action: 'complete_phase'});
	t.true(result.isError === true);
	t.true(resultText(result).includes('unchecked steps'));
});

test.serial('amend appends files and steps and records reason', async t => {
	const {dir, planPath} = await makeMutablePlan();
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

test('list returns active plans with ownership labels', async t => {
	const {dir} = await makePlanDir();
	const list = await run(dir, {action: 'list'});
	t.falsy(list.isError);

	const text = resultText(list);
	t.true(text.includes('Active plans'));
	t.true(text.includes('demo.md'));
	t.true(text.includes('ownership='));
	t.true(
		text.includes('ownership=untagged_recoverable') ||
			text.includes('ownership=none') ||
			text.includes('ownership=foreign'),
	);
	t.true(text.includes('lock='));
});

test.serial('uncheck_step clears a checked step', async t => {
	const {dir, planPath} = await makeMutablePlan();
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

test('create with phases produces files/steps and validates clean', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-plancreate-ph-'));
	// Existing file so missing_file does not fire for it.
	const existingRel = path.join('src', 'existing.ts');
	await fs.mkdir(path.join(dir, 'src'), {recursive: true});
	await fs.writeFile(path.join(dir, existingRel), 'export {};\n', 'utf8');

	const created = await run(dir, {
		action: 'create',
		title: 'Phased Feature',
		complexity: 'medium',
		context: 'structured phases test',
		phases: [
			{
				title: 'Implement',
				files: [existingRel, 'src/brand-new.ts (new)'],
				steps: ['touch existing', 'add brand-new'],
				doneWhen: 'build passes; diagnostics clean',
			},
		],
		analysis: 'Affects auth path only.',
	});
	t.falsy(created.isError);
	const text = resultText(created);
	const match = text.match(/Created draft plan at (.+?) \(complexity=/);
	t.truthy(match);
	const planPath = match![1]!.trim();
	const doc = await parsePlanDocument(planPath);
	t.is(doc.frontmatter.status, 'draft');
	t.true(doc.phases.length >= 1);
	t.true(doc.phases[0]!.files.some(f => f.includes('existing.ts')));
	t.true(doc.phases[0]!.files.some(f => f.includes('brand-new.ts')));
	t.true(doc.phases[0]!.steps.some(s => s.text === 'touch existing'));
	t.true(doc.raw.includes('Affects auth path only.'));

	const {validatePlanDocument} = await import(
		'../utils/execution/planDocument.js'
	);
	const issues = validatePlanDocument(doc, dir);
	t.deepEqual(
		issues.filter(i => i.code === 'missing_file'),
		[],
	);
	t.true(issues.every(i => i.code !== 'phase_no_steps'));
});

test('write_body preserves draft status', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-writebody-'));
	const created = await run(dir, {
		action: 'create',
		title: 'Draft Body',
		complexity: 'simple',
	});
	const match = resultText(created).match(
		/Created draft plan at (.+?) \(complexity=/,
	);
	t.truthy(match);
	const planPath = match![1]!.trim();

	const written = await run(dir, {
		action: 'write_body',
		plan_path: planPath,
		phases: [
			{
				title: 'Rewrite',
				files: ['src/new-only.ts (new)'],
				steps: ['rewrite body'],
				doneWhen: 'ok',
			},
		],
		context: 'updated context',
	});
	t.falsy(written.isError);
	t.true(resultText(written).includes('status=draft preserved'));

	const doc = await parsePlanDocument(planPath);
	t.is(doc.frontmatter.status, 'draft');
	t.true(doc.raw.includes('updated context'));
	t.true(doc.phases[0]!.steps.some(s => s.text === 'rewrite body'));
});

test('write_body rejects executing status', async t => {
	const {dir, planPath} = await makePlanDir();
	const result = await run(dir, {
		action: 'write_body',
		plan_path: planPath,
		body_markdown: '# Nope\n\n## Context\n\nx\n',
	});
	t.true(result.isError === true);
	t.true(resultText(result).includes('only allowed for draft/approved'));
});

test('write_body requires body_markdown or phases', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-writebody-req-'));
	const created = await run(dir, {
		action: 'create',
		title: 'Needs Body',
		complexity: 'simple',
	});
	const match = resultText(created).match(
		/Created draft plan at (.+?) \(complexity=/,
	);
	t.truthy(match);
	const planPath = match![1]!.trim();

	const missing = await run(dir, {
		action: 'write_body',
		plan_path: planPath,
	});
	t.true(missing.isError === true);
	t.true(resultText(missing).includes('requires "body_markdown"'));
});

test('mutations require adopt for recoverable ownership', async t => {
	const {dir} = await makePlanDir();
	const denied = await run(dir, {action: 'check_step', step_index: 1});
	t.true(denied.isError === true);
	t.true(resultText(denied).includes('ownership=untagged_recoverable'));
	t.true(resultText(denied).includes('adopt'));
});

test.serial(
	'mutations reject foreign_live ownership without adopt force',
	async t => {
		const {dir, planPath} = await makePlanDir();
		const content = await fs.readFile(planPath, 'utf8');
		await fs.writeFile(
			planPath,
			content.replace("session: ''", 'session: foreign-owner'),
			'utf8',
		);

		// Live foreign lock held by a different session (same process pid is fine).
		const lock = await acquirePlanOwnerLock(dir, {
			planPath,
			sessionId: 'foreign-owner',
		});
		t.true(lock.ok);

		// No current session → findActivePlan can surface the foreign plan.
		sessionManager.clearCurrentSession();
		const denied = await run(dir, {action: 'check_step', step_index: 1});
		t.true(denied.isError === true);
		const text = resultText(denied);
		t.true(text.includes('ownership=foreign_live'));
		t.true(text.includes('force=true'));

		// get via plan_path returns read-only summary.
		const get = await run(dir, {action: 'get', plan_path: planPath});
		t.falsy(get.isError);
		const getText = resultText(get);
		t.true(getText.includes('Ownership: foreign_live'));
		t.true(getText.includes('Can mutate: false'));
		t.true(getText.includes('read-only'));

		await fs.unlink(getPlanOwnerLockPath(dir)).catch(() => {});
	},
);

test.serial('abandon archives plan with abandoned status', async t => {
	const {dir, planPath} = await makeMutablePlan();
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

test.serial(
	'adopt without force rejects foreign_live; force+reason succeeds',
	async t => {
		const {dir, planPath} = await makePlanDir();
		const content = await fs.readFile(planPath, 'utf8');
		await fs.writeFile(
			planPath,
			content.replace("session: ''", 'session: foreign-owner'),
			'utf8',
		);
		const lock = await acquirePlanOwnerLock(dir, {
			planPath,
			sessionId: 'foreign-owner',
		});
		t.true(lock.ok);

		setTestSession('session-b');
		const denied = await run(dir, {action: 'adopt', plan_path: planPath});
		t.true(denied.isError === true);
		const deniedText = resultText(denied);
		t.true(deniedText.includes('foreign_live'));
		t.true(deniedText.includes('force'));

		const forced = await run(dir, {
			action: 'adopt',
			plan_path: planPath,
			force: true,
			reason: 'takeover for tests',
		});
		t.falsy(forced.isError);
		t.true(resultText(forced).includes('Adopted plan'));
		t.true(resultText(forced).includes('tookOver=true'));

		await fs.unlink(getPlanOwnerLockPath(dir)).catch(() => {});
	},
);

test.serial(
	'adopt without force allows foreign hard-stale dead owner',
	async t => {
		const {dir, planPath} = await makePlanDir();
		const content = await fs.readFile(planPath, 'utf8');
		await fs.writeFile(
			planPath,
			content.replace("session: ''", 'session: foreign-dead'),
			'utf8',
		);
		// No lock → foreign_hard_stale; no force required.
		setTestSession('session-b');
		const ok = await run(dir, {action: 'adopt', plan_path: planPath});
		t.falsy(ok.isError);
		t.true(resultText(ok).includes('Adopted plan'));
		const doc = await parsePlanDocument(planPath);
		t.is(doc.frontmatter.session, 'session-b');
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
