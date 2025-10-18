import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * File state in workspace
 */
interface FileState {
	path: string;           // Relative path from workspace root
	hash: string;           // SHA256 hash of file content
	size: number;           // File size in bytes
	mtime: number;          // Last modified time
}

/**
 * Workspace snapshot
 */
interface WorkspaceSnapshot {
	sessionId: string;
	messageCount: number;
	timestamp: number;
	workspaceRoot: string;
	files: Map<string, FileState>;  // Map of relative path -> file state
}

/**
 * File backup for rollback
 */
interface FileBackup {
	path: string;           // Relative path
	content: string | null; // File content (null if file didn't exist)
	existed: boolean;       // Whether file existed before
}

/**
 * Snapshot metadata stored on disk
 */
interface SnapshotMetadata {
	sessionId: string;
	messageCount: number;
	timestamp: number;
	workspaceRoot: string;
	changedFiles: FileBackup[];  // Only store changed files
}

/**
 * Workspace Snapshot Manager
 * Provides git-like version control for workspace files
 */
class WorkspaceSnapshotManager {
	private readonly snapshotsDir: string;
	private activeSnapshot: WorkspaceSnapshot | null = null;
	private readonly ignorePatterns = [
		'node_modules/**',
		'.git/**',
		'dist/**',
		'build/**',
		'.snow/**',
		'*.log',
		'.DS_Store',
		'*.swp',
		'*.swo',
		'*~',
		'.vscode/**',
		'.idea/**'
	];

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
	 * Calculate SHA256 hash of file content
	 */
	private async calculateFileHash(filePath: string): Promise<string> {
		const content = await fs.readFile(filePath);
		return crypto.createHash('sha256').update(content).digest('hex');
	}

	/**
	 * Recursively scan directory and collect files
	 */
	private async scanDirectory(dirPath: string, basePath: string, fileStates: Map<string, FileState>): Promise<void> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				// Skip ignored patterns
				if (this.ignorePatterns.some(pattern => {
					const normalized = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
					return entry.name.match(new RegExp(normalized));
				})) {
					continue;
				}

				const fullPath = path.join(dirPath, entry.name);
				const relativePath = path.relative(basePath, fullPath);

