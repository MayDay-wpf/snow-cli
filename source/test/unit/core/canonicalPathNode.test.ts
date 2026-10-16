import test from 'ava';
import path from 'node:path';
import {
	toCanonicalPath,
	isCanonicalAbsolute,
	splitCanonicalPath,
	toNativePath,
} from '../../../utils/core/canonicalPath.js';
import {tryFixPath} from '../../../mcp/utils/filesystem/path-fixer.utils.js';

test('toCanonicalPath: unifies backslashes, collapses redundant slashes and standardizes drive letter', t => {
	// Windows backslashes
	t.is(toCanonicalPath('source\\mcp\\filesystem.ts'), 'source/mcp/filesystem.ts');

	// Redundant slashes
	t.is(toCanonicalPath('source///mcp//filesystem.ts'), 'source/mcp/filesystem.ts');

	// Windows drive letter
	t.is(toCanonicalPath('c:\\Users\\Admin\\project'), 'C:/Users/Admin/project');
	t.is(toCanonicalPath('D:/Workspace/Snow/'), 'D:/Workspace/Snow');

	// Root path preservation
	t.is(toCanonicalPath('/'), '/');
	t.is(toCanonicalPath('C:/'), 'C:/');

	// UNC path
	t.is(toCanonicalPath('\\\\wsl$\\Ubuntu\\home'), '//wsl$/Ubuntu/home');

	// Native path conversion
	const nativeSlash = path.sep;
	t.is(toNativePath('source/mcp/filesystem.ts'), ['source', 'mcp', 'filesystem.ts'].join(nativeSlash));
});

test('isCanonicalAbsolute: accurately identifies Windows and POSIX absolute roots', t => {
	t.true(isCanonicalAbsolute('/etc/hosts'));
	t.true(isCanonicalAbsolute('C:/Windows/system32'));
	t.true(isCanonicalAbsolute('d:\\snow\\project'));

	t.false(isCanonicalAbsolute('source/index.ts'));
	t.false(isCanonicalAbsolute('./utils/helpers.ts'));
	t.false(isCanonicalAbsolute('../parent/file.ts'));
});

test('splitCanonicalPath: safely isolates root drive without polluting folder segments', t => {
	// Relative path
	const rel = splitCanonicalPath('source/mcp/utils/filesystem.ts');
	t.is(rel.root, '');
	t.deepEqual(rel.segments, ['source', 'mcp', 'utils', 'filesystem.ts']);
	t.false(rel.isAbsolute);

	// Windows absolute path
	const win = splitCanonicalPath('C:\\snow\\source\\mcp\\filesystem.ts');
	t.is(win.root, 'C:/');
	t.deepEqual(win.segments, ['snow', 'source', 'mcp', 'filesystem.ts']);
	t.true(win.isAbsolute);

	// POSIX absolute path
	const posix = splitCanonicalPath('/home/user/code/index.ts');
	t.is(posix.root, '/');
	t.deepEqual(posix.segments, ['home', 'user', 'code', 'index.ts']);
	t.true(posix.isAbsolute);
});

test('tryFixPath with canonical splitter: preserves absolute drive letter during directory reduction', async t => {
	const projectRoot = process.cwd();

	// Absolute path with redundant 'utils'
	const absolutePathWithUtils = path.resolve(projectRoot, 'source/mcp/utils/filesystem.ts');
	const fixed = await tryFixPath(absolutePathWithUtils, projectRoot);

	t.truthy(fixed);
	const expected = path.resolve(projectRoot, 'source/mcp/filesystem.ts');
	t.is(path.resolve(fixed!), expected);
});
