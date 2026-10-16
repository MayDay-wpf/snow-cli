import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {FilesystemMCPService} from '../../../mcp/filesystem.js';

// ============================================================================
// MCP Domain (L1 Integration): FilesystemMCPService 基础文件操作与安全沙箱
// 依据 testing-scenario-cli 与 testing-core-oracle 契约判定
// ============================================================================

test('filesystem: createFile and getFileContent basic lifecycle', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-mcp-fs-'));
	const service = new FilesystemMCPService(tempDir);
	const targetFile = 'nested/dir/hello.txt';

	try {
		// 1. 创建文件 (自动递归创建目录)
		const createRes = await service.createFile(targetFile, 'Hello Snow MCP!\nLine 2', true, false);
		t.truthy(createRes);

		const absoluteCreated = path.join(tempDir, targetFile);
		t.true(fs.existsSync(absoluteCreated));

		// 2. 读取文件内容
		const readRes = await service.getFileContent(targetFile);
		t.truthy(readRes);
		t.is(typeof readRes, 'object');
		// 单文件读取返回结构化 content / text
		const contentStr = JSON.stringify(readRes);
		t.true(contentStr.includes('Hello Snow MCP!'));
		t.true(contentStr.includes('Line 2'));
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('filesystem: createFile with overwrite=false throws error when file already exists', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-mcp-fs-exist-'));
	const service = new FilesystemMCPService(tempDir);
	const targetFile = 'exists.txt';
	fs.writeFileSync(path.join(tempDir, targetFile), 'original content', 'utf8');

	try {
		const err = await t.throwsAsync(async () => {
			await service.createFile(targetFile, 'new content', true, false);
		});
		t.truthy(err);
		t.true(err?.message.includes('already exists'));
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('filesystem: createFile with overwrite=true safely updates file content', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-mcp-fs-overwrite-'));
	const service = new FilesystemMCPService(tempDir);
	const targetFile = 'overwrite.txt';
	fs.writeFileSync(path.join(tempDir, targetFile), 'old content', 'utf8');

	try {
		await service.createFile(targetFile, 'new overwritten content', true, true);
		const updated = fs.readFileSync(path.join(tempDir, targetFile), 'utf8');
		t.is(updated, 'new overwritten content');
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('filesystem: batch createFile creates multiple files atomically in one call', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-mcp-fs-batch-'));
	const service = new FilesystemMCPService(tempDir);

	try {
		const batchItems = [
			{path: 'file1.ts', content: 'export const a = 1;'},
			{path: 'dir/file2.ts', content: 'export const b = 2;'},
		];

		const batchResult = await service.createFile(batchItems);
		t.truthy(batchResult);

		t.true(fs.existsSync(path.join(tempDir, 'file1.ts')));
		t.true(fs.existsSync(path.join(tempDir, 'dir/file2.ts')));
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('filesystem: getFileContent on non-existent file returns clear not-found error', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-mcp-fs-missing-'));
	const service = new FilesystemMCPService(tempDir);

	try {
		const err = await t.throwsAsync(async () => {
			await service.getFileContent('non-existent-file.ts');
		});
		t.truthy(err);
		t.true(err?.message.toLowerCase().includes('not found') || err?.message.toLowerCase().includes('no such file'));
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});
