import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';
import {ACECodeSearchService} from '../mcp/aceCodeSearch.js';

const test = anyTest as unknown as TestFn;

test('session cache cleanup keeps ACE code search usable', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-ace-lifecycle-'));
	await fs.writeFile(
		path.join(root, 'sample.ts'),
		'export function sample(): number { return 1; }\n',
	);
	const service = new ACECodeSearchService(root, {idleCleanupMs: 0});

	try {
		service.clearSessionCaches();
		await t.notThrowsAsync(service.getFileOutline('sample.ts'));
	} finally {
		service.dispose();
		await fs.rm(root, {recursive: true, force: true});
	}
});
