import test from 'ava';
import {
	addNotebook,
	queryNotebook,
	updateNotebook,
	deleteNotebook,
	getNotebooksByFile,
	clearNotebooksByFile,
	recordNotebookAddition,
	rollbackNotebooks,
	clearAllNotebookSnapshots,
} from '../../../utils/core/notebookManager.js';

test.serial('notebookManager CRUD and query operations', t => {
	const relPath = 'src/index.ts';
	clearNotebooksByFile(relPath);

	const entry = addNotebook(relPath, 'Initial Note for Index');
	t.truthy(entry.id);
	t.is(entry.note, 'Initial Note for Index');

	const list = getNotebooksByFile(relPath);
	t.is(list.length, 1);
	t.is(list[0]?.id, entry.id);

	const updated = updateNotebook(entry.id, 'Updated Note for Index');
	t.truthy(updated);
	t.is(updated?.note, 'Updated Note for Index');

	const queried = queryNotebook('index', 5);
	t.true(queried.length >= 1);
	t.is(queried[0]?.id, entry.id);

	const deleted = deleteNotebook(entry.id);
	t.true(deleted);
	t.is(getNotebooksByFile(relPath).length, 0);
});

test.serial('notebookManager rollback tracks operations and reverts them', t => {
	const sessId = `test-sess-${Date.now()}`;
	const relPath = 'src/rollback_test.ts';
	clearNotebooksByFile(relPath);
	clearAllNotebookSnapshots(sessId);

	try {
		// 1. Add note and record snapshot
		const entry = addNotebook(relPath, 'Revert Me Later');
		recordNotebookAddition(sessId, 1, entry.id);

		t.is(getNotebooksByFile(relPath).length, 1);

		// Rollback from index 1 -> note should be deleted
		const rolledBack = rollbackNotebooks(sessId, 1);
		t.is(rolledBack, 1);
		t.is(getNotebooksByFile(relPath).length, 0);
	} finally {
		clearNotebooksByFile(relPath);
		clearAllNotebookSnapshots(sessId);
	}
});
