import anyTest, {type TestFn} from 'ava';
import {executeBatchOperation} from '../mcp/utils/filesystem/batch-operations.utils.js';
import {FilesystemMCPService} from '../mcp/filesystem.js';
import {executeMCPTool} from '../utils/execution/mcpToolsManager.js';

const test = anyTest as unknown as TestFn;

test('executeBatchOperation rejects empty filePath arrays', async t => {
	await t.throwsAsync(
		() =>
			executeBatchOperation(
				[],
				item => ({path: String(item)}),
				async () => ({ok: true}),
				(path, result) => ({path, ...result}),
			),
		{message: /filePath array is empty|Never use filePath: \[\]/},
	);
});

test('createFile rejects empty filePath arrays instead of 0/0 success', async t => {
	const service = new FilesystemMCPService(process.cwd());
	await t.throwsAsync(() => service.createFile([], 'content', true, true), {
		message: /filePath array is empty|Never use filePath: \[\]/,
	});
});

test('editFileBySearch rejects empty filePath arrays', async t => {
	const service = new FilesystemMCPService(process.cwd());
	await t.throwsAsync(() => service.editFileBySearch([], 'a', 'b', 1, 8), {
		message: /filePath array is empty|Never use filePath: \[\]/,
	});
});

test('editFile rejects empty filePath arrays', async t => {
	const service = new FilesystemMCPService(process.cwd());
	await t.throwsAsync(
		() =>
			service.editFile(
				[],
				[
					{
						type: 'replace',
						startAnchor: '1:aa',
						endAnchor: '1:aa',
						content: 'x',
					},
				],
			),
		{message: /filePath array is empty|Never use filePath: \[\]/},
	);
});

test('executeMCPTool filesystem-create rejects empty filePath array', async t => {
	await t.throwsAsync(
		() =>
			executeMCPTool('filesystem-create', {
				filePath: [],
				content: 'hello',
				overwrite: true,
			}),
		{message: /Empty 'filePath' array|Never use filePath: \[\]/},
	);
});

test('executeMCPTool filesystem-replaceedit rejects empty filePath array', async t => {
	await t.throwsAsync(
		() =>
			executeMCPTool('filesystem-replaceedit', {
				filePath: [],
				searchContent: 'a',
				replaceContent: 'b',
			}),
		{message: /Empty 'filePath' array|Never use filePath: \[\]/},
	);
});

test('executeMCPTool filesystem-create rejects empty string filePath', async t => {
	await t.throwsAsync(
		() =>
			executeMCPTool('filesystem-create', {
				filePath: '   ',
				content: 'hello',
				overwrite: true,
			}),
		{message: /Empty 'filePath'|non-empty path/},
	);
});

test('executeMCPTool filesystem-create keeps non-JSON string filePath as string', async t => {
	// Normalization whitelist must not turn a normal path string into [].
	// A path that is not JSON array/object syntax should remain a string and
	// fail for missing overwrite/content handling only if invalid — not empty array.
	await t.throwsAsync(
		() =>
			executeMCPTool('filesystem-create', {
				filePath: '.snow/plan/2026-07-26/demo.md',
				// content omitted on purpose to force validation path after filePath check
			}),
		{message: /Missing required parameter 'content'|filePath/},
	);
});

test('executeMCPTool filesystem-create rejects stringified empty array "[]"', async t => {
	// Whitelist normalization parses "[]" into [], then empty-array validation must hard-fail.
	await t.throwsAsync(
		() =>
			executeMCPTool('filesystem-create', {
				filePath: '[]',
				content: 'hello',
				overwrite: true,
			}),
		{message: /Empty 'filePath' array|Never use filePath/},
	);
});
