import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	getContextInjectEnabled,
	getContextInjectEnabledSource,
	setContextInjectEnabled,
} from '../utils/config/contextInjectSettings.js';
import {resolveContextInjectConfig} from '../prompt/contextInject/defaults.js';
import {runSessionCommand} from '../utils/execution/sessionCommandPlane.js';

const test = anyTest as unknown as TestFn;

async function makeTempProject(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-agents-inject-'));
	await fs.mkdir(path.join(dir, '.snow'), {recursive: true});
	return dir;
}

test('setContextInjectEnabled writes project settings and flips effective flag', async t => {
	const dir = await makeTempProject();

	// Project scope overrides any global contextInject when set.
	setContextInjectEnabled(true, 'project', dir);
	t.true(getContextInjectEnabled(dir));
	t.is(getContextInjectEnabledSource(dir), 'project');
	t.true(resolveContextInjectConfig(dir).enabled);

	const rawOn = await fs.readFile(
		path.join(dir, '.snow', 'settings.json'),
		'utf8',
	);
	const parsedOn = JSON.parse(rawOn) as {
		contextInject?: {enabled?: boolean};
	};
	t.is(parsedOn.contextInject?.enabled, true);

	setContextInjectEnabled(false, 'project', dir);
	t.false(getContextInjectEnabled(dir));
	t.is(getContextInjectEnabledSource(dir), 'project');
	t.false(resolveContextInjectConfig(dir).enabled);

	const rawOff = await fs.readFile(
		path.join(dir, '.snow', 'settings.json'),
		'utf8',
	);
	const parsedOff = JSON.parse(rawOff) as {
		contextInject?: {enabled?: boolean};
	};
	t.is(parsedOff.contextInject?.enabled, false);
});

test('session-command plane can status and toggle agents-inject', async t => {
	const status = await runSessionCommand({
		command: 'agents-inject',
		args: 'status',
		mode: 'agent',
	});
	t.true(status.ok, status.message);
	const original = Boolean((status.data as {enabled?: boolean})?.enabled);

	try {
		const on = await runSessionCommand({
			command: 'agents-inject',
			args: 'on',
			mode: 'agent',
		});
		t.true(on.ok, on.message);
		t.is((on.data as {enabled?: boolean})?.enabled, true);

		const statusAgain = await runSessionCommand({
			command: 'agents-inject',
			args: 'status',
			mode: 'agent',
		});
		t.true(statusAgain.ok, statusAgain.message);
		t.is((statusAgain.data as {enabled?: boolean})?.enabled, true);

		const off = await runSessionCommand({
			command: 'agents-inject',
			args: 'off',
			mode: 'agent',
		});
		t.true(off.ok, off.message);
		t.is((off.data as {enabled?: boolean})?.enabled, false);
	} finally {
		await runSessionCommand({
			command: 'agents-inject',
			args: original ? 'on' : 'off',
			mode: 'agent',
		});
	}
});
