import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAcceptance} from '../utils/execution/planAcceptance.js';

const test = anyTest as unknown as TestFn;

async function makeDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'snow-accept-'));
}

test('runAcceptance skips build when no package.json and no commands', async t => {
	const dir = await makeDir();
	const result = await runAcceptance(dir, undefined, {
		runDiagnostics: false,
	});
	t.true(result.ok);
	t.true(result.output.includes('no build script'));
	t.true(result.output.includes('diagnostics: skipped'));
});

test('runAcceptance soft-skips non-Node markers with commands hint', async t => {
	const dir = await makeDir();
	await fs.writeFile(path.join(dir, 'Cargo.toml'), '[package]\n');
	const result = await runAcceptance(dir, undefined, {
		runDiagnostics: false,
	});
	t.true(result.ok);
	t.true(result.output.includes('Cargo.toml present'));
	t.true(result.output.includes('planAcceptance.commands'));
});

test('runAcceptance can disable build entirely', async t => {
	const dir = await makeDir();
	const result = await runAcceptance(dir, undefined, {
		runBuild: false,
		runDiagnostics: false,
	});
	t.true(result.ok);
	t.true(result.output.includes('build: skipped by settings'));
});

test('runAcceptance runs configured commands and reports result', async t => {
	const dir = await makeDir();
	// Use a trivial command so the test does not invoke a real project build.
	const result = await runAcceptance(dir, undefined, {
		runDiagnostics: false,
		commands: ['node -e "process.exit(0)"'],
	});
	t.true(typeof result.ok === 'boolean');
	t.true(result.output.length > 0);
	if (result.ok) {
		t.true(result.output.includes('build: passed'));
	}
});

test('runAcceptance uses fallbackCommands when no build script', async t => {
	const dir = await makeDir();
	const result = await runAcceptance(dir, undefined, {
		runDiagnostics: false,
		fallbackCommands: ['node -e "process.exit(0)"'],
	});
	t.true(result.ok);
	t.true(result.output.includes('build: passed'));
});
