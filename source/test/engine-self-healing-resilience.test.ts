import test from 'ava';
import os from 'node:os';
import path from 'node:path';
import {
	isHomeOrRootDirectory,
	validateGitignore,
} from '../utils/codebase/gitignoreValidator.js';
import {
	GREP_EXCLUDE_DIRS,
} from '../mcp/utils/aceCodeSearch/constants.utils.js';
import {
	DEFAULT_EXCLUDES,
} from '../mcp/utils/aceCodeSearch/filesystem.utils.js';
import {
	cleanupSessionResources,
} from '../utils/core/globalCleanup.js';

test('isHomeOrRootDirectory correctly detects user home directory', t => {
	const home = os.homedir();
	t.true(isHomeOrRootDirectory(home));
	t.true(isHomeOrRootDirectory(path.resolve(home)));
});

test('isHomeOrRootDirectory correctly detects filesystem root', t => {
	const root = path.parse(process.cwd()).root;
	t.true(isHomeOrRootDirectory(root));
});

test('isHomeOrRootDirectory does not misclassify normal project directory', t => {
	const projectDir = path.join(os.homedir(), 'projects', 'test-app');
	t.false(isHomeOrRootDirectory(projectDir));
});

test('isHomeOrRootDirectory correctly handles casing normalization on Windows', t => {
	const home = os.homedir();
	if (process.platform === 'win32') {
		t.true(isHomeOrRootDirectory(home.toLowerCase()));
		t.true(isHomeOrRootDirectory(home.toUpperCase()));
	} else {
		t.true(isHomeOrRootDirectory(home));
	}
});

test('isHomeOrRootDirectory correctly detects multi-user parent directory', t => {
	const usersDir = path.dirname(os.homedir());
	t.true(isHomeOrRootDirectory(usersDir));
});

test('validateGitignore skips indexing gracefully for home directory without error storm', t => {
	const home = os.homedir();
	const result = validateGitignore(home);
	t.false(result.isValid);
	t.true(result.isHomeOrRoot);
	t.truthy(result.error);
	t.regex(result.error!, /skipped/i);
});

test('GREP_EXCLUDE_DIRS contains AppData and major developer runtime caches', t => {
	const requiredExcludes = [
		'AppData',
		'Application Data',
		'Local Settings',
		'Library',
		'.snow',
		'.cargo',
		'.rustup',
		'.npm',
		'.vscode',
		'.docker',
		'.pnpm-store',
		'.turbo',
		'.pytest_cache',
		'$RECYCLE.BIN',
		'System Volume Information',
		'WindowsApps',
		'.Trash',
		'.ollama',
		'proc',
		'sys',
		'dev',
		'.svelte-kit',
		'.svn',
		'bin',
		'obj',
		'CMakeFiles',
		'.ipynb_checkpoints',
		'.vite',
		'.android',
		'.codeql',
	];

	for (const dir of requiredExcludes) {
		t.true(
			GREP_EXCLUDE_DIRS.includes(dir),
			`GREP_EXCLUDE_DIRS should contain ${dir}`,
		);
	}
});

test('DEFAULT_EXCLUDES contains AppData and major developer runtime caches', t => {
	const requiredExcludes = [
		'AppData',
		'Application Data',
		'Local Settings',
		'Library',
		'.snow',
		'.cargo',
		'.rustup',
		'.npm',
		'.vscode',
		'.docker',
		'.pnpm-store',
		'.turbo',
		'.pytest_cache',
		'$RECYCLE.BIN',
		'System Volume Information',
		'WindowsApps',
		'.Trash',
		'.ollama',
		'proc',
		'sys',
		'dev',
		'.svelte-kit',
		'.svn',
		'bin',
		'obj',
		'CMakeFiles',
		'.ipynb_checkpoints',
		'.vite',
		'.android',
		'.codeql',
	];

	for (const dir of requiredExcludes) {
		t.true(
			DEFAULT_EXCLUDES.includes(dir),
			`DEFAULT_EXCLUDES should contain ${dir}`,
		);
	}
});

test('cleanupSessionResources executes smoothly without throwing', async t => {
	await t.notThrowsAsync(async () => {
		await cleanupSessionResources();
	});
});
