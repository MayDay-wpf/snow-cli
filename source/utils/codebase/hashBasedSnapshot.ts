import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import ignore, {type Ignore} from 'ignore';
import {logger} from '../core/logger.js';
import {getProjectId} from '../session/projectUtils.js';

/**
 * File state tracked by hash AND content (optional for memory optimization)
 */
interface FileState {
	path: string; // Relative path from workspace root
	hash: string; // SHA256 hash of file content
	size: number; // File size in bytes
	mtime: number; // Last modified timestamp
	content: string; // File content (empty string if not loaded for memory optimization)
}

/**
 * File backup entry for rollback
 */
interface FileBackup {
	path: string; // Relative path from workspace root
	content: string | null; // File content (null if file didn't exist)
	existed: boolean; // Whether file existed before
	hash: string; // Hash of original content
}

/**
 * Snapshot metadata
 */
interface SnapshotMetadata {
	sessionId: string;
	messageIndex: number;
	timestamp: number;
	workspaceRoot: string;
	backups: FileBackup[]; // Only files that changed
}

/**
 * Hash-Based Snapshot Manager
 * Tracks file changes by SHA256 hash, not by edit operations
 * Respects .gitignore patterns for efficient file filtering
 */
class HashBasedSnapshotManager {
	private readonly snapshotsDir: string;
	// Support multiple concurrent snapshots, keyed by sessionId:messageIndex for session isolation
	private activeSnapshots: Map<
		string, // Key format: "sessionId:messageIndex"
		{
			metadata: SnapshotMetadata;
			beforeStateMap: Map<string, FileState>;
		}
	> = new Map();
	private ignoreFilter: Ignore;

	constructor() {
		const projectId = getProjectId();
		this.snapshotsDir = path.join(
			os.homedir(),
			'.snow',
			'.git',
			'snapshots',
			projectId,
		);
		this.ignoreFilter = ignore();
		this.loadIgnorePatterns();
	}

	/**
	 * Load .gitignore patterns
	 */
	private loadIgnorePatterns(): void {
		const workspaceRoot = process.cwd();
		const gitignorePath = path.join(workspaceRoot, '.gitignore');

		if (fssync.existsSync(gitignorePath)) {
			try {
				const content = fssync.readFileSync(gitignorePath, 'utf-8');
				this.ignoreFilter.add(content);
			} catch (error) {
				logger.warn('Failed to load .gitignore:', error);
			}
		}
	}

