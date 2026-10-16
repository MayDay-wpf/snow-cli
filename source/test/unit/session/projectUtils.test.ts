import test from 'ava';
import os from 'os';
import path from 'path';
import {
	getProjectId,
	getProjectName,
	sanitizeProjectName,
	resolveProjectIdentity,
} from '../../../utils/session/projectUtils.js';

test('sanitizeProjectName strips unsafe characters and formats properly', t => {
	t.is(sanitizeProjectName('snow:cli?v1*'), 'snow_cli_v1');
	t.is(sanitizeProjectName('  my  cool   project  '), 'my_cool_project');
	t.is(sanitizeProjectName('__leading_trailing__'), 'leading_trailing');
});

test('getProjectId generates deterministic directory and hash pair', t => {
	const fakeDir = path.join(os.tmpdir(), 'snow-sample-project');
	const id1 = getProjectId(fakeDir);
	const id2 = getProjectId(fakeDir);

	t.is(id1, id2);
	t.true(id1.startsWith('snow-sample-project-'));
	t.is(getProjectName(fakeDir), 'snow-sample-project');
});

test('resolveProjectIdentity identifies git and package root', t => {
	// Current repository root
	const identity = resolveProjectIdentity(process.cwd());
	t.truthy(identity.projectId);
	t.truthy(identity.projectRoot);
	t.truthy(identity.fingerprint);
	t.true(Array.isArray(identity.projectAliasIds));
});

test('projectUtils: formatDateCompact, isDateFolder and isProjectFolder invariants', async t => {
	const {formatDateCompact, isDateFolder, isProjectFolder} = await import(
		'../../../utils/session/projectUtils.js'
	);

	const d = new Date(2026, 9, 16); // 2026-10-16
	t.is(formatDateCompact(d), '20261016');

	t.true(isDateFolder('20261016'));
	t.true(isDateFolder('2026-10-16'));
	t.false(isDateFolder('not-a-date'));

	t.true(isProjectFolder('snow-cli-a1b2c3'));
	t.false(isProjectFolder('plain_directory'));
});

