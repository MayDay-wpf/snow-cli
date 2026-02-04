import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {logger} from '../core/logger.js';
import {getProjectId} from '../session/projectUtils.js';

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
 * On-demand backup: directly saves backups to disk when files are created/edited
 * No global monitoring, no memory caching
 */
class HashBasedSnapshotManager {
	private readonly snapshotsDir: string;

	/**
	 * Compute rollback preview content for a specific file.
	 * It simulates rollbackToMessageIndex for that file only, but does not touch disk.
	 */
	async getRollbackPreviewForFile(
		sessionId: string,
		targetMessageIndex: number,
		filePath: string,
	): Promise<{
		workspaceRoot: string;
		absolutePath: string;
		relativePath: string;
		currentContent: string;
		rollbackContent: string;
		wouldDelete: boolean;
	}> {
		await this.ensureSnapshotsDir();

		const files = await fs.readdir(this.snapshotsDir);
		const snapshotFiles: Array<{messageIndex: number; path: string}> = [];

		for (const file of files) {
			if (!file.startsWith(`${sessionId}_`) || !file.endsWith('.json')) {
				continue;
			}

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

		// Most recent first (matches rollbackToMessageIndex processing order)
		snapshotFiles.sort((a, b) => b.messageIndex - a.messageIndex);

		let workspaceRoot = '';
		let relativePath = filePath;
		let absolutePath = filePath;

		// Resolve workspaceRoot and normalize relative/absolute path
		if (snapshotFiles.length > 0) {
			const first = snapshotFiles[0];
			if (first) {
				const firstContent = await fs.readFile(first.path, 'utf-8');
				const firstMetadata: SnapshotMetadata = JSON.parse(firstContent);
				workspaceRoot = firstMetadata.workspaceRoot;
			}
		}

		if (workspaceRoot && path.isAbsolute(filePath)) {
			relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
			absolutePath = filePath;
		} else if (workspaceRoot && !path.isAbsolute(filePath)) {
			relativePath = filePath.replace(/\\/g, '/');
			absolutePath = path.join(workspaceRoot, relativePath);
		} else {
			// Fallback: treat provided path as absolute if it looks absolute; otherwise use cwd.
			relativePath = filePath.replace(/\\/g, '/');
			absolutePath = path.isAbsolute(filePath)
				? filePath
				: path.join(process.cwd(), relativePath);
			workspaceRoot = path.dirname(absolutePath);
		}

		let currentContent = '';
		try {
			currentContent = await fs.readFile(absolutePath, 'utf-8');
		} catch {
			currentContent = '';
		}

		let rollbackContent = currentContent;
		let wouldDelete = false;

		for (const snapshotFile of snapshotFiles) {
			const content = await fs.readFile(snapshotFile.path, 'utf-8');
			const metadata: SnapshotMetadata = JSON.parse(content);
			const backup = metadata.backups.find(b => b.path === relativePath);
			if (!backup) {
				continue;
			}

			if (backup.existed && backup.content !== null) {
				rollbackContent = backup.content;
				wouldDelete = false;
			} else if (!backup.existed) {
				rollbackContent = '';
				wouldDelete = true;
			}
		}

		return {
			workspaceRoot,
			absolutePath,
			relativePath,
			currentContent,
			rollbackContent,
			wouldDelete,
		};
	}

	/**
	 * Lock map to prevent concurrent writes to the same snapshot file
	 * Key: snapshot file path, Value: Promise that resolves when lock is released
	 */
	private readonly fileLocks: Map<string, Promise<void>> = new Map();

	constructor() {
		const projectId = getProjectId();
		this.snapshotsDir = path.join(
			os.homedir(),
			'.snow',
			'snapshots',
			projectId,
		);
	}

	/**
	 * Acquire a lock for a specific file path
	 * Ensures sequential access to prevent race conditions
	 */
	private async acquireLock(filePath: string): Promise<() => void> {
		// Wait for any existing lock to be released
		while (this.fileLocks.has(filePath)) {
			await this.fileLocks.get(filePath);
		}

		// Create a new lock
		let releaseLock: () => void;
		const lockPromise = new Promise<void>(resolve => {
			releaseLock = resolve;
		});
		this.fileLocks.set(filePath, lockPromise);

		// Return the release function
		return () => {
			this.fileLocks.delete(filePath);
			releaseLock!();
		};
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
	 * Backup a file before modification or creation
	 * @param sessionId Current session ID
	 * @param messageIndex Current message index
	 * @param filePath File path (relative to workspace root)
	 * @param workspaceRoot Workspace root directory
	 * @param existed Whether the file existed before (false for new files)
	 * @param originalContent Original file content (undefined for new files)
	 */
	async backupFile(
		sessionId: string,
		messageIndex: number,
		filePath: string,
		workspaceRoot: string,
		existed: boolean,
		originalContent?: string,
	): Promise<void> {
		const snapshotPath = this.getSnapshotPath(sessionId, messageIndex);

		// Acquire lock to prevent concurrent writes to the same snapshot file
		const releaseLock = await this.acquireLock(snapshotPath);

		try {
			logger.info(
				`[Snapshot] backupFile called: sessionId=${sessionId}, messageIndex=${messageIndex}, filePath=${filePath}, existed=${existed}`,
			);
			await this.ensureSnapshotsDir();
			logger.info(`[Snapshot] snapshotPath=${snapshotPath}`);

			// Calculate relative path
			const relativePath = path.isAbsolute(filePath)
				? path.relative(workspaceRoot, filePath)
				: filePath;

			// Create backup entry
			const backup: FileBackup = {
				path: relativePath,
				content: existed ? originalContent ?? null : null,
				existed,
				hash: originalContent
					? crypto.createHash('sha256').update(originalContent).digest('hex')
					: '',
			};

			// Load existing snapshot metadata or create new
			let metadata: SnapshotMetadata;
			try {
				const content = await fs.readFile(snapshotPath, 'utf-8');
				metadata = JSON.parse(content);
			} catch {
				// Snapshot doesn't exist, create new
				metadata = {
					sessionId,
					messageIndex,
					timestamp: Date.now(),
					workspaceRoot,
					backups: [],
				};
			}

			// Check if this file already has a backup in this snapshot
			const existingBackupIndex = metadata.backups.findIndex(
				b => b.path === relativePath,
			);

			if (existingBackupIndex === -1) {
				// No existing backup, add new
				metadata.backups.push(backup);
				await this.saveSnapshotMetadata(metadata);
				logger.info(
					`[Snapshot] Backed up file ${relativePath} for session ${sessionId} message ${messageIndex}`,
				);
			}
			// If backup already exists, keep the original (first backup wins)
		} catch (error) {
			logger.warn(`[Snapshot] Failed to backup file ${filePath}:`, error);
		} finally {
			// Always release the lock
			releaseLock();
		}
	}

	/**
	 * Remove a specific file backup from snapshot (for failed operations)
	 * @param sessionId Current session ID
	 * @param messageIndex Current message index
	 * @param filePath File path to remove from backup
	 */
	async removeFileBackup(
		sessionId: string,
		messageIndex: number,
		filePath: string,
		workspaceRoot: string,
	): Promise<void> {
		const snapshotPath = this.getSnapshotPath(sessionId, messageIndex);

		// Acquire lock to prevent concurrent writes to the same snapshot file
		const releaseLock = await this.acquireLock(snapshotPath);

		try {
			// Load existing snapshot
			try {
				const content = await fs.readFile(snapshotPath, 'utf-8');
				const metadata: SnapshotMetadata = JSON.parse(content);

				// Calculate relative path
				const relativePath = path.isAbsolute(filePath)
					? path.relative(workspaceRoot, filePath)
					: filePath;

				// Remove backup for this file
				const originalLength = metadata.backups.length;
				metadata.backups = metadata.backups.filter(
					b => b.path !== relativePath,
				);

				if (metadata.backups.length < originalLength) {
					// If no backups left, delete entire snapshot file
					if (metadata.backups.length === 0) {
						await fs.unlink(snapshotPath);
						logger.info(
							`[Snapshot] Deleted empty snapshot ${sessionId}_${messageIndex}`,
						);
					} else {
						// Otherwise save updated metadata
						await this.saveSnapshotMetadata(metadata);
						logger.info(
							`[Snapshot] Removed backup for ${relativePath} from snapshot ${sessionId}_${messageIndex}`,
						);
					}
				}
			} catch (error) {
				// Snapshot doesn't exist, nothing to remove
			}
		} catch (error) {
			logger.warn(
				`[Snapshot] Failed to remove file backup ${filePath}:`,
				error,
			);
		} finally {
			// Always release the lock
			releaseLock();
		}
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
				if (file.startsWith(`${sessionId}_`) && file.endsWith('.json')) {
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
				if (file.startsWith(`${sessionId}_`) && file.endsWith('.json')) {
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
				if (file.startsWith(`${sessionId}_`) && file.endsWith('.json')) {
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
				if (file.startsWith(`${sessionId}_`) && file.endsWith('.json')) {
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
				if (file.startsWith(`${sessionId}_`) && file.endsWith('.json')) {
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
