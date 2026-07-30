import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';
import {
	getCachedActivePlanPaths,
	getCachedPlanDoc,
	invalidateActivePlanPathsCache,
	invalidatePlanCache,
	setCachedActivePlanPaths,
	setCachedPlanDoc,
} from '../utils/execution/planCache.js';
import {parsePlanDocument} from '../utils/execution/planDocument.js';
import {listActivePlanMarkdownPaths} from '../utils/execution/planPaths.js';

const test = anyTest as unknown as TestFn;

async function makeTemporaryDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'snow-plan-cache-'));
}

const SAMPLE_PLAN = `---
status: executing
current_phase: 1
created: '2026-07-25T00:00:00.000Z'
session: sess-cache
---
# Cache test

### Phase 1: Setup
- **Steps**:
  - [x] first
  - [ ] second
- **Done when**: ready
`;

test.afterEach.always(() => {
	invalidatePlanCache();
	invalidateActivePlanPathsCache();
});

test.serial(
	'cache hit returns same PlanDoc without re-parse when mtime/size unchanged',
	async t => {
		const dir = await makeTemporaryDir();
		const planDir = path.join(dir, '.snow', 'plan');
		await fs.mkdir(planDir, {recursive: true});
		const filePath = path.join(planDir, 'cache.md');
		await fs.writeFile(filePath, SAMPLE_PLAN, 'utf8');

		const first = await parsePlanDocument(filePath);
		const second = await parsePlanDocument(filePath);

		t.is(second, first);
		t.is(second.title, 'Cache test');
		t.is(second.frontmatter.status, 'executing');

		const cached = await getCachedPlanDoc(filePath);
		t.is(cached, first);
	},
);

test.serial(
	'invalidatePlanCache clears entry so next parse reloads from disk',
	async t => {
		const dir = await makeTemporaryDir();
		const planDir = path.join(dir, '.snow', 'plan');
		await fs.mkdir(planDir, {recursive: true});
		const filePath = path.join(planDir, 'invalidate.md');
		await fs.writeFile(filePath, SAMPLE_PLAN, 'utf8');

		const first = await parsePlanDocument(filePath);
		invalidatePlanCache(filePath);
		t.is(await getCachedPlanDoc(filePath), null);

		const second = await parsePlanDocument(filePath);
		t.not(second, first);
		t.is(second.title, first.title);
		t.is(second.frontmatter.status, first.frontmatter.status);
	},
);

test.serial(
	'active path list TTL cache works and can be invalidated',
	async t => {
		const dir = await makeTemporaryDir();
		const planDir = path.join(dir, '.snow', 'plan');
		await fs.mkdir(planDir, {recursive: true});
		const filePath = path.join(planDir, 'active.md');
		await fs.writeFile(filePath, SAMPLE_PLAN, 'utf8');

		const first = await listActivePlanMarkdownPaths(dir);
		t.deepEqual(first, [filePath]);

		// Second call should hit the short TTL cache (no readdir needed).
		const second = await listActivePlanMarkdownPaths(dir);
		t.deepEqual(second, first);

		const cached = getCachedActivePlanPaths(dir);
		t.truthy(cached);
		t.true((cached?.expiresAt ?? 0) > Date.now());
		t.deepEqual(cached?.paths, [filePath]);

		// Creating a new top-level plan bumps plan-dir mtime and refreshes cache.
		const extra = path.join(planDir, 'extra.md');
		await fs.writeFile(extra, SAMPLE_PLAN, 'utf8');
		const afterCreate = await listActivePlanMarkdownPaths(dir);
		t.true(afterCreate.includes(filePath));
		t.true(afterCreate.includes(extra));
		t.is(afterCreate.length, 2);

		// Explicit invalidation forces a readdir on the next call.
		invalidateActivePlanPathsCache(dir);
		t.is(getCachedActivePlanPaths(dir), null);
		const refreshed = await listActivePlanMarkdownPaths(dir);
		t.true(refreshed.includes(filePath));
		t.true(refreshed.includes(extra));
		t.is(refreshed.length, 2);
	},
);

test.serial('setCachedActivePlanPaths respects custom TTL', async t => {
	const cwd = path.join(os.tmpdir(), 'snow-plan-cache-ttl');
	setCachedActivePlanPaths(cwd, ['a.md'], 5);
	const hit = getCachedActivePlanPaths(cwd);
	t.truthy(hit);
	t.deepEqual(hit?.paths, ['a.md']);

	await new Promise(resolve => setTimeout(resolve, 15));
	t.is(getCachedActivePlanPaths(cwd), null);
});

test.serial(
	'setCachedPlanDoc + getCachedPlanDoc validate size when provided',
	async t => {
		const dir = await makeTemporaryDir();
		const filePath = path.join(dir, 'manual.md');
		await fs.writeFile(filePath, SAMPLE_PLAN, 'utf8');
		const stat = await fs.stat(filePath);
		const doc = await parsePlanDocument(filePath);
		invalidatePlanCache(filePath);

		setCachedPlanDoc(doc, stat.size);
		const hit = await getCachedPlanDoc(filePath);
		t.is(hit, doc);

		// Wrong size should miss even if mtime matches.
		setCachedPlanDoc(doc, stat.size + 99);
		t.is(await getCachedPlanDoc(filePath), null);
	},
);
