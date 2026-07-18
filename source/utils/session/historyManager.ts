import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {logger} from '../core/logger.js';
import {resolveProjectIdentity} from './projectUtils.js';

export interface HistoryEntry {
	content: string;
	timestamp: number;
}

export interface HistoryData {
	entries: HistoryEntry[];
	lastCleanup: number;
}

/**
 * 历史记录管理器
 * 按项目分类存储历史记录
 * 路径结构: ~/.snow/history/项目名/history.json
 */
class HistoryManager {
	private readonly historyDir: string;
	private readonly historyFile: string;
	private readonly maxAge = 24 * 60 * 60 * 1000; // 1 day in milliseconds
	private readonly maxEntries = 1000; // Maximum number of entries to keep
	private historyData: HistoryData | null = null;
	private readonly currentProjectId: string;
	private readonly historyRootDir: string;
	private readonly projectAliasIds: string[];

	constructor() {
		const snowDir = path.join(os.homedir(), '.snow');
		const identity = resolveProjectIdentity();
		this.currentProjectId = identity.projectId;
		this.projectAliasIds = identity.projectAliasIds;
		this.historyRootDir = path.join(snowDir, 'history');
		// 新路径: ~/.snow/history/稳定项目名/history.json
		this.historyDir = path.join(this.historyRootDir, this.currentProjectId);
		this.historyFile = path.join(this.historyDir, 'history.json');
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

	private getHistoryFilesToRead(): string[] {
		const files = new Set<string>();
		files.add(this.historyFile);

		for (const projectId of this.projectAliasIds) {
			files.add(path.join(this.historyRootDir, projectId, 'history.json'));
		}

		files.add(path.join(os.homedir(), '.snow', 'history.json'));
		return [...files];
	}

	private async readHistoryFile(filePath: string): Promise<HistoryData | null> {
		try {
			const data = await fs.readFile(filePath, 'utf-8');
			const parsed = JSON.parse(data) as HistoryData;
			return {
				entries: Array.isArray(parsed.entries) ? parsed.entries : [],
				lastCleanup: parsed.lastCleanup || Date.now(),
			};
		} catch {
			return null;
		}
	}

	private mergeHistoryEntries(entries: HistoryEntry[]): HistoryEntry[] {
		const seen = new Set<string>();
		const merged: HistoryEntry[] = [];

		for (const entry of entries.sort((a, b) => a.timestamp - b.timestamp)) {
			if (!entry.content || !entry.timestamp) {
				continue;
			}

			const key = `${entry.timestamp}:${entry.content}`;
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			merged.push(entry);
		}

		return merged.slice(-this.maxEntries);
	}

	/**
	 * Load history from file
	 * 向后兼容：自动合并稳定项目目录、旧路径项目目录和旧全局历史。
	 * 新数据只保存到稳定项目级文件，不会污染旧文件。
	 */
	async loadHistory(): Promise<HistoryEntry[]> {
		try {
			await this.ensureSnowDir();

			const allEntries: HistoryEntry[] = [];
			let newestLastCleanup = 0;
			let legacyCount = 0;

			for (const historyFile of this.getHistoryFilesToRead()) {
				const data = await this.readHistoryFile(historyFile);
				if (!data) {
					continue;
				}

				allEntries.push(...data.entries);
				newestLastCleanup = Math.max(newestLastCleanup, data.lastCleanup || 0);
				if (historyFile !== this.historyFile) {
					legacyCount += data.entries.length;
				}
			}

			this.historyData = {
				entries: this.mergeHistoryEntries(allEntries),
				lastCleanup: newestLastCleanup || Date.now(),
			};

			if (legacyCount > 0) {
				logger.debug(
					`Loaded ${legacyCount} legacy or moved-project history entries as read-only backup`,
				);
			}

			await this.cleanupOldEntries();
			return this.historyData.entries;
		} catch (error) {
			// Unexpected error, start fresh
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
		const lastEntry =
			this.historyData!.entries[this.historyData!.entries.length - 1];
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
			this.historyData!.entries = this.historyData!.entries.slice(
				-this.maxEntries,
			);
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
				`Cleaned up ${
					originalLength - this.historyData.entries.length
				} old history entries`,
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
