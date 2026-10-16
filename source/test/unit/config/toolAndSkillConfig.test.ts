import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
	loadPermissionsConfig,
	savePermissionsConfig,
	addToolToPermissions,
	removeToolFromPermissions,
	clearAllPermissions,
} from '../../../utils/config/permissionsConfig.js';
import {
	getDisabledSkills,
	isSkillEnabled,
	toggleSkill,
} from '../../../utils/config/disabledSkills.js';
import {
	isMCPToolEnabled,
	toggleMCPTool,
	getDisabledMCPTools,
} from '../../../utils/config/disabledMCPTools.js';

test('permissionsConfig loads, adds, removes and clears tool permissions', t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-perm-'));
	try {
		const initial = loadPermissionsConfig(tempDir);
		t.deepEqual(initial.alwaysApprovedTools, []);

		addToolToPermissions(tempDir, 'filesystem:read_file');
		addToolToPermissions(tempDir, 'bash:execute');
		const loaded = loadPermissionsConfig(tempDir);
		t.is(loaded.alwaysApprovedTools.length, 2);
		t.true(loaded.alwaysApprovedTools.includes('bash:execute'));

		removeToolFromPermissions(tempDir, 'bash:execute');
		t.is(loadPermissionsConfig(tempDir).alwaysApprovedTools.length, 1);

		clearAllPermissions(tempDir);
		t.is(loadPermissionsConfig(tempDir).alwaysApprovedTools.length, 0);
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('disabledSkills and disabledMCPTools toggle state cleanly', t => {
	const testSkill = '__mock_test_skill__';
	t.true(isSkillEnabled(testSkill));

	// Toggle off
	const enabledAfterFirst = toggleSkill(testSkill);
	t.false(enabledAfterFirst);
	t.false(isSkillEnabled(testSkill));
	t.true(getDisabledSkills().includes(testSkill));

	// Toggle back on
	const enabledAfterSecond = toggleSkill(testSkill);
	t.true(enabledAfterSecond);
	t.true(isSkillEnabled(testSkill));

	// MCP tool disable test
	const svc = '__mock_svc__';
	const tool = '__mock_tool__';
	t.true(isMCPToolEnabled(svc, tool));

	toggleMCPTool(svc, tool, 'project');
	t.false(isMCPToolEnabled(svc, tool));

	toggleMCPTool(svc, tool, 'project');
	t.true(isMCPToolEnabled(svc, tool));
});
