import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	countDiagnosticErrors,
	detectDefaultBuildCommand,
	detectNonNodeSkipMessage,
	detectPackageManager,
} from '../utils/execution/planAcceptance.js';

const test = anyTest as unknown as TestFn;

async function makeDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'snow-accept-detect-'));
}

async function writePkg(
	dir: string,
	scripts: Record<string, string> = {build: 'tsc'},
): Promise<void> {
	await fs.writeFile(
		path.join(dir, 'package.json'),
		JSON.stringify({name: 'fixture', scripts}),
		'utf8',
	);
}

test('detectPackageManager prefers pnpm lockfile', async t => {
	const dir = await makeDir();
	await writePkg(dir);
	await fs.writeFile(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
	await fs.writeFile(path.join(dir, 'package-lock.json'), '{}');
	t.is(await detectPackageManager(dir), 'pnpm');
	t.is(await detectDefaultBuildCommand(dir), 'pnpm run build');
});

test('detectPackageManager prefers yarn.lock', async t => {
	const dir = await makeDir();
	await writePkg(dir);
	await fs.writeFile(path.join(dir, 'yarn.lock'), '# yarn lockfile v1\n');
	t.is(await detectPackageManager(dir), 'yarn');
	t.is(await detectDefaultBuildCommand(dir), 'yarn run build');
});

test('detectPackageManager prefers bun.lockb or bun.lock', async t => {
	const dir = await makeDir();
	await writePkg(dir);
	await fs.writeFile(path.join(dir, 'bun.lockb'), 'fake');
	t.is(await detectPackageManager(dir), 'bun');
	t.is(await detectDefaultBuildCommand(dir), 'bun run build');

	const dir2 = await makeDir();
	await writePkg(dir2);
	await fs.writeFile(path.join(dir2, 'bun.lock'), '{}');
	t.is(await detectPackageManager(dir2), 'bun');
	t.is(await detectDefaultBuildCommand(dir2), 'bun run build');
});

test('detectPackageManager falls back to package-lock.json then npm', async t => {
	const withLock = await makeDir();
	await writePkg(withLock);
	await fs.writeFile(path.join(withLock, 'package-lock.json'), '{}');
	t.is(await detectPackageManager(withLock), 'npm');
	t.is(await detectDefaultBuildCommand(withLock), 'npm run build');

	const bare = await makeDir();
	await writePkg(bare);
	t.is(await detectPackageManager(bare), 'npm');
	t.is(await detectDefaultBuildCommand(bare), 'npm run build');
});

test('detectPackageManager uses preferPackageManager when no lockfile', async t => {
	const dir = await makeDir();
	await writePkg(dir);
	t.is(await detectPackageManager(dir, 'pnpm'), 'pnpm');
	t.is(
		await detectDefaultBuildCommand(dir, {preferPackageManager: 'pnpm'}),
		'pnpm run build',
	);
});

test('detectDefaultBuildCommand returns null without build script', async t => {
	const dir = await makeDir();
	await writePkg(dir, {test: 'ava'});
	t.is(await detectDefaultBuildCommand(dir), null);

	const empty = await makeDir();
	t.is(await detectDefaultBuildCommand(empty), null);
});

test('detectNonNodeSkipMessage soft-skips Cargo/go/python markers', async t => {
	const cargo = await makeDir();
	await fs.writeFile(path.join(cargo, 'Cargo.toml'), '[package]\n');
	const cargoMsg = await detectNonNodeSkipMessage(cargo);
	t.truthy(cargoMsg);
	t.true(cargoMsg!.includes('Cargo.toml'));
	t.true(cargoMsg!.includes('planAcceptance.commands'));

	const go = await makeDir();
	await fs.writeFile(path.join(go, 'go.mod'), 'module example\n');
	const goMsg = await detectNonNodeSkipMessage(go);
	t.truthy(goMsg);
	t.true(goMsg!.includes('go.mod'));

	const py = await makeDir();
	await fs.writeFile(path.join(py, 'pyproject.toml'), '[project]\n');
	const pyMsg = await detectNonNodeSkipMessage(py);
	t.truthy(pyMsg);
	t.true(pyMsg!.includes('pyproject.toml'));

	const empty = await makeDir();
	t.is(await detectNonNodeSkipMessage(empty), null);
});

test('countDiagnosticErrors handles structured JSON and regex fallback', t => {
	t.is(
		countDiagnosticErrors([
			{severity: 'error', message: 'a'},
			{severity: 'Error', message: 'b'},
			{severity: 1, message: 'c'},
			{severity: 'warning', message: 'd'},
		]),
		3,
	);

	t.is(
		countDiagnosticErrors({
			diagnostics: [{severity: 'error'}, {severity: 0}],
		}),
		1,
	);

	t.is(
		countDiagnosticErrors(
			JSON.stringify([{severity: 'error'}, {severity: 'hint'}]),
		),
		1,
	);

	// Regex fallback for non-JSON text
	t.is(
		countDiagnosticErrors(
			'noise "severity": "error" more "severity":1 trailing',
		),
		2,
	);

	t.is(countDiagnosticErrors(null), 0);
	t.is(countDiagnosticErrors({severity: 'warning'}), 0);
});
