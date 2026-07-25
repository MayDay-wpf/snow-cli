import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executePlanManageTool} from '../mcp/planManage.js';
import {parsePlanDocument} from '../utils/execution/planDocument.js';

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
