import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {logger} from '../core/logger.js';
import {getProjectId} from './projectUtils.js';

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
	// 旧格式的历史数据，只读备用，不会保存到新文件
	private legacyEntries: HistoryEntry[] = [];

	constructor() {
		const snowDir = path.join(os.homedir(), '.snow');
		this.currentProjectId = getProjectId();
		// 新路径: ~/.snow/history/项目名/history.json
		this.historyDir = path.join(snowDir, 'history', this.currentProjectId);
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

	/**
	 * Load history from file
	 * 向后兼容：如果项目级历史不存在，尝试从旧的全局历史加载（只读备用）
	 * 新数据只保存到项目级文件，不会污染旧文件
	 */
	async loadHistory(): Promise<HistoryEntry[]> {
		try {
			await this.ensureSnowDir();

			// 1. 首先尝试读取项目级历史文件（新格式）
			try {
				const data = await fs.readFile(this.historyFile, 'utf-8');
				this.historyData = JSON.parse(data) as HistoryData;

				// Clean up old entries if needed
				await this.cleanupOldEntries();

				return this.historyData.entries;
			} catch (error) {
				// 项目级历史不存在，尝试旧格式作为只读备用
			}

			// 2. 尝试从旧的全局历史文件加载（只读备用，不迁移到新文件）
			const snowDir = path.join(os.homedir(), '.snow');
			const oldHistoryFile = path.join(snowDir, 'history.json');
			try {
				const data = await fs.readFile(oldHistoryFile, 'utf-8');
				const oldData = JSON.parse(data) as HistoryData;

				// 旧数据作为只读备用，不保存到新文件
				this.legacyEntries = oldData.entries;

				logger.debug(
					`Loaded ${this.legacyEntries.length} legacy history entries as read-only backup`,
				);
			} catch (error) {
				// 旧格式也不存在，legacyEntries 保持为空
			}

			// 3. 新文件从空开始，只保存当前项目的新数据
			this.historyData = {
				entries: [],
				lastCleanup: Date.now(),
			};
			return this.legacyEntries;
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
	 * 当新格式文件存在时只返回新数据，否则返回旧数据作为备用
	 */
	async getEntries(): Promise<HistoryEntry[]> {
		if (!this.historyData) {
			await this.loadHistory();
		}

		// 如果新格式有数据，只返回新数据（不合并旧数据）
		if (this.historyData!.entries.length > 0) {
			return [...this.historyData!.entries].reverse();
		}

		// 新格式为空时，返回旧数据作为只读备用
		return [...this.legacyEntries].reverse();
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
