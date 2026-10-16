import test from 'ava';
import {
	parseEnvBoolean,
	parseEnvInteger,
	parseEnvPath,
	withEnvOverrides,
} from '../../../utils/config/envConfig.js';
import {getGlobalSnowDir, getWorkspaceSnowDir, getSnowPath} from '../../../utils/core/snowContext.js';
import {createSandboxDir} from '../../helpers/sandbox.js';

test('envConfig: parseEnvBoolean enforces strict boolean semantics against JS truthiness', t => {
	// Standard truthy values
	t.true(parseEnvBoolean('true'));
	t.true(parseEnvBoolean('TRUE'));
	t.true(parseEnvBoolean('1'));
	t.true(parseEnvBoolean('yes'));

	// Falsey or poison values that raw Boolean("false") would misinterpret
	t.false(parseEnvBoolean('false'));
	t.false(parseEnvBoolean('FALSE'));
	t.false(parseEnvBoolean('0'));
	t.false(parseEnvBoolean('no'));
	t.false(parseEnvBoolean('random_string'));
	t.false(parseEnvBoolean(''));
	t.false(parseEnvBoolean(undefined));

	// Default fallback
	t.true(parseEnvBoolean(undefined, true));
});

test('envConfig: parseEnvInteger rejects NaN and negative values defensively', t => {
	t.is(parseEnvInteger('5000', 1000), 5000);
	t.is(parseEnvInteger('   12000  ', 1000), 12000);

	// NaN and poison values fallback to default safely
	t.is(parseEnvInteger('not-a-number', 60000), 60000);
	t.is(parseEnvInteger('-50', 1000, 0), 1000);
	t.is(parseEnvInteger('', 2000), 2000);
	t.is(parseEnvInteger(undefined, 2000), 2000);
});

test('envConfig: parseEnvPath normalizes path into structured object', t => {
	t.is(parseEnvPath(undefined), undefined);
	t.is(parseEnvPath('   '), undefined);

	const parsed = parseEnvPath('C:\\test\\snow_config');
	t.truthy(parsed);
	t.is(parsed?.posix, 'C:/test/snow_config');
	t.true(parsed?.isAbsolute);
});

test('envConfig: withEnvOverrides guarantees 100% clean teardown even upon thrown exceptions', async t => {
	const originalVal = process.env['SNOW_TEST_VAR'];

	await t.throwsAsync(async () => {
		await withEnvOverrides({SNOW_TEST_VAR: 'temporary-token'}, async () => {
			t.is(process.env['SNOW_TEST_VAR'], 'temporary-token');
			throw new Error('intentional boom');
		});
	});

	// Restored back to original
	t.is(process.env['SNOW_TEST_VAR'], originalVal);
});

test('snowContext: getGlobalSnowDir switches to sandbox when SNOW_CONFIG_DIR is present', async t => {
	const sandbox = createSandboxDir();

	try {
		await sandbox.runWithSandboxEnv(async () => {
			const globalDir = getGlobalSnowDir();
			t.is(globalDir.posix, sandbox.structuredConfigDir.posix);

			const logDir = getSnowPath('log', 'global');
			t.is(logDir.posix, `${sandbox.structuredConfigDir.posix}/log`);
		});
	} finally {
		sandbox.cleanup();
	}
});

test('snowContext: getWorkspaceSnowDir cleanly attaches to project directory', t => {
	const wsDir = getWorkspaceSnowDir('C:\\my_workspace');
	t.is(wsDir.posix, 'C:/my_workspace/.snow');
	t.is(getSnowPath('settings.json', 'workspace', 'C:/my_workspace').posix, 'C:/my_workspace/.snow/settings.json');
});
