import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';
import {
	createPlanFileExclusively,
	replacePlanFileAtomically,
} from '../utils/execution/plan-persistence.js';

const test = anyTest as unknown as TestFn;

async function makeTemporaryDirectory(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'snow-plan-persistence-'));
}

test('exclusive Plan creation preserves an existing file', async t => {
	const directory = await makeTemporaryDirectory();
	const filePath = path.join(directory, 'plan.md');

	t.true(await createPlanFileExclusively(filePath, 'first'));
	t.false(await createPlanFileExclusively(filePath, 'second'));
	t.is(await fs.readFile(filePath, 'utf8'), 'first');
});

test('atomic Plan replacement writes complete content without temp residue', async t => {
	const directory = await makeTemporaryDirectory();
	const filePath = path.join(directory, 'plan.md');
	await fs.writeFile(filePath, 'before', 'utf8');

	await replacePlanFileAtomically(filePath, 'after\ncomplete\n');

	t.is(await fs.readFile(filePath, 'utf8'), 'after\ncomplete\n');
	t.deepEqual(await fs.readdir(directory), ['plan.md']);
});

test('failed atomic Plan replacement cleans its temporary file', async t => {
	const directory = await makeTemporaryDirectory();
	const destination = path.join(directory, 'destination');
	await fs.mkdir(destination);

	await t.throwsAsync(async () =>
		replacePlanFileAtomically(destination, 'cannot replace a directory'),
	);

	t.deepEqual(await fs.readdir(directory), ['destination']);
	t.deepEqual(await fs.readdir(destination), []);
});
