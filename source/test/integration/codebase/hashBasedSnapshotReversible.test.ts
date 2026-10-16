import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {hashBasedSnapshotManager} from '../../../utils/codebase/hashBasedSnapshot.js';

test.serial('ATDD / BDD File Snapshot & Reversible Rollback: handles creates, updates and restores', async t => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-snap-'));
	const sessionId = `sess-${Date.now()}`;
	const existingRel = 'src/service.ts';
	const newRel = 'src/helper.ts';

	const existingAbs = path.join(tempDir, existingRel);
	const newAbs = path.join(tempDir, newRel);

	await fs.mkdir(path.dirname(existingAbs), {recursive: true});
	await fs.writeFile(existingAbs, 'original-service-v1', 'utf-8');

	try {
		// 1. Snapshot existing file and new file before operation at messageIndex 2
		await hashBasedSnapshotManager.backupFile(
			sessionId,
			2,
			existingRel,
			tempDir,
			true,
			'original-service-v1',
		);
		await hashBasedSnapshotManager.backupFile(
			sessionId,
			2,
			newRel,
			tempDir,
			false, // did not exist
			undefined,
		);

		// 2. Perform AI operations: mutate existing, create new
		await fs.writeFile(existingAbs, 'mutated-service-v2', 'utf-8');
		await fs.writeFile(newAbs, 'brand-new-file', 'utf-8');

		t.is(await fs.readFile(existingAbs, 'utf-8'), 'mutated-service-v2');
		t.is(await fs.readFile(newAbs, 'utf-8'), 'brand-new-file');

		// 3. Rollback preview check
		const previewExisting = await hashBasedSnapshotManager.getRollbackPreviewForFile(
			sessionId,
			2,
			existingAbs,
		);
		t.is(previewExisting.rollbackContent, 'original-service-v1');
		t.false(previewExisting.wouldDelete);

		const previewNew = await hashBasedSnapshotManager.getRollbackPreviewForFile(
			sessionId,
			2,
			newAbs,
		);
		t.true(previewNew.wouldDelete);

		// 4. Execute atomic rollback
		const rolledBackCount = await hashBasedSnapshotManager.rollbackToMessageIndex(
			sessionId,
			2,
		);
		t.true(rolledBackCount >= 2);

		// 5. Verify: original restored, new file wiped
		t.is(await fs.readFile(existingAbs, 'utf-8'), 'original-service-v1');

		const newFileStillExists = await fs
			.access(newAbs)
			.then(() => true)
			.catch(() => false);
		t.false(newFileStillExists);
	} finally {
		await hashBasedSnapshotManager.clearAllSnapshots(sessionId);
		await fs.rm(tempDir, {recursive: true, force: true});
	}
});
