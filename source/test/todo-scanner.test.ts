import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {scanProjectTodos} from '../utils/core/todoScanner.js';

const test = anyTest as unknown as TestFn;

test('scanProjectTodos ignores only complete excluded path segments', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-todos-'));

	try {
		await Promise.all([
			fs.mkdir(path.join(root, 'build'), {recursive: true}),
			fs.mkdir(path.join(root, 'builder'), {recursive: true}),
			fs.mkdir(path.join(root, '.github'), {recursive: true}),
		]);
		await Promise.all([
			fs.writeFile(path.join(root, 'build', 'ignored.ts'), '// TODO ignored'),
			fs.writeFile(
				path.join(root, 'builder', 'kept.ts'),
				'// TODO keep builder',
			),
			fs.writeFile(
				path.join(root, '.github', 'kept.yml'),
				'# TODO keep github',
			),
			fs.writeFile(path.join(root, 'debug.log'), '// TODO ignored log'),
		]);

		const todos = scanProjectTodos(root);
		t.deepEqual(todos.map(todo => todo.content).sort(), [
			'keep builder',
			'keep github',
		]);
		t.true(todos.every(todo => todo.line === 1));
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
});
