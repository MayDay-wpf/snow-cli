import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';

import {importFreshPluginModule} from '../utils/plugins/importFresh.js';

const test = anyTest as unknown as TestFn;

test('fresh plugin loader invalidates CommonJS cache', async t => {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), 'snow-plugin-fresh-'),
	);
	const pluginPath = path.join(directory, 'plugin.cjs');

	try {
		await fs.writeFile(pluginPath, 'module.exports = {value: 1};\n', 'utf8');
		const first = await importFreshPluginModule(pluginPath);
		t.is((first['default'] as {value?: number})?.value, 1);

		await fs.writeFile(pluginPath, 'module.exports = {value: 2};\n', 'utf8');
		const second = await importFreshPluginModule(pluginPath);
		t.is((second['default'] as {value?: number})?.value, 2);
	} finally {
		await fs.rm(directory, {recursive: true, force: true});
	}
});

test('fresh plugin loader handles cyclic CommonJS dependencies', async t => {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), 'snow-plugin-cycle-'),
	);
	const pluginPath = path.join(directory, 'plugin.cjs');
	const dependencyPath = path.join(directory, 'dependency.cjs');
	const cyclePath = path.join(directory, 'cycle.cjs');

	try {
		await fs.writeFile(
			pluginPath,
			"module.exports = require('./dependency.cjs');\n",
			'utf8',
		);
		await fs.writeFile(
			dependencyPath,
			"exports.value = 1; exports.fromCycle = require('./cycle.cjs').value;\n",
			'utf8',
		);
		await fs.writeFile(
			cyclePath,
			"module.exports = {value: require('./dependency.cjs').value};\n",
			'utf8',
		);

		const first = await importFreshPluginModule(pluginPath);
		t.deepEqual(first['default'], {value: 1, fromCycle: 1});

		await fs.writeFile(
			dependencyPath,
			"exports.value = 2; exports.fromCycle = require('./cycle.cjs').value;\n",
			'utf8',
		);
		const second = await importFreshPluginModule(pluginPath);
		t.deepEqual(second['default'], {value: 2, fromCycle: 2});
	} finally {
		await fs.rm(directory, {recursive: true, force: true});
	}
});
