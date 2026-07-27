import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FilesystemMCPService} from '../mcp/filesystem.js';
import {
	dateFolderName,
	normalizePlanWritePath,
} from '../utils/execution/planPaths.js';

const test = anyTest as unknown as TestFn;

async function makeTmpDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'snow-plan-fs-'));
}

test('normalizePlanWritePath redirects top-level plan md into today folder', t => {
	const cwd = path.resolve(path.sep + path.join('tmp', 'snow-plan-cwd'));
	const now = new Date('2026-07-26T12:00:00');
	const today = dateFolderName(now);

	const relativeIn = path.join('.snow', 'plan', 'task.md');
	const relativeOut = normalizePlanWritePath(relativeIn, cwd, now);
	t.is(relativeOut, path.join('.snow', 'plan', today, 'task.md'));

	const absoluteIn = path.join(cwd, '.snow', 'plan', 'task.md');
	const absoluteOut = normalizePlanWritePath(absoluteIn, cwd, now);
	t.is(absoluteOut, path.join(cwd, '.snow', 'plan', today, 'task.md'));
});

test('normalizePlanWritePath leaves dated, archive, non-md, and outside paths unchanged', t => {
	const cwd = path.resolve(path.sep + path.join('tmp', 'snow-plan-cwd'));
	const now = new Date('2026-07-26T12:00:00');
	const today = dateFolderName(now);

	const alreadyDated = path.join('.snow', 'plan', '2026-07-20', 'task.md');
	t.is(normalizePlanWritePath(alreadyDated, cwd, now), alreadyDated);

	const archivePath = path.join('.snow', 'plan', 'archive', today, 'task.md');
	t.is(normalizePlanWritePath(archivePath, cwd, now), archivePath);

	const nonMd = path.join('.snow', 'plan', 'notes.txt');
	t.is(normalizePlanWritePath(nonMd, cwd, now), nonMd);

	const outside = path.join('src', 'a.ts');
	t.is(normalizePlanWritePath(outside, cwd, now), outside);

	const nestedNonDate = path.join('.snow', 'plan', 'misc', 'task.md');
	t.is(normalizePlanWritePath(nestedNonDate, cwd, now), nestedNonDate);
});

test('createFile redirects top-level plan md into today folder', async t => {
	const base = await makeTmpDir();
	t.teardown(async () => {
		await fs.rm(base, {recursive: true, force: true});
	});

	const service = new FilesystemMCPService(base);
	const requested = path.join('.snow', 'plan', 'demo.md');
	const today = dateFolderName();
	const expectedRel = path.join('.snow', 'plan', today, 'demo.md');
	const expectedAbs = path.join(base, expectedRel);
	const topLevelAbs = path.join(base, requested);

	const message = await service.createFile(requested, '# demo\n', true, true);

	t.true(typeof message === 'string');
	t.true((message as string).includes(expectedRel));
	t.true((message as string).includes('redirected from top-level .snow/plan'));

	await t.notThrowsAsync(fs.access(expectedAbs));
	await t.throwsAsync(fs.access(topLevelAbs), {code: 'ENOENT'});

	const written = await fs.readFile(expectedAbs, 'utf8');
	t.is(written, '# demo\n');
});

test('createFile keeps already-dated plan path', async t => {
	const base = await makeTmpDir();
	t.teardown(async () => {
		await fs.rm(base, {recursive: true, force: true});
	});

	const service = new FilesystemMCPService(base);
	const requested = path.join('.snow', 'plan', '2026-07-20', 'kept.md');
	const expectedAbs = path.join(base, requested);

	const message = await service.createFile(requested, '# kept\n', true, true);

	t.true(typeof message === 'string');
	t.true((message as string).includes(requested));
	t.false((message as string).includes('redirected from top-level .snow/plan'));
	await t.notThrowsAsync(fs.access(expectedAbs));
});

test('createFile keeps archive plan path', async t => {
	const base = await makeTmpDir();
	t.teardown(async () => {
		await fs.rm(base, {recursive: true, force: true});
	});

	const service = new FilesystemMCPService(base);
	const today = dateFolderName();
	const requested = path.join('.snow', 'plan', 'archive', today, 'archived.md');
	const expectedAbs = path.join(base, requested);

	const message = await service.createFile(
		requested,
		'# archived\n',
		true,
		true,
	);

	t.true(typeof message === 'string');
	t.true((message as string).includes(requested));
	t.false((message as string).includes('redirected from top-level .snow/plan'));
	await t.notThrowsAsync(fs.access(expectedAbs));
});

test('createFile keeps business path unchanged', async t => {
	const base = await makeTmpDir();
	t.teardown(async () => {
		await fs.rm(base, {recursive: true, force: true});
	});

	const service = new FilesystemMCPService(base);
	const requested = path.join('src', 'feature.ts');
	const expectedAbs = path.join(base, requested);

	const message = await service.createFile(
		requested,
		'export const x = 1;\n',
		true,
		true,
	);

	t.true(typeof message === 'string');
	t.true((message as string).includes(requested));
	t.false((message as string).includes('redirected from top-level .snow/plan'));
	await t.notThrowsAsync(fs.access(expectedAbs));
});

test('createFile batch reports redirected path', async t => {
	const base = await makeTmpDir();
	t.teardown(async () => {
		await fs.rm(base, {recursive: true, force: true});
	});

	const service = new FilesystemMCPService(base);
	const requested = path.join('.snow', 'plan', 'batch-demo.md');
	const today = dateFolderName();
	const expectedRel = path.join('.snow', 'plan', today, 'batch-demo.md');
	const expectedAbs = path.join(base, expectedRel);

	const result = await service.createFile(
		[
			{
				path: requested,
				content: '# batch\n',
				createDirectories: true,
				overwrite: true,
			},
		],
		undefined,
		true,
		true,
	);

	t.true(typeof result === 'object' && result !== null);
	const batch = result as {
		successCount: number;
		failureCount: number;
		results: Array<{path: string; content?: string; success?: boolean}>;
	};
	t.is(batch.successCount, 1);
	t.is(batch.failureCount, 0);
	t.is(batch.results.length, 1);
	t.is(batch.results[0]!.path, expectedRel);
	await t.notThrowsAsync(fs.access(expectedAbs));
	await t.throwsAsync(fs.access(path.join(base, requested)), {code: 'ENOENT'});
});
