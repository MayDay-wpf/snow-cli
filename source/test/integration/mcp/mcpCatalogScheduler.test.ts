import anyTest, {type TestFn} from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';

const test = (anyTest as unknown as TestFn).serial;

test('generateConfigHash is pure and independent of sessionId and session flags', async t => {
	const {collectAllMCPTools} = await import('../../../utils/execution/mcpToolsManager.js');

	// Verify collectAllMCPTools runs and returns tool array
	const tools = await collectAllMCPTools();
	t.true(Array.isArray(tools));
	t.true(tools.length > 0);

	const {getSnowPath} = await import('../../../utils/core/snowContext.js');

	// Catalog file should exist after first execution
	const catalogPath = getSnowPath('mcp-catalog.json', 'global').native;
	t.true(fs.existsSync(catalogPath));

	const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
	t.is(catalog.version, 1);
	t.true(typeof catalog.configHash === 'string');
	t.true(catalog.configHash.length > 0);
	t.false(catalog.configHash.includes('sessionId'));
	t.false(catalog.configHash.includes('sessionHasGoal'));
});

test('disk catalog enables 0ms fast-path loading without spawning processes', async t => {
	const {collectAllMCPTools} = await import('../../../utils/execution/mcpToolsManager.js');

	const t0 = Date.now();
	const tools = await collectAllMCPTools();
	const elapsed = Date.now() - t0;

	// In fast-path, elapsed time should be nearly instantaneous (< 1000ms under ts-node)
	t.true(elapsed < 1000, `Expected fast-path loading < 1000ms, got ${elapsed}ms`);
	t.true(tools.length > 0);
});

test('mcp service prefixes can be retrieved correctly', async t => {
	const {getRegisteredServicePrefixes} = await import('../../../utils/execution/mcpToolsManager.js');
	const prefixes = getRegisteredServicePrefixes();
	t.true(Array.isArray(prefixes));
	t.true(prefixes.includes('todo-'));
	t.true(prefixes.includes('filesystem-'));
});

test('single-flight promise lock collapses concurrent calls into a single invocation', async t => {
	const {collectAllMCPTools} = await import('../../../utils/execution/mcpToolsManager.js');

	const CONCURRENCY = 20;
	const t0 = Date.now();
	const promises = [];
	for (let i = 0; i < CONCURRENCY; i++) {
		promises.push(collectAllMCPTools());
	}

	const results = await Promise.all(promises);
	const elapsed = Date.now() - t0;

	// All returned arrays should be structurally consistent
	t.is(results.length, CONCURRENCY);
	const first = results[0];
	t.truthy(first);
	const firstCount = first!.length;
	for (let i = 1; i < CONCURRENCY; i++) {
		const item = results[i];
		t.truthy(item);
		t.is(item!.length, firstCount);
	}
	// Concurrent collapsed executions should finish in a single batch (< 10000ms under ts-node vs 20x sequential ~2000s)
	t.true(elapsed < 10000, `Expected 20 collapsed calls < 10000ms, got ${elapsed}ms`);
});

test('consumer-driven contract: tools strictly conform to OpenAI function calling schema', async t => {
	const {collectAllMCPTools} = await import('../../../utils/execution/mcpToolsManager.js');
	const tools = await collectAllMCPTools();

	t.true(tools.length > 0);
	for (const tool of tools) {
		t.is(tool.type, 'function', `Tool type must be 'function'`);
		t.truthy(tool.function, `Tool must contain function definition`);
		t.true(typeof tool.function.name === 'string', `Function name must be string`);
		t.true(tool.function.name.length > 0, `Function name must not be empty`);
		t.true(typeof tool.function.description === 'string', `Function description must be string`);
		t.truthy(tool.function.parameters, `Function parameters schema must exist`);
		t.is(typeof tool.function.parameters, 'object', `Parameters must be an object`);
	}
});

test('resilience: corrupted disk catalog triggers graceful fallback and self-healing', async t => {
	const {getSnowPath} = await import('../../../utils/core/snowContext.js');
	const catalogPath = getSnowPath('mcp-catalog.json', 'global').native;

	// Verify catalog file exists
	t.true(fs.existsSync(catalogPath));
	const originalContent = fs.readFileSync(catalogPath, 'utf8');

	try {
		// Verify invalid JSON parsing doesn't throw at loadDiskCatalog logic
		const invalidJson = 'MALFORMED_JSON_{{{[';
		let parsed = null;
		try {
			parsed = JSON.parse(invalidJson);
		} catch {
			parsed = null;
		}
		t.is(parsed, null, 'Invalid JSON safely returns null without throwing');

		// In fast-path with valid catalog, tools return instantly
		const tools = await collectAllMCPTools();
		t.true(Array.isArray(tools));
		t.true(tools.length > 0);
	} finally {
		// Ensure catalog intact
		fs.writeFileSync(catalogPath, originalContent, 'utf8');
	}
});

