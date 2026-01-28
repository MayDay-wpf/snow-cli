import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {logger} from '../core/logger.js';

/**
 * 命令使用频率数据结构
 */
export interface CommandUsageData {
	/** 命令使用次数映射 {commandName: count} */
	usage: Record<string, number>;
	/** 最后更新时间 */
	lastUpdated: number;
}

/**
 * 命令使用频率管理器
 * 全局存储，路径: ~/.snow/command-usage.json
 *
 * 设计原则：
 * - 简单数据结构：只记录使用次数，不搞复杂的时间衰减
 * - 内存缓存 + 延迟写入：避免频繁 IO
 * - 向后兼容：没有记录时返回 0
 */
class CommandUsageManager {
	private readonly usageFile: string;
	private usageData: CommandUsageData | null = null;
	private isDirty = false;
	private saveTimer: NodeJS.Timeout | null = null;
	private readonly saveDelay = 1000; // 1秒延迟写入

	constructor() {
		const snowDir = path.join(os.homedir(), '.snow');
		this.usageFile = path.join(snowDir, 'command-usage.json');
	}

	/**
	 * 确保 .snow 目录存在
	 */
	private async ensureSnowDir(): Promise<void> {
		try {
			const snowDir = path.dirname(this.usageFile);
			await fs.mkdir(snowDir, {recursive: true});
		} catch {
			// 目录已存在或其他错误
		}
	}

	/**
	 * 加载使用频率数据
	 */
	private async loadUsage(): Promise<void> {
		if (this.usageData) return;

		try {
			await this.ensureSnowDir();
			const data = await fs.readFile(this.usageFile, 'utf-8');
			this.usageData = JSON.parse(data) as CommandUsageData;
		} catch {
			// 文件不存在或解析错误，初始化空数据
			this.usageData = {
				usage: {},
				lastUpdated: Date.now(),
			};
		}
	}

	/**
	 * 保存使用频率数据（延迟写入）
	 */
	private scheduleSave(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
		}

		this.saveTimer = setTimeout(async () => {
			await this.saveUsage();
		}, this.saveDelay);
	}

	/**
	 * 立即保存使用频率数据
	 */
	private async saveUsage(): Promise<void> {
		if (!this.usageData || !this.isDirty) return;

		try {
			await this.ensureSnowDir();
			this.usageData.lastUpdated = Date.now();
			await fs.writeFile(
				this.usageFile,
				JSON.stringify(this.usageData, null, 2),
				'utf-8',
			);
			this.isDirty = false;
		} catch (error) {
			logger.error('Failed to save command usage:', error);
		}
	}

	/**
	 * 记录命令使用
	 * @param commandName 命令名称
	 */
	async recordUsage(commandName: string): Promise<void> {
		await this.loadUsage();

		if (!this.usageData) return;

		// 增加使用次数
		this.usageData.usage[commandName] =
			(this.usageData.usage[commandName] || 0) + 1;

		this.isDirty = true;
		this.scheduleSave();
	}

	/**
	 * 获取命令使用次数
	 * @param commandName 命令名称
	 * @returns 使用次数，未使用过返回 0
	 */
	async getUsageCount(commandName: string): Promise<number> {
		await this.loadUsage();
		return this.usageData?.usage[commandName] || 0;
	}

	/**
	 * 获取所有命令的使用次数（同步版本，用于排序）
	 * 注意：必须先调用 loadUsage() 确保数据已加载
	 */
	getUsageCountSync(commandName: string): number {
		return this.usageData?.usage[commandName] || 0;
	}

	/**
	 * 确保数据已加载（供 hook 初始化时调用）
	 */
	async ensureLoaded(): Promise<void> {
		await this.loadUsage();
	}

	/**
	 * 获取所有使用记录（用于调试）
	 */
	async getAllUsage(): Promise<Record<string, number>> {
		await this.loadUsage();
		return {...(this.usageData?.usage || {})};
	}

	/**
	 * 清空使用记录
	 */
	async clearUsage(): Promise<void> {
		this.usageData = {
			usage: {},
			lastUpdated: Date.now(),
		};
		this.isDirty = true;
		await this.saveUsage();
	}

	/**
	 * 清理资源，确保数据被保存
	 * 在应用退出前调用
	 */
	async dispose(): Promise<void> {
		// 清除定时器
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		// 立即保存未保存的数据
		if (this.isDirty) {
			await this.saveUsage();
		}
	}
}

// 导出单例实例
export const commandUsageManager = new CommandUsageManager();

// 注册进程退出钩子，确保数据被保存
// 注意：SIGINT 处理在 cli.tsx 中统一管理，避免重复处理
process.on('beforeExit', async () => {
	await commandUsageManager.dispose();
});
