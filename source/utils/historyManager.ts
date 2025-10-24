import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {logger} from './logger.js';

export interface HistoryEntry {
	content: string;
	timestamp: number;
}

export interface HistoryData {
	entries: HistoryEntry[];
	lastCleanup: number;
}

class HistoryManager {
	private readonly historyFile: string;
	private readonly maxAge = 24 * 60 * 60 * 1000; // 1 day in milliseconds
	private readonly maxEntries = 1000; // Maximum number of entries to keep
	private historyData: HistoryData | null = null;

	constructor() {
		const snowDir = path.join(os.homedir(), '.snow');
		this.historyFile = path.join(snowDir, 'history.json');
	}

	/**
	 * Ensure the .snow directory exists
	 */
	private async ensureSnowDir(): Promise<void> {
		try {
			const snowDir = path.dirname(this.historyFile);
			await fs.mkdir(snowDir, {recursive: true});
		} catch (error) {
			// Directory already exists or other error
		}
	}

	/**
	 * Load history from file
	 */
	async loadHistory(): Promise<HistoryEntry[]> {
		try {
			await this.ensureSnowDir();

			// Try to read existing history file
			const data = await fs.readFile(this.historyFile, 'utf-8');
			this.historyData = JSON.parse(data) as HistoryData;

			// Clean up old entries if needed
			await this.cleanupOldEntries();

			return this.historyData.entries;
		} catch (error) {
			// File doesn't exist or is corrupted, start fresh
			this.historyData = {
				entries: [],
				lastCleanup: Date.now(),
			};
			return [];
		}
	}

	/**
	 * Add a new entry to history
	 */
	async addEntry(content: string): Promise<void> {
		// Don't add empty or whitespace-only entries
		if (!content || !content.trim()) {
			return;
		}

		// Load history if not already loaded
		if (!this.historyData) {
			await this.loadHistory();
		}

		// Don't add duplicate of the last entry
		const lastEntry = this.historyData!.entries[this.historyData!.entries.length - 1];
		if (lastEntry && lastEntry.content === content) {
			return;
		}

		// Add new entry
		const newEntry: HistoryEntry = {
			content,
			timestamp: Date.now(),
		};

		this.historyData!.entries.push(newEntry);

		// Limit the number of entries
		if (this.historyData!.entries.length > this.maxEntries) {
			this.historyData!.entries = this.historyData!.entries.slice(-this.maxEntries);
		}

		// Save to file
		await this.saveHistory();
	}

	/**
	 * Get all history entries (newest first)
	 */
	async getEntries(): Promise<HistoryEntry[]> {
		if (!this.historyData) {
			await this.loadHistory();
		}

		// Return a copy in reverse order (newest first)
		return [...this.historyData!.entries].reverse();
	}

	/**
	 * Clean up entries older than maxAge
	 */
	private async cleanupOldEntries(): Promise<void> {
		if (!this.historyData) {
			return;
		}

		const now = Date.now();
		const cutoffTime = now - this.maxAge;

		// Only cleanup once per hour to avoid excessive file writes
		if (now - this.historyData.lastCleanup < 60 * 60 * 1000) {
			return;
		}

		// Filter out old entries
		const originalLength = this.historyData.entries.length;
		this.historyData.entries = this.historyData.entries.filter(
			entry => entry.timestamp > cutoffTime,
		);

		// Update last cleanup time
		this.historyData.lastCleanup = now;

		// Save if we removed any entries
		if (this.historyData.entries.length < originalLength) {
			await this.saveHistory();
			logger.debug(
				`Cleaned up ${originalLength - this.historyData.entries.length} old history entries`,
			);
		}
	}

	/**
	 * Save history to file
	 */
	private async saveHistory(): Promise<void> {
		if (!this.historyData) {
			return;
		}

		try {
			await this.ensureSnowDir();
			await fs.writeFile(
				this.historyFile,
				JSON.stringify(this.historyData, null, 2),
				'utf-8',
			);
		} catch (error) {
			logger.error('Failed to save history:', error);
		}
	}

	/**
	 * Clear all history
	 */
	async clearHistory(): Promise<void> {
		this.historyData = {
			entries: [],
			lastCleanup: Date.now(),
		};
		await this.saveHistory();
	}
}

// Export singleton instance
export const historyManager = new HistoryManager();
