import anyTest, {type TestFn} from 'ava';

import {extractMultimodalContent} from '../utils/execution/toolResultNormalizer.js';

const test = anyTest as unknown as TestFn;

const sampleBase64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('extractMultimodalContent handles direct multimodal array', t => {
	const result = extractMultimodalContent([
		{type: 'text', text: 'hello image'},
		{type: 'image', data: sampleBase64, mimeType: 'image/png'},
	]);

	t.is(result.textContent, 'hello image');
	t.false(result.textContent.includes(sampleBase64));
	t.deepEqual(result.images, [
		{type: 'image', data: sampleBase64, mimeType: 'image/png'},
	]);
});

test('extractMultimodalContent unwraps pure {content} wrapper', t => {
	const result = extractMultimodalContent({
		content: [
			{type: 'text', text: 'wrapped text'},
			{type: 'image', data: sampleBase64, mimeType: 'image/jpeg'},
		],
	});

	t.is(result.textContent, 'wrapped text');
	t.false(result.textContent.includes(sampleBase64));
	t.deepEqual(result.images, [
		{type: 'image', data: sampleBase64, mimeType: 'image/jpeg'},
	]);
});

test('extractMultimodalContent preserves wrapper metadata fields', t => {
	const result = extractMultimodalContent({
		content: [
			{type: 'text', text: 'metadata text'},
			{type: 'image', data: sampleBase64, mimeType: 'image/png'},
		],
		files: [{path: 'shot.png', isImage: true, mimeType: 'image/png'}],
		totalFiles: 1,
		isImage: true,
		mimeType: 'image/png',
	});

	const parsed = JSON.parse(result.textContent);
	t.is(parsed.content, 'metadata text');
	t.deepEqual(parsed.files, [
		{path: 'shot.png', isImage: true, mimeType: 'image/png'},
	]);
	t.is(parsed.totalFiles, 1);
	t.true(parsed.isImage);
	t.is(parsed.mimeType, 'image/png');
	t.false(result.textContent.includes(sampleBase64));
	t.deepEqual(result.images, [
		{type: 'image', data: sampleBase64, mimeType: 'image/png'},
	]);
});

test('extractMultimodalContent keeps plain string results', t => {
	const result = extractMultimodalContent('plain tool output');
	t.is(result.textContent, 'plain tool output');
	t.is(result.images, undefined);
});

test('extractMultimodalContent stringifies plain objects', t => {
	const payload = {success: true, value: 42};
	const result = extractMultimodalContent(payload);
	t.is(result.textContent, JSON.stringify(payload));
	t.is(result.images, undefined);
});
