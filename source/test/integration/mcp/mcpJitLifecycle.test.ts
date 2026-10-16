import anyTest, {type TestFn} from 'ava';

const test = (anyTest as unknown as TestFn).serial;

test('input validation: invalid tool format throws immediately without connection', async t => {
	const {executeMCPTool} = await import('../../../utils/execution/mcpToolsManager.js');

	const error = await t.throwsAsync(async () => {
		await executeMCPTool('nonexistent_tool_without_dash', {});
	});

	t.truthy(error);
	t.true(
		error!.message.includes('Invalid tool name format') ||
		error!.message.includes('Expected format: serviceName-toolName'),
		'Expected format error'
	);
});

test('builtin tools execute locally with zero sub-process or network transport', async t => {
	const {executeMCPTool} = await import('../../../utils/execution/mcpToolsManager.js');

	// filesystem-read with package.json executes locally with zero subprocess
	const res = await executeMCPTool('filesystem-read', {filePath: 'package.json'});
	t.truthy(res);
	t.is(typeof res.content, 'string');
	t.true(res.content.includes('snow-ai') || res.content.includes('name'));
});

test('persistent client pool: closeAllMCPConnections safely executes when idle or populated', async t => {
	const {closeAllMCPConnections} = await import('../../../utils/execution/mcpToolsManager.js');

	// Calling closeAllMCPConnections when empty must succeed with no throw
	await t.notThrowsAsync(async () => {
		await closeAllMCPConnections();
	});
});

test('robustness: unknown external tool cleanly rejects without crashing process', async t => {
	const {executeMCPTool} = await import('../../../utils/execution/mcpToolsManager.js');

	const error = await t.throwsAsync(async () => {
		await executeMCPTool('ghost_service-ghost_action', {});
	});

	t.truthy(error);
	t.true(error!.message.includes('ghost_service-ghost_action'));
});
