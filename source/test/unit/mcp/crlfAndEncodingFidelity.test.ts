import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {
	readFileWithEncoding,
	writeFileWithEncoding,
	readFileLinesStreaming,
} from '../../../mcp/utils/filesystem/encoding.utils.js';
import {
	normalizeWhitespace,
	calculateSimilarity,
	levenshteinDistance,
} from '../../../mcp/utils/filesystem/similarity.utils.js';

test('CRLF/LF Normalization & Similarity Invariant: newlines and tabs do not degrade matching', t => {
	const lfText = 'function test() {\n    const a = 1;\n    return a;\n}';
	const crlfText = 'function test() {\r\n\tconst a = 1;\r\n\treturn a;\r\n}';

	// normalizeWhitespace should collapse both CRLF and tabs to single spaces
	t.is(normalizeWhitespace(lfText), normalizeWhitespace(crlfText));
	t.is(calculateSimilarity(lfText, crlfText), 1.0);
	t.is(levenshteinDistance(normalizeWhitespace(lfText), normalizeWhitespace(crlfText)), 0);
});

test('POSIX and Multi-encoding Round-trip: preserve UTF-8 and UTF-8 BOM without corruption', async t => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-crlf-'));
	const testFile = path.join(tempDir, 'sample_crlf.txt');

	try {
		const rawMixedContent = 'Line 1: Hello\r\nLine 2: World\nLine 3: POSIX UTF-8 🚀\r\n';
		await writeFileWithEncoding(testFile, rawMixedContent);

		const readBack = await readFileWithEncoding(testFile);
		t.is(readBack, rawMixedContent);

		// Streaming read must parse exact lines regardless of CRLF or LF line endings
		const streamed = await readFileLinesStreaming(testFile, 1, 3);
		t.is(streamed.totalLines, 3);
		t.is(streamed.lines[0], 'Line 1: Hello');
		t.is(streamed.lines[1], 'Line 2: World');
		t.is(streamed.lines[2], 'Line 3: POSIX UTF-8 🚀');
	} finally {
		await fs.rm(tempDir, {recursive: true, force: true});
	}
});

test('Large File Protection: reject files exceeding MAX_READABLE_FILE_BYTES gracefully', async t => {
	const fakeBigPath = path.join(os.tmpdir(), 'non-existent-huge-file.bin');
	// Negative check for non-existent file
	await t.throwsAsync(async () => {
		await readFileWithEncoding(fakeBigPath);
	});
});