	/**
	 * Scan directory recursively and collect file states (metadata only, no content)
	 */
	private async scanDirectory(
		dirPath: string,
		workspaceRoot: string,
		fileStates: Map<string, FileState>,
		includeContent: boolean = false,
	): Promise<void> {
		try {
			const entries = await fs.readdir(dirPath, {withFileTypes: true});

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);
				const relativePath = path.relative(workspaceRoot, fullPath);

				// Skip if matches ignore patterns
				if (relativePath && this.ignoreFilter.ignores(relativePath)) {
					continue;
				}

				if (entry.isDirectory()) {
					await this.scanDirectory(
						fullPath,
						workspaceRoot,
						fileStates,
						includeContent,
					);
				} else if (entry.isFile()) {
					try {
						const stats = await fs.stat(fullPath);
						let content = '';
						let hash = '';

						if (includeContent) {
							content = await fs.readFile(fullPath, 'utf-8');
							hash = crypto.createHash('sha256').update(content).digest('hex');
						} else {
							// Only calculate hash without storing content
							const buffer = await fs.readFile(fullPath);
							hash = crypto.createHash('sha256').update(buffer).digest('hex');
						}

						fileStates.set(relativePath, {
							path: relativePath,
							hash,
							size: stats.size,
							mtime: stats.mtimeMs,
							content: includeContent ? content : '', // Only store content if requested
						});
					} catch (error) {
						// Skip files that can't be read (binary files, permission issues, etc.)
					}
				}
			}
		} catch (error) {
			// Skip directories that can't be accessed
		}
	}

	/**
	 * Scan workspace and build file state map
	 */
	private async scanWorkspace(
		workspaceRoot: string = process.cwd(),
	): Promise<Map<string, FileState>> {
		const fileStates = new Map<string, FileState>();
		await this.scanDirectory(workspaceRoot, workspaceRoot, fileStates);
		return fileStates;
	}

	/**
	 * Ensure snapshots directory exists
	 */
	private async ensureSnapshotsDir(): Promise<void> {
		await fs.mkdir(this.snapshotsDir, {recursive: true});
	}

	/**
	 * Get snapshot file path
	 */
	private getSnapshotPath(sessionId: string, messageIndex: number): string {
		return path.join(this.snapshotsDir, `${sessionId}_${messageIndex}.json`);
	}

	/**
	 * Create snapshot before message processing
	 * Captures current workspace state by hash
	 */
	async createSnapshot(
		sessionId: string,
		messageIndex: number,
		workspaceRoot: string = process.cwd(),
	): Promise<void> {
		// Scan current workspace and store state
		const beforeStateMap = await this.scanWorkspace(workspaceRoot);

		// Store snapshot with sessionId:messageIndex as key for session isolation
		const snapshotKey = `${sessionId}:${messageIndex}`;
		this.activeSnapshots.set(snapshotKey, {
			metadata: {
				sessionId,
				messageIndex,
				timestamp: Date.now(),
				workspaceRoot,
				backups: [],
			},
			beforeStateMap,
		});

		logger.info(
			`[Snapshot] Created snapshot for session ${sessionId} message ${messageIndex}`,
		);
	}

	/**
	 * Commit snapshot after message processing
	 * Compares current workspace state with snapshot and saves changes
	 * @param sessionId The session ID (required for session isolation)
	 * @param messageIndex The message index to commit (if not provided, commits the oldest snapshot for this session)
	 * @returns Object with fileCount and messageIndex, or null if no active snapshot
	 */
	async commitSnapshot(
		sessionId: string,
		messageIndex?: number,
	): Promise<{
		fileCount: number;
		messageIndex: number;
	} | null> {
		// If messageIndex not provided, get the oldest snapshot for this session
		if (messageIndex === undefined) {
			const keys = Array.from(this.activeSnapshots.keys());
			const sessionKeys = keys
				.filter(key => key.startsWith(`${sessionId}:`))
				.map(key => {
					const parts = key.split(':');
					return parseInt(parts[1] || '0', 10);
				})
				.filter(index => !isNaN(index));
			if (sessionKeys.length === 0) {
				return null;
			}
			messageIndex = Math.min(...sessionKeys);
		}

		const snapshotKey = `${sessionId}:${messageIndex}`;
		const snapshot = this.activeSnapshots.get(snapshotKey);
		if (!snapshot) {
			logger.warn(
				`[Snapshot] No active snapshot found for session ${sessionId} message ${messageIndex}`,
			);
			return null;
		}

		const {metadata, beforeStateMap} = snapshot;
		const workspaceRoot = metadata.workspaceRoot;
		// Scan workspace for comparison, but don't load content yet
		const afterStateMap = await this.scanWorkspace(workspaceRoot);

		// Find changed, new, and deleted files
		const changedFiles: FileBackup[] = [];

		// Check for modified and deleted files
		for (const [relativePath, beforeState] of beforeStateMap) {
			const afterState = afterStateMap.get(relativePath);
			const fullPath = path.join(workspaceRoot, relativePath);

			if (!afterState) {
				// File deleted - read content now
				try {
					const content = await fs.readFile(fullPath, 'utf-8');
					changedFiles.push({
						path: relativePath,
						content,
						existed: true,
						hash: beforeState.hash,
					});
				} catch {
					// File already deleted, we can't recover it
					changedFiles.push({
						path: relativePath,
						content: null,
						existed: true,
						hash: beforeState.hash,
					});
				}
			} else if (beforeState.hash !== afterState.hash) {
				// File modified - read original content now
				try {
					const content = await fs.readFile(fullPath, 'utf-8');
					changedFiles.push({
						path: relativePath,
						content,
						existed: true,
						hash: beforeState.hash,
					});
				} catch (error) {
					logger.warn(`Failed to read modified file ${relativePath}:`, error);
				}
			}
		}

		// Check for new files
		for (const [relativePath, afterState] of afterStateMap) {
			if (!beforeStateMap.has(relativePath)) {
				// New file created - we don't need to store its content
				// Just mark it as a new file
				changedFiles.push({
					path: relativePath,
					content: null, // No need to store content for new files
					existed: false,
					hash: afterState.hash,
				});
			}
		}

		// Only save snapshot if there are changes
		if (changedFiles.length > 0) {
			metadata.backups = changedFiles;
			await this.saveSnapshotMetadata(metadata);
			logger.info(
				`[Snapshot] Committed: ${changedFiles.length} files changed for session ${sessionId} message ${messageIndex}`,
			);
		} else {
			logger.info(
				`[Snapshot] No changes detected for session ${sessionId} message ${messageIndex}`,
			);
		}

		// Remove from active snapshots and release memory
		this.activeSnapshots.delete(snapshotKey);

		return {fileCount: changedFiles.length, messageIndex};
	}

	/**
	 * Save snapshot to disk
	 */
	private async saveSnapshotMetadata(
		metadata: SnapshotMetadata,
	): Promise<void> {
		await this.ensureSnapshotsDir();
		const snapshotPath = this.getSnapshotPath(
			metadata.sessionId,
			metadata.messageIndex,
		);

		await fs.writeFile(snapshotPath, JSON.stringify(metadata, null, 2));
	}

	/**
	 * List all snapshots for a session
	 */
	async listSnapshots(
		sessionId: string,
	): Promise<
		Array<{messageIndex: number; timestamp: number; fileCount: number}>
	> {
		await this.ensureSnapshotsDir();
		const snapshots: Array<{
			messageIndex: number;
			timestamp: number;
			fileCount: number;
		}> = [];

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
						fileCount: metadata.backups.length,
					});
				}
			}
		} catch (error) {
			logger.error('Failed to list snapshots:', error);
		}

		return snapshots.sort((a, b) => b.messageIndex - a.messageIndex);
	}

	/**
	 * Get list of files affected by rollback
	 */
	async getFilesToRollback(
		sessionId: string,
		targetMessageIndex: number,
	): Promise<string[]> {
		await this.ensureSnapshotsDir();

		try {
			const files = await fs.readdir(this.snapshotsDir);
			const filesToRollback = new Set<string>();

			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const snapshotPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(snapshotPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);

					if (metadata.messageIndex >= targetMessageIndex) {
						for (const backup of metadata.backups) {
							filesToRollback.add(backup.path);
						}
					}
				}
			}

			return Array.from(filesToRollback).sort();
		} catch (error) {
			logger.error('Failed to get files to rollback:', error);
			return [];
		}
	}

	/**
	 * Rollback to a specific message index
	 * Uses streaming approach to minimize memory usage
	 */
	async rollbackToMessageIndex(
		sessionId: string,
		targetMessageIndex: number,
		selectedFiles?: string[],
	): Promise<number> {
		await this.ensureSnapshotsDir();

		try {
			const files = await fs.readdir(this.snapshotsDir);
			const snapshotFiles: Array<{
				messageIndex: number;
				path: string;
			}> = [];

			// First pass: just collect snapshot file paths (minimal memory)
			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const snapshotPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(snapshotPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);

					if (metadata.messageIndex >= targetMessageIndex) {
						snapshotFiles.push({
							messageIndex: metadata.messageIndex,
							path: snapshotPath,
						});
					}
				}
			}

			// Sort snapshots in reverse order
			snapshotFiles.sort((a, b) => b.messageIndex - a.messageIndex);

			let totalFilesRolledBack = 0;

			// Second pass: process snapshots one by one (streaming)
			for (const snapshotFile of snapshotFiles) {
				// Read one snapshot at a time
				const content = await fs.readFile(snapshotFile.path, 'utf-8');
				const metadata: SnapshotMetadata = JSON.parse(content);

				// Process each backup file
				for (const backup of metadata.backups) {
					// If selectedFiles is provided, only rollback selected files
					if (
						selectedFiles &&
						selectedFiles.length > 0 &&
						!selectedFiles.includes(backup.path)
					) {
						continue;
					}

					const fullPath = path.join(metadata.workspaceRoot, backup.path);

					try {
						if (backup.existed && backup.content !== null) {
							// Restore original file
							await fs.writeFile(fullPath, backup.content, 'utf-8');
							totalFilesRolledBack++;
						} else if (!backup.existed) {
							// Delete newly created file
							try {
								await fs.unlink(fullPath);
								totalFilesRolledBack++;
							} catch {
								// File may not exist
							}
						}
					} catch (error) {
						logger.error(`Failed to restore file ${backup.path}:`, error);
					}
				}

				// Release memory: metadata will be garbage collected after this iteration
			}

			return totalFilesRolledBack;
		} catch (error) {
			logger.error('Failed to rollback to message index:', error);
			return 0;
		}
	}

	/**
	 * Delete snapshots from a specific message index onwards
	 */
	async deleteSnapshotsFromIndex(
		sessionId: string,
		targetMessageIndex: number,
	): Promise<number> {
		await this.ensureSnapshotsDir();

		try {
			const files = await fs.readdir(this.snapshotsDir);
			let deletedCount = 0;

			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const snapshotPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(snapshotPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);

					if (metadata.messageIndex >= targetMessageIndex) {
						try {
							await fs.unlink(snapshotPath);
							deletedCount++;
						} catch (error) {
							logger.error(
								`Failed to delete snapshot file ${snapshotPath}:`,
								error,
							);
						}
					}
				}
			}

			return deletedCount;
		} catch (error) {
			logger.error('Failed to delete snapshots from index:', error);
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
			logger.error('Failed to clear snapshots:', error);
		}
	}
}

export const hashBasedSnapshotManager = new HashBasedSnapshotManager();
