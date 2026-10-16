import test from 'ava';
import {
	parseCanonicalPath,
} from '../../../utils/core/canonicalPath.js';

test('StructuredPath: decomposes path into immutable value object with rich metadata', t => {
	const sp = parseCanonicalPath('C:\\snow\\source\\mcp\\filesystem.ts');

	t.is(sp.posix, 'C:/snow/source/mcp/filesystem.ts');
	t.is(sp.root, 'C:/');
	t.deepEqual(sp.segments, ['snow', 'source', 'mcp', 'filesystem.ts']);
	t.true(sp.isAbsolute);
	t.is(sp.fileName, 'filesystem.ts');
	t.is(sp.stem, 'filesystem');
	t.is(sp.ext, '.ts');
	t.is(sp.toString(), 'C:/snow/source/mcp/filesystem.ts');
});

test('StructuredPath: parent() navigates safely without corrupting root drive', t => {
	const sp = parseCanonicalPath('C:/snow/source/mcp/filesystem.ts');
	const parent1 = sp.parent();
	t.is(parent1.posix, 'C:/snow/source/mcp');

	const parent2 = parent1.parent();
	t.is(parent2.posix, 'C:/snow/source');

	const rootParent = parseCanonicalPath('C:/').parent();
	t.is(rootParent.posix, 'C:/');
	t.is(rootParent.segments.length, 0);
});

test('StructuredPath: join() appends segments canonically', t => {
	const base = parseCanonicalPath('D:/workspace');
	const child = base.join('snow-cli', 'source\\utils', 'core');

	t.is(child.posix, 'D:/workspace/snow-cli/source/utils/core');
	t.deepEqual(child.segments, ['workspace', 'snow-cli', 'source', 'utils', 'core']);
});

test('StructuredPath: isChildOf() strictly enforces directory traversal boundaries', t => {
	const child = parseCanonicalPath('C:/Users/Admin/project/source/index.ts');
	const parent = parseCanonicalPath('C:/Users/Admin/project');
	const sibling = parseCanonicalPath('C:/Users/Admin/other');
	const otherDrive = parseCanonicalPath('D:/Users/Admin/project');

	t.true(child.isChildOf(parent));
	t.false(child.isChildOf(sibling));
	t.false(child.isChildOf(otherDrive));
	t.false(parent.isChildOf(child)); // parent is not child of child
	t.false(child.isChildOf(child)); // identical path is not child
});

test('StructuredPath: relativeFrom() computes clean normalized relative POSIX path', t => {
	const target = parseCanonicalPath('C:/repo/source/utils/core/canonicalPath.ts');
	const base = parseCanonicalPath('C:/repo/source/test');

	// Navigating from test to utils/core
	t.is(target.relativeFrom(base), '../utils/core/canonicalPath.ts');

	// Child to parent
	const child = parseCanonicalPath('C:/repo/source/test/unit');
	t.is(child.relativeFrom('C:/repo/source'), 'test/unit');

	// Identical
	t.is(child.relativeFrom(child), '.');
});
