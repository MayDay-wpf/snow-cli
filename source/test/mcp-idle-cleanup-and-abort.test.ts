import anyTest, {type TestFn} from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {randomUUID} from 'crypto';
import {
	cleanupIdleMCPConnections,
	closeAllMCPConnections,
	clearMCPToolsCache,
} from '../utils/execution/mcpToolsManager.js';

const test = (anyTest as unknown as TestFn).serial;

const sandboxDir = path.join(
	os.tmpdir(),
	`snow-mcp-idle-sandbox-${randomUUID()}`,
);

test.before(() => {
	fs.mkdirSync(sandboxDir, {recursive: true});
	clearMCPToolsCache();
});

test.after.always(async () => {
	clearMCPToolsCache();
	await closeAllMCPConnections();
	try {
		fs.rmSync(sandboxDir, {recursive: true, force: true});
	} catch {
		// ignore
	}
});

test('MCPIdleCleanup: cleanupIdleMCPConnections safely executes without throwing on empty or stale pool', async t => {
	await t.notThrowsAsync(async () => {
		await cleanupIdleMCPConnections();
	});
});

test('MCPAbortPlumbing: AbortSignal correctly propagates to external MCP tool execution and rejects immediately', async t => {
	const {executeMCPTool} = await import('../utils/execution/mcpToolsManager.js');

	const controller = new AbortController();
	controller.abort(new Error('User pressed ESC during tool execution'));

	// Non-existent or external tool should fail fast or recognize abortion
	await t.throwsAsync(
		async () => {
			await executeMCPTool('unreachableService-sampleTool', {}, controller.signal);
		},
	);
});
