import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
	getFileLineCount,
	getFileInfo,
	formatFileTree,
	parseAndValidateFileReferences,
} from '../../../utils/core/fileUtils.js';

// ============================================================================
// Core Domain (L0 Unit): fileUtils 路径引用解析、行数计算与树状格式化
// 依据 testing-scenario-cli 沙箱隔离原则
// ============================================================================

test('fileUtils: getFileLineCount returns accurate line count for existing files', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-file-test-'));
	const tempFile = path.join(tempDir, 'sample.txt');

	try {
		fs.writeFileSync(tempFile, 'line 1\nline 2\nline 3\n', 'utf8');
		const count = await getFileLineCount(tempFile);
		t.is(count, 4); // split('\n') on trailing newline produces 4 entries

		// 不存在的文件返回 0
		const missingCount = await getFileLineCount(path.join(tempDir, 'missing.txt'));
		t.is(missingCount, 0);
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('fileUtils: getFileInfo detects text and image files correctly', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-file-info-'));
	const textFile = path.join(tempDir, 'code.ts');
	const imageFile = path.join(tempDir, 'logo.png');

	try {
		fs.writeFileSync(textFile, 'const x = 1;\nconsole.log(x);', 'utf8');
		// 写入最小 PNG 字节
		fs.writeFileSync(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

		const textInfo = await getFileInfo(textFile);
		t.true(textInfo.exists);
		t.false(textInfo.isImage);
		t.is(textInfo.lineCount, 2);

		const imageInfo = await getFileInfo(imageFile);
		t.true(imageInfo.exists);
		t.true(imageInfo.isImage);
		t.is(imageInfo.mimeType, 'image/png');
		t.true(imageInfo.imageData?.startsWith('data:image/png;base64,'));
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('fileUtils: formatFileTree generates consistent bullet points for terminal rendering', t => {
	const files = [
		{path: 'source/cli.tsx', lineCount: 120, exists: true},
		{path: 'source/missing.ts', lineCount: 0, exists: false},
	];

	const formatted = formatFileTree(files);
	t.true(formatted.includes('└─ Read `source/cli.tsx` (total line 120)'));
	t.true(formatted.includes('└─ Read `source/missing.ts` (file not found)'));
	t.is(formatFileTree([]), '');
});

test('fileUtils: parseAndValidateFileReferences extracts @ references and existing files', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-ref-test-'));
	const validFile = path.join(tempDir, 'active.ts');
	fs.writeFileSync(validFile, 'export const val = 42;\n', 'utf8');

	try {
		const message = `Please review @${validFile} and check non-existent @fake/path/missing.ts for bugs`;
		const result = await parseAndValidateFileReferences(message);

		t.is(result.cleanContent, message);
		t.is(result.validFiles.length, 1);
		t.is(result.validFiles[0]?.path, validFile);
		t.true(result.validFiles[0]?.exists);
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});
