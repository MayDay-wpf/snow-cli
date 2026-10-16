import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
	formatBytes,
	scanPathStats,
	getCleanupCategories,
	deleteOlderThan,
} from '../../../utils/core/cleanupService.js';

test('formatBytes formats binary unit levels properly', t => {
	t.is(formatBytes(0), '0 B');
	t.is(formatBytes(-100), '0 B');
	t.is(formatBytes(500), '500 B');
	t.is(formatBytes(1024), '1.0 KB');
	t.is(formatBytes(1024 * 1024 * 5), '5.0 MB');
	t.is(formatBytes(1024 * 1024 * 1024 * 2.5), '2.5 GB');
});

test('getCleanupCategories returns filtered categories by scope', t => {
	const all = getCleanupCategories();
	t.true(all.length >= 10);

	const proj = getCleanupCategories('project');
	t.true(proj.every(c => c.scope === 'project'));

	const glob = getCleanupCategories('global');
	t.true(glob.every(c => c.scope === 'global'));
});

test('scanPathStats accurately counts files and bytes recursively', t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-clean-stat-'));
	try {
		const f1 = path.join(tempDir, 'a.txt');
		const sub = path.join(tempDir, 'sub');
		fs.mkdirSync(sub);
		const f2 = path.join(sub, 'b.txt');

		fs.writeFileSync(f1, 'hello'); // 5 bytes
		fs.writeFileSync(f2, 'world!'); // 6 bytes

		const stats = scanPathStats(tempDir);
		t.is(stats.files, 2);
		t.is(stats.bytes, 11);

		// Non-existent path
		const nonExistent = scanPathStats(path.join(tempDir, 'none'));
		t.is(nonExistent.files, 0);
		t.is(nonExistent.bytes, 0);
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('deleteOlderThan deletes files strictly older than cutoff', t => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-clean-time-'));
	const prevEnv = process.env['SNOW_CONFIG_DIR'];
	process.env['SNOW_CONFIG_DIR'] = tempRoot;

	try {
		const logDir = path.join(tempRoot, 'log');
		fs.mkdirSync(logDir, {recursive: true});

		const oldFile = path.join(logDir, 'old.log');
		const newFile = path.join(logDir, 'new.log');

		fs.writeFileSync(oldFile, 'old-log-entry');
		fs.writeFileSync(newFile, 'new-log-entry');

		// Modify mtime of oldFile to 10 days ago
		const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		fs.utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

		const result = deleteOlderThan(7, ['logs']);
		t.is(result.deletedFiles, 1);
		t.false(fs.existsSync(oldFile));
		t.true(fs.existsSync(newFile));
	} finally {
		if (prevEnv !== undefined) {
			process.env['SNOW_CONFIG_DIR'] = prevEnv;
		} else {
			delete process.env['SNOW_CONFIG_DIR'];
		}
		fs.rmSync(tempRoot, {recursive: true, force: true});
	}
});
