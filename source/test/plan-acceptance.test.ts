import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';
import {
	runAcceptance,
	runPhaseChecks,
	validatePlanCheckCommand,
} from '../utils/execution/planAcceptance.js';

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

test('runPhaseChecks requires exact manual confirmations', async t => {
	const dir = await makeDir();
	const checks = [
		{type: 'manual' as const, description: 'verify the rendered screen'},
	];
	const missing = await runPhaseChecks(dir, checks);
	t.false(missing.ok);
	t.true(missing.output.includes('verify the rendered screen'));

	const confirmed = await runPhaseChecks(dir, checks, [
		'verify the rendered screen',
	]);
	t.true(confirmed.ok);
	t.true(confirmed.output.includes('manual checks confirmed: 1'));
});

test('plan check command policy blocks shell composition and dangerous commands', t => {
	t.is(validatePlanCheckCommand('npm test'), null);
	t.truthy(validatePlanCheckCommand('npm test && rm -rf dist'));
	t.truthy(validatePlanCheckCommand('npm test > result.txt'));
	t.truthy(validatePlanCheckCommand('npm test $(node hidden-check.js)'));
	t.truthy(validatePlanCheckCommand('npm test `node hidden-check.js`'));
	t.truthy(validatePlanCheckCommand('bash -c "npm test"'));
	t.truthy(validatePlanCheckCommand('powershell -Command "npm test"'));
	t.truthy(validatePlanCheckCommand('git push origin main'));
	t.truthy(
		validatePlanCheckCommand('pytest', {
			allowedCommandPrefixes: ['npm', 'pnpm'],
		}),
	);
	t.is(
		validatePlanCheckCommand('npm run test', {
			allowedCommandPrefixes: ['npm'],
		}),
		null,
	);
});

test('runPhaseChecks enforces command policy before execution', async t => {
	const dir = await makeDir();
	const result = await runPhaseChecks(dir, [
		{type: 'command', command: 'npm test > hidden.txt'},
	]);
	t.false(result.ok);
	t.true(result.output.includes('command policy FAILED'));
	await t.throwsAsync(async () => fs.access(path.join(dir, 'hidden.txt')));
});

test('strict acceptance fails when an enabled build check is unavailable', async t => {
	const dir = await makeDir();
	const result = await runAcceptance(dir, undefined, {
		policy: 'strict',
		runDiagnostics: false,
	});
	t.false(result.ok);
	t.true(result.output.includes('strict acceptance FAILED'));
	t.true(result.details.some(detail => detail.status === 'skipped'));
});

test('acceptance commands execute inside the requested project directory', async t => {
	const dir = await makeDir();
	const result = await runAcceptance(dir, undefined, {
		commands: [
			`node -e "require('fs').writeFileSync('acceptance-cwd.txt','ok')"`,
		],
		runDiagnostics: false,
	});
	t.true(result.ok);
	t.is(await fs.readFile(path.join(dir, 'acceptance-cwd.txt'), 'utf8'), 'ok');
});
