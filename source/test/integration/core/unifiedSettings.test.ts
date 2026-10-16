import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
	readSettings,
	writeSettings,
	getSettingsPath,
	type UnifiedSettings,
} from '../../../utils/config/unifiedSettings.js';

// ============================================================================
// Core Domain (L1 Integration): unifiedSettings 统一配置原子读写与项目/全局隔离
// 依据 testing-scenario-cli 沙箱隔离原则
// ============================================================================

test('unifiedSettings: readSettings returns empty object when settings.json does not exist', t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-settings-missing-'));
	try {
		const settings = readSettings('project', tempDir);
		t.deepEqual(settings, {});
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('unifiedSettings: writeSettings creates .snow directory and persists structured settings atomically', t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-settings-write-'));
	try {
		const payload: UnifiedSettings = {
			yoloMode: true,
			terminalShell: 'pwsh',
			subAgentMaxSpawnDepth: 3,
			fileListDisplayMode: 'tree',
		};

		writeSettings('project', payload, tempDir);

		const settingsFile = getSettingsPath('project', tempDir);
		t.true(fs.existsSync(settingsFile));

		const loaded = readSettings('project', tempDir);
		t.is(loaded.yoloMode, true);
		t.is(loaded.terminalShell, 'pwsh');
		t.is(loaded.subAgentMaxSpawnDepth, 3);
		t.is(loaded.fileListDisplayMode, 'tree');
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('unifiedSettings: readSettings gracefully handles corrupted JSON without crashing', t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-settings-corrupt-'));
	try {
		const snowDir = path.join(tempDir, '.snow');
		fs.mkdirSync(snowDir, {recursive: true});
		fs.writeFileSync(path.join(snowDir, 'settings.json'), '{ broken JSON syntax!!', 'utf8');

		const settings = readSettings('project', tempDir);
		t.deepEqual(settings, {}, 'Corrupted settings must safely fall back to empty object');
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});
