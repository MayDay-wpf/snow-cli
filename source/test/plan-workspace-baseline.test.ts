import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';
import {
	capturePlanWorkspaceBaseline,
	changedSinceBaseline,
	findOutOfScopeChanges,
} from '../utils/execution/planWorkspaceBaseline.js';

const test = anyTest as unknown as TestFn;

test('workspace baseline detects new and modified dirty files but ignores plan state', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-plan-baseline-'));
	execFileSync('git', ['init'], {cwd: dir, stdio: 'ignore'});
	await fs.writeFile(path.join(dir, 'allowed.ts'), 'before\n', 'utf8');
	const before = await capturePlanWorkspaceBaseline(dir);
	t.true(before.available);

	await fs.writeFile(path.join(dir, 'allowed.ts'), 'after\n', 'utf8');
	await fs.writeFile(path.join(dir, 'outside.ts'), 'new\n', 'utf8');
	await fs.mkdir(path.join(dir, '.snow', 'plan'), {recursive: true});
	await fs.writeFile(
		path.join(dir, '.snow', 'plan', 'state.md'),
		'x\n',
		'utf8',
	);
	const after = await capturePlanWorkspaceBaseline(dir);
	const changed = changedSinceBaseline(before.baseline, after.baseline);

	t.deepEqual(changed, ['allowed.ts', 'outside.ts']);
	t.deepEqual(findOutOfScopeChanges(changed, ['allowed.ts']), ['outside.ts']);
});
