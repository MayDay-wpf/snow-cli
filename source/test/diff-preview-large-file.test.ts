import anyTest, {type TestFn} from 'ava';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
	computeReplaceEditPreview,
	readOriginalFile,
} from '../utils/ui/diffPreview.js';

const test = anyTest as unknown as TestFn;

function buildLargeContent(lineCount: number): string {
	const lines: string[] = [];
	for (let i = 1; i <= lineCount; i++) {
		lines.push(`const value${i} = ${i};`);
	}

	return lines.join('\n');
}

test('computeReplaceEditPreview applies exact matches in large files', t => {
	const content = buildLargeContent(25_000);
	const search = 'const value12345 = 12345;';
	const startedAt = Date.now();
	const result = computeReplaceEditPreview(
		content,
		search,
		'const value12345 = 0;',
	);

	t.true(result.includes('const value12345 = 0;'));
	t.false(result.includes(search));
	// Guard against the previous O(n*m) sliding-window scan on the UI thread.
	t.true(Date.now() - startedAt < 2000);
});

test('computeReplaceEditPreview respects occurrence for exact matches', t => {
	const content = ['alpha', 'beta', 'alpha', 'beta'].join('\n');
	const result = computeReplaceEditPreview(content, 'alpha', 'gamma', 2);

	t.is(result, ['alpha', 'beta', 'gamma', 'beta'].join('\n'));
});

test('computeReplaceEditPreview still resolves fuzzy matches in large files', t => {
	const content = buildLargeContent(25_000);
	// Whitespace differs from the file, so the exact fast path does not hit and
	// the similarity scan has to locate the region.
	const search = 'const  value20000  =  20000;';
	const startedAt = Date.now();
	const result = computeReplaceEditPreview(
		content,
		search,
		'const value20000 = 0;',
	);

	t.true(result.includes('const value20000 = 0;'));
	t.true(result.includes('const value19999 = 19999;'));
	t.true(result.includes('const value20001 = 20001;'));
	t.true(Date.now() - startedAt < 2000);
});

test('readOriginalFile does not skip large files', t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-diff-preview-'));
	const filePath = path.join(directory, 'large.txt');
	const content = 'x'.repeat(2 * 1024 * 1024 + 1);
	fs.writeFileSync(filePath, content);

	try {
		t.is(readOriginalFile(filePath)?.length, content.length);
	} finally {
		fs.rmSync(directory, {recursive: true, force: true});
	}
});
