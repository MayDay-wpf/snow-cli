import {
	existsSync,
	statSync,
	renameSync,
	writeFileSync,
	appendFileSync,
	mkdirSync,
} from 'fs';
import {join, dirname, basename} from 'path';

/**
 * 守护进程专用日志记录器
 * 特点：纯文本输出、自动日志轮转、大小限制、按日期归档
 */
export class DaemonLogger {
	private logFilePath: string;
	private maxLogSize: number; // 最大日志文件大小（字节）
	private maxBackupFiles: number; // 最大备份文件数量

	constructor(
		logFilePath: string,
		maxLogSizeMB: number = 5,
		maxBackupFiles: number = 3,
	) {
		this.logFilePath = logFilePath;
		this.maxLogSize = maxLogSizeMB * 1024 * 1024; // 转换为字节
		this.maxBackupFiles = maxBackupFiles;

		// 确保日志目录存在
		this.ensureLogDirectory();
	}

	/**
	 * 确保日志目录和归档目录存在
	 */
	private ensureLogDirectory(): void {
		const logDir = dirname(this.logFilePath);
		const archiveDir = join(logDir, 'archive');

		if (!existsSync(logDir)) {
			mkdirSync(logDir, {recursive: true});
		}
		if (!existsSync(archiveDir)) {
			mkdirSync(archiveDir, {recursive: true});
		}
	}

	/**
	 * 获取当前日期目录（YYYY-MM-DD格式）
	 */
	private getDateDirectory(): string {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	/**
	 * 写入日志
	 */
	log(message: string, level: 'info' | 'error' | 'success' = 'info'): void {
		// 检查日志文件大小，必要时进行轮转
		this.rotateIfNeeded();

		// 格式化日志消息（纯文本，无ANSI字符）
		const timestamp = new Date().toISOString();
		const levelTag = level.toUpperCase().padEnd(7); // 对齐
		const logLine = `[${timestamp}] [${levelTag}] ${message}\n`;

		try {
			appendFileSync(this.logFilePath, logLine, 'utf-8');
		} catch (error) {
			// 日志写入失败时静默失败，避免影响守护进程运行
			console.error('日志写入失败:', error);
		}
	}

	/**
	 * 检查并执行日志轮转
	 */
	private rotateIfNeeded(): void {
		try {
			// 如果日志文件不存在，无需轮转
			if (!existsSync(this.logFilePath)) {
				return;
			}

			// 检查文件大小
			const stats = statSync(this.logFilePath);
			if (stats.size < this.maxLogSize) {
				return; // 未超过限制，无需轮转
			}

			// 执行日志轮转
			this.rotate();
		} catch (error) {
			// 轮转失败时静默失败
			console.error('日志轮转失败:', error);
		}
	}

	/**
	 * 执行日志轮转
	 * 归档到 archive/YYYY-MM-DD/ 目录下
	 */
	private rotate(): void {
		const logDir = dirname(this.logFilePath);
		const logFileName = basename(this.logFilePath);
		const dateDir = this.getDateDirectory();
		const archiveDateDir = join(logDir, 'archive', dateDir);

		// 确保归档日期目录存在
		if (!existsSync(archiveDateDir)) {
			mkdirSync(archiveDateDir, {recursive: true});
		}

		// 获取归档文件名，添加时间戳避免重复
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const archiveFileName = `${logFileName}.${timestamp}`;
		const archiveFilePath = join(archiveDateDir, archiveFileName);

		try {
			// 将当前日志文件移动到归档目录
			renameSync(this.logFilePath, archiveFilePath);

			// 清理旧归档文件（保留最近 maxBackupFiles 个）
			this.cleanupOldArchives(archiveDateDir, logFileName);
		} catch (error) {
			// 如果重命名失败，直接清空当前日志文件
			try {
				writeFileSync(this.logFilePath, '', 'utf-8');
			} catch {}
		}
	}

	/**
	 * 清理指定日期目录下的旧归档文件
	 */
	private cleanupOldArchives(dateDir: string, baseName: string): void {
		try {
			const {readdirSync} = require('fs');
			const files = readdirSync(dateDir)
				.filter((f: string) => f.startsWith(baseName))
				.map((f: string) => ({
					name: f,
					path: join(dateDir, f),
					stat: statSync(join(dateDir, f)),
				}))
				.sort(
					(a: any, b: any) => b.stat.mtime.getTime() - a.stat.mtime.getTime(),
				);

			// 删除超过限制的旧文件
			if (files.length > this.maxBackupFiles) {
				const filesToDelete = files.slice(this.maxBackupFiles);
				for (const file of filesToDelete) {
					try {
						require('fs').unlinkSync(file.path);
					} catch {}
				}
			}
		} catch (error) {
			// 清理失败时静默失败
		}
	}

	/**
	 * 获取日志文件路径
	 */
	getLogFilePath(): string {
		return this.logFilePath;
	}
}
