import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * File backup entry
 */
interface FileBackup {
	path: string;           // Absolute file path
	content: string | null; // File content (null if file didn't exist)
	existed: boolean;       // Whether file existed before operation
}

/**
 * Snapshot metadata
 */
interface SnapshotMetadata {
	sessionId: string;
	messageIndex: number;
	timestamp: number;
	backups: FileBackup[];  // Only modified files
}

/**
 * Incremental Snapshot Manager
 * Only backs up files that are actually modified by tools
 */
class IncrementalSnapshotManager {
	private readonly snapshotsDir: string;
	private activeSnapshot: SnapshotMetadata | null = null;

	constructor() {
		this.snapshotsDir = path.join(os.homedir(), '.snow', 'snapshots');
	}

	/**
	 * Ensure snapshots directory exists
	 */
	private async ensureSnapshotsDir(): Promise<void> {
		await fs.mkdir(this.snapshotsDir, { recursive: true });
	}

	/**
	 * Get snapshot file path
	 */
	private getSnapshotPath(sessionId: string, messageIndex: number): string {
		return path.join(this.snapshotsDir, `${sessionId}_${messageIndex}.json`);
	}

	/**
	 * Create a new snapshot for a message
	 */
	async createSnapshot(sessionId: string, messageIndex: number): Promise<void> {
		this.activeSnapshot = {
			sessionId,
			messageIndex,
			timestamp: Date.now(),
			backups: []
		};
	}

	/**
	 * Backup a file before modification
	 * Call this BEFORE modifying the file
	 */
	async backupFile(filePath: string): Promise<void> {
		if (!this.activeSnapshot) {
			// No active snapshot, skip
			return;
		}

		// Check if already backed up
		if (this.activeSnapshot.backups.some(b => b.path === filePath)) {
			return;
		}

		try {
			// Try to read existing file
			const content = await fs.readFile(filePath, 'utf-8');
			this.activeSnapshot.backups.push({
				path: filePath,
				content,
				existed: true
			});
		} catch (error) {
			// File doesn't exist, record as non-existent
			this.activeSnapshot.backups.push({
				path: filePath,
				content: null,
				existed: false
			});
		}

		// Save snapshot to disk
		await this.saveSnapshot();
	}

	/**
	 * Save current snapshot to disk
	 */
	private async saveSnapshot(): Promise<void> {
		if (!this.activeSnapshot) {
			return;
		}

		await this.ensureSnapshotsDir();
		const snapshotPath = this.getSnapshotPath(
			this.activeSnapshot.sessionId,
			this.activeSnapshot.messageIndex
		);

		await fs.writeFile(snapshotPath, JSON.stringify(this.activeSnapshot, null, 2));
	}

	/**
	 * Commit snapshot (called after message completes successfully)
	 */
	async commitSnapshot(): Promise<void> {
		// Keep the snapshot for future rollback
		this.activeSnapshot = null;
	}

	/**
	 * List all snapshots for a session
	 */
	async listSnapshots(sessionId: string): Promise<Array<{ messageIndex: number; timestamp: number; fileCount: number }>> {
		await this.ensureSnapshotsDir();
		const snapshots: Array<{ messageIndex: number; timestamp: number; fileCount: number }> = [];

		try {
			const files = await fs.readdir(this.snapshotsDir);
			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const snapshotPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(snapshotPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);
					snapshots.push({
						messageIndex: metadata.messageIndex,
						timestamp: metadata.timestamp,
						fileCount: metadata.backups.length
					});
				}
			}
		} catch (error) {
			console.error('Failed to list snapshots:', error);
		}

		return snapshots.sort((a, b) => b.messageIndex - a.messageIndex);
	}

	/**
	 * Rollback to a specific snapshot
	 */
	async rollbackToSnapshot(sessionId: string, messageIndex: number): Promise<boolean> {
		const snapshotPath = this.getSnapshotPath(sessionId, messageIndex);

		try {
			const content = await fs.readFile(snapshotPath, 'utf-8');
			const snapshot: SnapshotMetadata = JSON.parse(content);

			// Restore all backed up files
			for (const backup of snapshot.backups) {
				try {
					if (backup.existed && backup.content !== null) {
						// Restore original file content
						await fs.writeFile(backup.path, backup.content, 'utf-8');
					} else if (!backup.existed) {
						// Delete file that was created
						try {
							await fs.unlink(backup.path);
						} catch (error) {
							// File may not exist, ignore
						}
					}
				} catch (error) {
					console.error(`Failed to restore file ${backup.path}:`, error);
				}
			}

			return true;
		} catch (error) {
			console.error('Failed to rollback snapshot:', error);
			return false;
		}
	}

	/**
	 * Clear all snapshots for a session
	 */
	async clearAllSnapshots(sessionId: string): Promise<void> {
		await this.ensureSnapshotsDir();
		try {
			const files = await fs.readdir(this.snapshotsDir);
			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const filePath = path.join(this.snapshotsDir, file);
					await fs.unlink(filePath);
				}
			}
		} catch (error) {
			console.error('Failed to clear snapshots:', error);
		}
	}

	/**
	 * Get active snapshot
	 */
	getActiveSnapshot(): SnapshotMetadata | null {
		return this.activeSnapshot;
	}

	/**
	 * Capture workspace state before terminal command
	 */
	async captureWorkspaceState(workspaceRoot: string = process.cwd()): Promise<Map<string, { mtime: number; size: number }>> {
		const fileStates = new Map<string, { mtime: number; size: number }>();

		const scanDir = async (dirPath: string) => {
			try {
				const entries = await fs.readdir(dirPath, { withFileTypes: true });

				for (const entry of entries) {
					// Skip ignored directories
					if (entry.isDirectory()) {
						const dirName = entry.name;
						if (dirName === 'node_modules' || dirName === '.git' || dirName === 'dist' ||
						    dirName === 'build' || dirName === '.snow' || dirName.startsWith('.')) {
							continue;
						}
						await scanDir(path.join(dirPath, entry.name));
					} else if (entry.isFile()) {
						const fullPath = path.join(dirPath, entry.name);
						try {
							const stats = await fs.stat(fullPath);
							fileStates.set(fullPath, {
								mtime: stats.mtimeMs,
								size: stats.size
							});
						} catch (error) {
							// Skip files that can't be read
						}
					}
				}
			} catch (error) {
				// Skip directories that can't be accessed
			}
		};

		await scanDir(workspaceRoot);
		return fileStates;
	}

	/**
	 * Detect and backup changed files after terminal command
	 */
	async backupChangedFiles(beforeState: Map<string, { mtime: number; size: number }>, workspaceRoot: string = process.cwd()): Promise<void> {
		const afterState = await this.captureWorkspaceState(workspaceRoot);

		// Find modified and new files
		for (const [filePath, afterStats] of afterState) {
			const beforeStats = beforeState.get(filePath);

			if (!beforeStats) {
				// New file created - backup as non-existent
				await this.backupFile(filePath);
			} else if (beforeStats.mtime !== afterStats.mtime || beforeStats.size !== afterStats.size) {
				// File modified - backup original (if not already backed up)
				await this.backupFile(filePath);
			}
		}

		// Find deleted files
		for (const [filePath] of beforeState) {
			if (!afterState.has(filePath)) {
				// File deleted - backup original content
				await this.backupFile(filePath);
			}
		}
	}
}

export const incrementalSnapshotManager = new IncrementalSnapshotManager();
