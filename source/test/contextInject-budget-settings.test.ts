import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {resolveContextInjectConfig} from '../prompt/contextInject/defaults.js';

const test = anyTest as unknown as TestFn;

async function makeTempDir(prefix: string): Promise<string> {
	return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('resolveContextInjectConfig reads compactBudgetChars and perFileMax', async t => {
	const dir = await makeTempDir('snow-ctx-budget-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});

	const snowDir = path.join(dir, '.snow');
	await fs.promises.mkdir(snowDir, {recursive: true});
	await fs.promises.writeFile(
		path.join(snowDir, 'settings.json'),
		JSON.stringify(
			{
				contextInject: {
					enabled: true,
					compactBudgetChars: 1234,
					perFileMax: 4321,
				},
			},
			null,
			2,
		),
		'utf-8',
	);

	const cfg = resolveContextInjectConfig(dir);
	t.is(cfg.compactBudgetChars, 1234);
	t.is(cfg.perFileMax, 4321);
});