				if (entry.isDirectory()) {
					// Recursively scan subdirectory
					await this.scanDirectory(fullPath, basePath, fileStates);
				} else if (entry.isFile()) {
					try {
						const stats = await fs.stat(fullPath);
						const hash = await this.calculateFileHash(fullPath);

						fileStates.set(relativePath, {
							path: relativePath,
							hash,
							size: stats.size,
							mtime: stats.mtimeMs
						});
					} catch (error) {
						// Skip files that can't be read
						console.error(`Failed to process file ${relativePath}:`, error);
					}
				}
			}
		} catch (error) {
			console.error(`Failed to scan directory ${dirPath}:`, error);
		}
	}

	/**
	 * Scan workspace and build file state map
	 */
	private async scanWorkspace(workspaceRoot: string): Promise<Map<string, FileState>> {
		const fileStates = new Map<string, FileState>();
		await this.scanDirectory(workspaceRoot, workspaceRoot, fileStates);
		return fileStates;
	}

	/**
	 * Create a snapshot of current workspace state
	 */
	async createSnapshot(sessionId: string, messageCount: number, workspaceRoot: string = process.cwd()): Promise<void> {
		await this.ensureSnapshotsDir();

		const files = await this.scanWorkspace(workspaceRoot);

		this.activeSnapshot = {
			sessionId,
			messageCount,
			timestamp: Date.now(),
			workspaceRoot,
			files
		};

		// Note: We don't save the snapshot to disk yet
		// We'll only save changed files when rollback is triggered
	}


	/**
	 * Get snapshot metadata path
	 */
	private getSnapshotPath(sessionId: string): string {
		return path.join(this.snapshotsDir, `${sessionId}.json`);
	}

	/**
	 * Get snapshot content directory
	 */
	private getSnapshotContentDir(sessionId: string): string {
		return path.join(this.snapshotsDir, sessionId);
	}

	/**
	 * Create snapshot when user sends message
	 */
	async createSnapshotForMessage(sessionId: string, messageIndex: number, workspaceRoot: string = process.cwd()): Promise<void> {
		await this.ensureSnapshotsDir();

		const snapshotContentDir = this.getSnapshotContentDir(`${sessionId}_${messageIndex}`);
		await fs.mkdir(snapshotContentDir, { recursive: true });

		// Scan current workspace state
		const files = await this.scanWorkspace(workspaceRoot);

		// Save file contents to snapshot directory
		const fileBackups: Array<{ path: string; hash: string }> = [];
		for (const [relativePath, fileState] of files) {
			const fullPath = path.join(workspaceRoot, relativePath);
			const backupPath = path.join(snapshotContentDir, relativePath);

			try {
				// Create directory structure
				await fs.mkdir(path.dirname(backupPath), { recursive: true });

				// Copy file to snapshot directory
				await fs.copyFile(fullPath, backupPath);

				fileBackups.push({
					path: relativePath,
					hash: fileState.hash
				});
			} catch (error) {
				console.error(`Failed to backup file ${relativePath}:`, error);
			}
		}

		// Save snapshot metadata
		const metadata: SnapshotMetadata = {
			sessionId: `${sessionId}_${messageIndex}`,
			messageCount: messageIndex,
			timestamp: Date.now(),
			workspaceRoot,
			changedFiles: fileBackups.map(f => ({
				path: f.path,
				content: null, // Content stored separately in snapshot directory
				existed: true
			}))
		};

		const metadataPath = this.getSnapshotPath(`${sessionId}_${messageIndex}`);
		await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
	}

	/**
	 * List all snapshots for a session
	 */
	async listSnapshots(sessionId: string): Promise<Array<{ messageIndex: number; timestamp: number }>> {
		await this.ensureSnapshotsDir();
		const snapshots: Array<{ messageIndex: number; timestamp: number }> = [];

		try {
			const files = await fs.readdir(this.snapshotsDir);
			for (const file of files) {
				if (file.startsWith(sessionId) && file.endsWith('.json')) {
					const metadataPath = path.join(this.snapshotsDir, file);
					const content = await fs.readFile(metadataPath, 'utf-8');
					const metadata: SnapshotMetadata = JSON.parse(content);
					snapshots.push({
						messageIndex: metadata.messageCount,
						timestamp: metadata.timestamp
					});
				}
			}
		} catch (error) {
			logger.error('Failed to list snapshots:', error);
		}

		return snapshots.sort((a, b) => b.messageIndex - a.messageIndex);
	}

	/**
	 * Rollback workspace to specific snapshot
	 */
	async rollbackToSnapshot(sessionId: string, messageIndex: number): Promise<number | null> {
		const snapshotId = `${sessionId}_${messageIndex}`;
		const metadataPath = this.getSnapshotPath(snapshotId);
		const snapshotContentDir = this.getSnapshotContentDir(snapshotId);

		try {
			// Load snapshot metadata
			const metadataContent = await fs.readFile(metadataPath, 'utf-8');
			const metadata: SnapshotMetadata = JSON.parse(metadataContent);

			// Get current workspace files
			const currentFiles = await this.scanWorkspace(metadata.workspaceRoot);

			// Find files that exist now but didn't exist in snapshot
			// (these should be deleted)
			const snapshotFilePaths = new Set(
				metadata.changedFiles.map(f => f.path)
			);

			for (const [relativePath] of currentFiles) {
				if (!snapshotFilePaths.has(relativePath)) {
					// This file was created after snapshot, delete it
					const fullPath = path.join(metadata.workspaceRoot, relativePath);
					try {
						await fs.unlink(fullPath);
					} catch (error) {
						console.error(`Failed to delete new file ${relativePath}:`, error);
					}
				}
			}

			// Restore all files from snapshot
			for (const fileBackup of metadata.changedFiles) {
				const backupPath = path.join(snapshotContentDir, fileBackup.path);
				const fullPath = path.join(metadata.workspaceRoot, fileBackup.path);

				try {
					// Restore file from backup
					await fs.copyFile(backupPath, fullPath);
				} catch (error) {
					console.error(`Failed to restore file ${fileBackup.path}:`, error);
				}
			}

			// Don't clean up snapshot - keep for future rollbacks

			return metadata.messageCount;
		} catch (error) {
			console.error('Failed to rollback workspace:', error);
			return null;
		}
	}

	/**
	 * Clear snapshot for a session
	 */
	async clearSnapshot(sessionId: string): Promise<void> {
		const metadataPath = this.getSnapshotPath(sessionId);
		const snapshotContentDir = this.getSnapshotContentDir(sessionId);

		try {
			// Delete metadata
			await fs.unlink(metadataPath);
		} catch (error) {
			// Ignore if doesn't exist
		}

		try {
			// Delete snapshot content directory
			await fs.rm(snapshotContentDir, { recursive: true, force: true });
		} catch (error) {
			// Ignore if doesn't exist
		}

		if (this.activeSnapshot?.sessionId === sessionId) {
			this.activeSnapshot = null;
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
				if (file.startsWith(sessionId)) {
					const filePath = path.join(this.snapshotsDir, file);
					if (file.endsWith('.json')) {
						await fs.unlink(filePath);
					} else {
						await fs.rm(filePath, { recursive: true, force: true });
					}
				}
			}
		} catch (error) {
			console.error('Failed to clear snapshots:', error);
		}
	}
}

export const workspaceSnapshotManager = new WorkspaceSnapshotManager();
