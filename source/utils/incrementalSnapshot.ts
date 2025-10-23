import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

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
			logger.error('Failed to list snapshots:', error);
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
	 * Get list of files that will be affected by rollback to a specific message index
	 * @param sessionId Session ID
	 * @param targetMessageIndex The message index to rollback to (inclusive)
	 * @returns Array of file paths that will be rolled back
	 */
	async getFilesToRollback(sessionId: string, targetMessageIndex: number): Promise<string[]> {
		await this.ensureSnapshotsDir();

		try {
			const files = await fs.readdir(this.snapshotsDir);
			const filesToRollback = new Set<string>();

			// Load all snapshots for this session
			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const snapshotPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(snapshotPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);

					// Include files from snapshots >= targetMessageIndex
					if (metadata.messageIndex >= targetMessageIndex) {
						for (const backup of metadata.backups) {
							// Convert to relative path for better display
							const relativePath = path.relative(process.cwd(), backup.path);
							filesToRollback.add(relativePath || backup.path);
						}
					}
				}
			}

			return Array.from(filesToRollback).sort();
		} catch (error) {
			console.error('Failed to get files to rollback:', error);
			return [];
		}
	}

	/**
	 * Rollback all snapshots after a specific message index
	 * This is used when user selects to rollback to a specific message
	 * @param sessionId Session ID
	 * @param targetMessageIndex The message index to rollback to (inclusive)
	 * @returns Number of files rolled back
	 */
	async rollbackToMessageIndex(sessionId: string, targetMessageIndex: number): Promise<number> {
		await this.ensureSnapshotsDir();

		try {
			const files = await fs.readdir(this.snapshotsDir);
			const snapshots: Array<{ messageIndex: number; path: string; metadata: SnapshotMetadata }> = [];

			// Load all snapshots for this session
			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const snapshotPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(snapshotPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);
					snapshots.push({
						messageIndex: metadata.messageIndex,
						path: snapshotPath,
						metadata
					});
				}
			}

			// Filter snapshots that are >= targetMessageIndex and sort in descending order
			// We rollback from newest to oldest to ensure correct restoration
			const snapshotsToRollback = snapshots
				.filter(s => s.messageIndex >= targetMessageIndex)
				.sort((a, b) => b.messageIndex - a.messageIndex);

			let totalFilesRolledBack = 0;

			// Rollback each snapshot in reverse chronological order
			for (const snapshot of snapshotsToRollback) {
				for (const backup of snapshot.metadata.backups) {
					try {
						if (backup.existed && backup.content !== null) {
							// Restore original file content
							await fs.writeFile(backup.path, backup.content, 'utf-8');
							totalFilesRolledBack++;
						} else if (!backup.existed) {
							// Delete file that was created
							try {
								await fs.unlink(backup.path);
								totalFilesRolledBack++;
							} catch (error) {
								// File may not exist, ignore
							}
						}
					} catch (error) {
						console.error(`Failed to restore file ${backup.path}:`, error);
					}
				}
			}

			return totalFilesRolledBack;
		} catch (error) {
			console.error('Failed to rollback to message index:', error);
			return 0;
		}
	}

	/**
	 * Delete all snapshots >= targetMessageIndex
	 * This is used when user rolls back conversation to clean up snapshot files
	 * @param sessionId Session ID
	 * @param targetMessageIndex The message index to delete from (inclusive)
	 */
	async deleteSnapshotsFromIndex(sessionId: string, targetMessageIndex: number): Promise<number> {
		await this.ensureSnapshotsDir();

		try {
			const files = await fs.readdir(this.snapshotsDir);
			let deletedCount = 0;

			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const snapshotPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(snapshotPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);

					// Delete snapshots with messageIndex >= targetMessageIndex
					if (metadata.messageIndex >= targetMessageIndex) {
						try {
							await fs.unlink(snapshotPath);
							deletedCount++;
						} catch (error) {
							console.error(`Failed to delete snapshot file ${snapshotPath}:`, error);
						}
					}
				}
			}

			return deletedCount;
		} catch (error) {
			console.error('Failed to delete snapshots from index:', error);
			return 0;
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
