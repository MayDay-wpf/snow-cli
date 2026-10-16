import anyTest, {type TestFn} from 'ava';
import {resolve} from 'node:path';
import {
	buildDefaultExportFileName,
	getDefaultExportDirectory,
	resolveExportFilePath,
} from '../../../utils/session/chatExporter.js';
import {getSnowPath} from '../../../utils/core/snowContext.js';

const test = anyTest as unknown as TestFn;

test('default export directory is under exports domain of snowContext', t => {
	t.is(getDefaultExportDirectory(), getSnowPath('exports', 'global').native);
});

test('default export file name includes timestamp and short session id', t => {
	const name = buildDefaultExportFileName(
		'5f8b9ad2-654e-4225-87d7-376ede637c5a',
		'md',
	);
	t.regex(
		name,
		/^snow-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-5f8b9ad2\.md$/,
	);
});

test('resolveExportFilePath defaults to exports domain of snowContext and not process.cwd()', t => {
	const sessionId = 'ab410e8a-4694-4f63-9750-edceaa66f1d9';
	const filePath = resolveExportFilePath(sessionId, 'md');
	const expectedDir = getSnowPath('exports', 'global').native;

	t.true(filePath.startsWith(expectedDir));
	t.false(
		filePath.startsWith(process.cwd() + '\\') ||
			filePath.startsWith(process.cwd() + '/'),
	);
	t.regex(
		filePath.replace(/\\/g, '/'),
		/\.snow\/exports\/snow-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-ab410e8a\.md$/,
	);
});

test('resolveExportFilePath honors explicit --out relative and absolute paths', t => {
	const relative = resolveExportFilePath('id', 'txt', 'out/chat.txt');
	t.is(relative, resolve('out/chat.txt'));

	const absolute = resolveExportFilePath('id', 'json', resolve('chat.json'));
	t.is(absolute, resolve('chat.json'));
});
