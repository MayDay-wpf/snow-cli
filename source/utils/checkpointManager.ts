import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * File checkpoint data structure
 */
export interface FileCheckpoint {
	path: string;           // File absolute path
	content: string;        // Original file content
	timestamp: number;      // Checkpoint creation time
	exists: boolean;        // Whether file existed before operation
}

/**
 * Conversation checkpoint data structure
 */
export interface ConversationCheckpoint {
	sessionId: string;      // Session ID
	messageCount: number;   // Number of messages before AI response
	fileSnapshots: FileCheckpoint[];  // File snapshots list
	timestamp: number;      // Checkpoint creation time
}

/**
 * Checkpoint Manager
 * Manages file snapshots for rollback on ESC interrupt
 */
class CheckpointManager {
	private readonly checkpointsDir: string;
	private activeCheckpoint: ConversationCheckpoint | null = null;

	constructor() {
		this.checkpointsDir = path.join(os.homedir(), '.snow', 'checkpoints');
	}

	/**
	 * Ensure checkpoints directory exists
	 */
	private async ensureCheckpointsDir(): Promise<void> {
		try {
			await fs.mkdir(this.checkpointsDir, { recursive: true });
		} catch (error) {
			// Directory already exists or other error
		}
	}

	/**
	 * Get checkpoint file path for a session
	 */
	private getCheckpointPath(sessionId: string): string {
		return path.join(this.checkpointsDir, `${sessionId}.json`);
	}

	/**
	 * Create a new checkpoint before AI response
	 * @param sessionId - Current session ID
	 * @param messageCount - Number of messages before AI response
	 */
	async createCheckpoint(sessionId: string, messageCount: number): Promise<void> {
		await this.ensureCheckpointsDir();

		this.activeCheckpoint = {
			sessionId,
			messageCount,
			fileSnapshots: [],
			timestamp: Date.now()
		};

		// Save checkpoint immediately (will be updated as files are modified)
		await this.saveCheckpoint();
	}

	/**
	 * Record a file snapshot before modification
	 * @param filePath - Absolute path to the file
	 */
	async recordFileSnapshot(filePath: string): Promise<void> {
		if (!this.activeCheckpoint) {
			return; // No active checkpoint, skip
		}

		// Check if this file already has a snapshot
		const existingSnapshot = this.activeCheckpoint.fileSnapshots.find(
			snapshot => snapshot.path === filePath
		);

		if (existingSnapshot) {
			return; // Already recorded, skip
		}

		try {
			// Try to read existing file content
			const content = await fs.readFile(filePath, 'utf-8');
			this.activeCheckpoint.fileSnapshots.push({
				path: filePath,
				content,
				timestamp: Date.now(),
				exists: true
			});
		} catch (error) {
			// File doesn't exist, record as non-existent
			this.activeCheckpoint.fileSnapshots.push({
				path: filePath,
				content: '',
				timestamp: Date.now(),
				exists: false
			});
		}

		// Update checkpoint file
		await this.saveCheckpoint();
	}

	/**
	 * Save current checkpoint to disk
	 */
	private async saveCheckpoint(): Promise<void> {
		if (!this.activeCheckpoint) {
			return;
		}

		await this.ensureCheckpointsDir();
		const checkpointPath = this.getCheckpointPath(this.activeCheckpoint.sessionId);
		await fs.writeFile(checkpointPath, JSON.stringify(this.activeCheckpoint, null, 2));
	}

	/**
	 * Load checkpoint from disk
	 */
	async loadCheckpoint(sessionId: string): Promise<ConversationCheckpoint | null> {
		try {
			const checkpointPath = this.getCheckpointPath(sessionId);
			const data = await fs.readFile(checkpointPath, 'utf-8');
			return JSON.parse(data);
		} catch (error) {
			return null;
		}
	}

	/**
	 * Rollback files to checkpoint state
	 * @param sessionId - Session ID to rollback
	 * @returns Number of messages to rollback to, or null if no checkpoint
	 */
	async rollback(sessionId: string): Promise<number | null> {
		const checkpoint = await this.loadCheckpoint(sessionId);
		if (!checkpoint) {
			return null;
		}

		// Rollback all file snapshots
		for (const snapshot of checkpoint.fileSnapshots) {
			try {
				if (snapshot.exists) {
					// Restore original file content
					await fs.writeFile(snapshot.path, snapshot.content, 'utf-8');
				} else {
					// Delete file that was created
					try {
						await fs.unlink(snapshot.path);
					} catch (error) {
						// File may already be deleted, ignore
					}
				}
			} catch (error) {
				console.error(`Failed to rollback file ${snapshot.path}:`, error);
			}
		}

		// Clear checkpoint after rollback
		await this.clearCheckpoint(sessionId);

		return checkpoint.messageCount;
	}

	/**
	 * Clear checkpoint for a session
	 */
	async clearCheckpoint(sessionId: string): Promise<void> {
		try {
			const checkpointPath = this.getCheckpointPath(sessionId);
			await fs.unlink(checkpointPath);
		} catch (error) {
			// Checkpoint may not exist, ignore
		}

		if (this.activeCheckpoint?.sessionId === sessionId) {
			this.activeCheckpoint = null;
		}
	}

	/**
	 * Get active checkpoint
	 */
	getActiveCheckpoint(): ConversationCheckpoint | null {
		return this.activeCheckpoint;
	}

	/**
	 * Clear active checkpoint (used when conversation completes successfully)
	 */
	async commitCheckpoint(): Promise<void> {
		if (this.activeCheckpoint) {
			await this.clearCheckpoint(this.activeCheckpoint.sessionId);
		}
	}
}

export const checkpointManager = new CheckpointManager();
