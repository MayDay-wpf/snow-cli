import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';
import {
	runLegacyConfigMigration,
	__resetLegacyConfigMigrationForTesting,
} from '../../../utils/config/legacyConfigMigration.js';
import {readSettings} from '../../../utils/config/unifiedSettings.js';
import {createSandboxDir} from '../../helpers/sandbox.js';

test('legacyConfigMigration: migrates disabled-skills, mcp-config, and working-dirs into unified settings', t => {
	const sandbox = createSandboxDir();
	try {
		const snowDir = path.join(sandbox.cwd, '.snow');
		fs.mkdirSync(snowDir, {recursive: true});

		// 1. Populate legacy split config files
		const legacySkills = {disabledSkills: ['skill-alpha', 'skill-beta']};
		fs.writeFileSync(
			path.join(snowDir, 'disabled-skills.json'),
			JSON.stringify(legacySkills, null, 2),
			'utf-8',
		);

		const legacyMcp = {
			mcpServers: {
				weather: {
					command: 'npx',
					args: ['-y', '@modelcontextprotocol/server-weather'],
				},
			},
		};
		fs.writeFileSync(
			path.join(snowDir, 'mcp-config.json'),
			JSON.stringify(legacyMcp, null, 2),
			'utf-8',
		);

		const legacyWorkingDirs = {
			directories: [
				{
					path: 'C:/projects/demo',
					isDefault: true,
					addedAt: 1710000000000,
				},
			],
		};
		fs.writeFileSync(
			path.join(snowDir, 'working-dirs.json'),
			JSON.stringify(legacyWorkingDirs, null, 2),
			'utf-8',
		);

		// Reset migration state
		__resetLegacyConfigMigrationForTesting();

		// Run migration for project scope
		const result = runLegacyConfigMigration(sandbox.cwd);
		t.truthy(result.project);
		t.true(result.project?.migratedFiles.includes('disabled-skills.json'));
		t.true(result.project?.migratedFiles.includes('mcp-config.json'));
		t.true(result.project?.migratedFiles.includes('working-dirs.json'));

		// 2. Verify unified settings.json has absorbed legacy keys
		const settings = readSettings('project', sandbox.cwd);
		t.deepEqual(settings.disabledSkills, ['skill-alpha', 'skill-beta']);
		t.truthy(settings.mcpServers);
		t.truthy((settings.mcpServers as Record<string, unknown>)['weather']);
		t.is(settings.workingDirectories?.length, 1);
		t.is(settings.workingDirectories?.[0]?.path, 'C:/projects/demo');

		// 3. Verify legacy files were safely removed (safeUnlink)
		t.false(fs.existsSync(path.join(snowDir, 'disabled-skills.json')));
		t.false(fs.existsSync(path.join(snowDir, 'mcp-config.json')));
		t.false(fs.existsSync(path.join(snowDir, 'working-dirs.json')));

		// 4. Repeated invocation should be a no-op idempotent call
		const secondRun = runLegacyConfigMigration(sandbox.cwd);
		t.is(secondRun.project, null);
	} finally {
		sandbox.cleanup();
		__resetLegacyConfigMigrationForTesting();
	}
});
