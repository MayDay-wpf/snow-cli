import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
	isHomeOrRootDirectory,
	validateGitignore,
} from '../../../utils/codebase/gitignoreValidator.js';

test('isHomeOrRootDirectory detects home directory', t => {
	t.true(isHomeOrRootDirectory(os.homedir()));
	t.true(isHomeOrRootDirectory(os.homedir().toUpperCase()));
});

test('isHomeOrRootDirectory detects filesystem root', t => {
	const root = path.parse(process.cwd()).root;
	t.true(isHomeOrRootDirectory(root));
});

test('isHomeOrRootDirectory detects users parent directory', t => {
	const home = path.resolve(os.homedir());
	const usersParent = path.dirname(home);
	if (usersParent !== home && usersParent !== path.parse(home).root) {
		t.true(isHomeOrRootDirectory(usersParent));
	} else {
		t.pass();
	}
});

test('isHomeOrRootDirectory returns false for normal project directory', t => {
	t.false(isHomeOrRootDirectory(process.cwd()));
});

test('validateGitignore rejects home and root directory before checking file', t => {
	const res = validateGitignore(os.homedir());
	t.false(res.isValid);
	t.true(res.isHomeOrRoot);
	t.truthy(res.error);
});

test('validateGitignore checks .gitignore existence for regular directories', t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-git-val-'));
	try {
		// Without .gitignore
		const res1 = validateGitignore(tempDir);
		t.false(res1.isValid);
		t.falsy(res1.isHomeOrRoot);

		// With .gitignore
		fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules/\n');
		const res2 = validateGitignore(tempDir);
		t.true(res2.isValid);
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});
