import anyTest, {type TestFn} from 'ava';
import os from 'node:os';
import path from 'node:path';

import {enforceWorktreePath} from '../utils/team/teamWorktree.js';

const test = anyTest as unknown as TestFn;

test('enforceWorktreePath keeps relative paths inside the worktree', t => {
	const worktree = path.resolve('.snow', 'worktrees', 'team', 'member');

	t.is(
		enforceWorktreePath('source/app.tsx', worktree),
		path.join(worktree, 'source', 'app.tsx'),
	);
	t.is(enforceWorktreePath('.', worktree), worktree);
});

test('enforceWorktreePath rejects relative traversal outside the worktree', t => {
	const worktree = path.resolve('.snow', 'worktrees', 'team', 'member');

	t.is(enforceWorktreePath('../../../../outside.txt', worktree), null);
	t.is(enforceWorktreePath('../member-evil/file.txt', worktree), null);
});

test('enforceWorktreePath rejects sibling absolute paths with a shared prefix', t => {
	const worktree = path.join(os.tmpdir(), 'snow-worktree');
	const sibling = path.join(os.tmpdir(), 'snow-worktree-evil');

	t.is(enforceWorktreePath(path.join(sibling, 'file.txt'), worktree), null);
});

test('enforceWorktreePath allows names beginning with two dots', t => {
	const worktree = path.resolve('.snow', 'worktrees', 'team', 'member');

	t.is(
		enforceWorktreePath('..config/file.txt', worktree),
		path.join(worktree, '..config', 'file.txt'),
	);
});
