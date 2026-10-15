import anyTest, {type TestFn} from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
	executeMCPTool,
} from '../utils/execution/mcpToolsManager.js';

const test = (anyTest as unknown as TestFn).serial;

// ============================================================================
// 宿主环境拓扑回环保底：严防测试用例穿透宿主 ~/.snow/mcp-catalog.json
// ============================================================================
const hostCatalogPath = path.join(os.homedir(), '.snow', 'mcp-catalog.json');
let hostCatalogBackup: {existed: boolean; content: Buffer | null} = {
	existed: false,
	content: null,
};

test.before(() => {
	try {
		if (fs.existsSync(hostCatalogPath)) {
			hostCatalogBackup = {
				existed: true,
				content: fs.readFileSync(hostCatalogPath),
			};
		} else {
			hostCatalogBackup = {existed: false, content: null};
		}
	} catch {
		hostCatalogBackup = {existed: false, content: null};
	}
});

test.after.always(() => {
	try {
		if (hostCatalogBackup.existed && hostCatalogBackup.content !== null) {
			const dir = path.dirname(hostCatalogPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, {recursive: true});
			}
			fs.writeFileSync(hostCatalogPath, hostCatalogBackup.content);
		} else if (!hostCatalogBackup.existed && fs.existsSync(hostCatalogPath)) {
			fs.unlinkSync(hostCatalogPath);
		}
	} catch {
		// 防御性静默
	}
});

test('Characterization: invalid tool name format throws clear syntax exception', async t => {
	const err = await t.throwsAsync(async () => {
		await executeMCPTool('illegalformat', {});
	});
	t.truthy(err);
	t.true(err!.message.includes('Invalid tool name format'));
});

test('Characterization: unknown action in builtin websearch service throws distinct error', async t => {
	const err = await t.throwsAsync(async () => {
		await executeMCPTool('websearch-unknown_action', {});
	});
	t.truthy(err);
	t.true(err!.message.includes('Unknown websearch tool: unknown_action'));
});

test('Characterization: abortSignal immediately interrupts websearch-search', async t => {
	const controller = new AbortController();
	controller.abort(new Error('User aborted websearch'));

	const err = await t.throwsAsync(async () => {
		await executeMCPTool(
			'websearch-search',
			{query: 'test abort boundary', maxResults: 5},
			controller.signal,
		);
	});

	t.truthy(err);
	t.true(
		err!.message.includes('aborted') || err!.message.includes('User aborted'),
	);
});

test('Characterization: abortSignal immediately interrupts websearch-fetch', async t => {
	const controller = new AbortController();
	controller.abort(new Error('User aborted page fetch'));

	const err = await t.throwsAsync(async () => {
		await executeMCPTool(
			'websearch-fetch',
			{url: 'https://example.com/abort-test'},
			controller.signal,
		);
	});

	t.truthy(err);
	t.true(
		err!.message.includes('aborted') || err!.message.includes('User aborted'),
	);
});

test('Characterization: builtin filesystem service reads file without network or external mcp process', async t => {
	const res = await executeMCPTool('filesystem-read', {
		filePath: 'package.json',
	});

	t.truthy(res);
	t.is(typeof res.content, 'string');
	t.true(res.content.includes('"name": "snow-ai"'));
});

test('Characterization: router collection handles corrupted catalog gracefully with fallback', async t => {
	// 临时沙箱化验证：通过 catalogStore 的沙箱实例验证鲁棒性与可逆性
	const {MCPCatalogStore} = await import('../utils/execution/mcp/catalogStore.js');
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-router-sandbox-'));
	const sandboxFile = path.join(tempDir, 'mcp-catalog.json');

	try {
		const store = new MCPCatalogStore(sandboxFile);
		// 写入异常快照
		fs.writeFileSync(sandboxFile, '{ corrupted syntax [!', 'utf8');

		// 验证异常快照被安全吸收并返回 null，不引发异常扩散
		const result = store.load('any_expected_hash');
		t.is(result, null);
	} finally {
		try {
			fs.rmSync(tempDir, {recursive: true, force: true});
		} catch {
			// 沙箱清理保底
		}
	}
});


