import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';
import {writeFileSmart} from '../mcp/utils/filesystem/edit-tools.utils.js';
import {
	tryWriteFileWithNativeAccelerator,
	writeFileWithNative,
} from '../mcp/utils/filesystem/native-edit.utils.js';

const test = anyTest as unknown as TestFn;

test('native write returns false when the accelerator is unavailable', async t => {
	t.false(
		await tryWriteFileWithNativeAccelerator(undefined, 'unused', 'value'),
	);
});

test('native write returns true only after the writer succeeds', async t => {
	let received: {path: string; content: string} | undefined;
	const result = await tryWriteFileWithNativeAccelerator(
		{
			async writeFile(filePath, content) {
				received = {path: filePath, content};
			},
		},
		'target.txt',
		'updated',
	);

	t.true(result);
	t.deepEqual(received, {path: 'target.txt', content: 'updated'});
});

test('native write returns false when the writer rejects', async t => {
	const result = await tryWriteFileWithNativeAccelerator(
		{
			async writeFile() {
				throw new Error('native failure');
			},
		},
		'target.txt',
		'updated',
	);

	t.false(result);
});

test('source runtime reports native unavailable and smart write falls back', async t => {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), 'snow-native-fallback-'),
	);
	const filePath = path.join(directory, 'fallback.txt');

	t.false(await writeFileWithNative(filePath, 'native-only'));
	await writeFileSmart(filePath, 'node-fallback');
	t.is(await fs.readFile(filePath, 'utf8'), 'node-fallback');
});
