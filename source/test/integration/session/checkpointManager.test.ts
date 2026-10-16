import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {checkpointManager} from '../../../utils/session/checkpointManager.js';

test.serial('checkpointManager records file snapshot and rolls back modifications', async t => {
	const sessionId = `test-sess-${Date.now()}`;
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-chk-'));
	const existingFile = path.join(tempDir, 'existing.txt');
	const newFile = path.join(tempDir, 'created.txt');

	try {
		await fs.writeFile(existingFile, 'original-content', 'utf-8');

		await checkpointManager.createCheckpoint(sessionId, 5);

		// Snapshot existing file and newly created file before mutating
		await checkpointManager.recordFileSnapshot(existingFile);
		await checkpointManager.recordFileSnapshot(newFile);

		// Mutate existing file and create new file
		await fs.writeFile(existingFile, 'modified-content', 'utf-8');
		await fs.writeFile(newFile, 'new-file-content', 'utf-8');

		t.is(await fs.readFile(existingFile, 'utf-8'), 'modified-content');

		// Perform rollback
		const rolledBackCount = await checkpointManager.rollback(sessionId);
		t.is(rolledBackCount, 5);

		// Verify existing file restored
		t.is(await fs.readFile(existingFile, 'utf-8'), 'original-content');

		// Verify new file deleted
		const existsNew = await fs
			.access(newFile)
			.then(() => true)
			.catch(() => false);
		t.false(existsNew);
	} finally {
		await checkpointManager.clearCheckpoint(sessionId);
		await fs.rm(tempDir, {recursive: true, force: true});
	}
});
