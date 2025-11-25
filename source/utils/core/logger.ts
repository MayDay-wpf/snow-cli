import fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';

export enum LogLevel {
	ERROR = 0,
	WARN = 1,
	INFO = 2,
	DEBUG = 3,
}

export interface LoggerConfig {
	logDir?: string;
	maxFileSize?: number;
	dateFormat?: string;
}

export class Logger {
	private readonly logDir: string;
	private readonly maxFileSize: number;

	constructor(config: LoggerConfig = {}) {
		this.logDir = config.logDir || path.join(homedir(), '.snow', 'log');
		this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 10MB

		this.ensureLogDirectory();
	}

	private ensureLogDirectory(): void {
		if (!fs.existsSync(this.logDir)) {
			fs.mkdirSync(this.logDir, {recursive: true});
		}
	}

	private formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	private formatTimestamp(date: Date): string {
		return date.toISOString();
	}

	private getLogFilePath(level: LogLevel): string {
		const dateString = this.formatDate(new Date());
		const levelName = LogLevel[level].toLowerCase();
		return path.join(this.logDir, `${dateString}-${levelName}.log`);
	}

	private shouldRotateLog(filePath: string): boolean {
		if (!fs.existsSync(filePath)) {
			return false;
		}

		const stats = fs.statSync(filePath);
		return stats.size >= this.maxFileSize;
	}

	private rotateLog(filePath: string): void {
		const timestamp = Date.now();
		const ext = path.extname(filePath);
		const basename = path.basename(filePath, ext);
		const dirname = path.dirname(filePath);
		const rotatedPath = path.join(dirname, `${basename}-${timestamp}${ext}`);
		
		fs.renameSync(filePath, rotatedPath);
	}

	private writeLog(level: LogLevel, message: string, meta?: any): void {
		const timestamp = this.formatTimestamp(new Date());
		const levelName = LogLevel[level].toUpperCase().padEnd(5);
		const logEntry = {
			timestamp,
			level: levelName.trim(),
			message,
			...(meta && {meta}),
		};

		const logLine = JSON.stringify(logEntry) + '\n';
		const filePath = this.getLogFilePath(level);

		if (this.shouldRotateLog(filePath)) {
			this.rotateLog(filePath);
		}

		fs.appendFileSync(filePath, logLine, 'utf8');
	}

	error(message: string, meta?: any): void {
		this.writeLog(LogLevel.ERROR, message, meta);
	}

	warn(message: string, meta?: any): void {
		this.writeLog(LogLevel.WARN, message, meta);
	}

	info(message: string, meta?: any): void {
		this.writeLog(LogLevel.INFO, message, meta);
	}

	debug(message: string, meta?: any): void {
		this.writeLog(LogLevel.DEBUG, message, meta);
	}

	log(level: LogLevel, message: string, meta?: any): void {
		this.writeLog(level, message, meta);
	}
}

// Lazy initialization to avoid blocking startup
let _defaultLogger: Logger | null = null;

function getDefaultLogger(): Logger {
	if (!_defaultLogger) {
		_defaultLogger = new Logger();
	}
	return _defaultLogger;
}

// Create a proxy object that lazily initializes the logger
const logger = {
	error(message: string, meta?: any): void {
		getDefaultLogger().error(message, meta);
	},
	warn(message: string, meta?: any): void {
		getDefaultLogger().warn(message, meta);
	},
	info(message: string, meta?: any): void {
		getDefaultLogger().info(message, meta);
	},
	debug(message: string, meta?: any): void {
		getDefaultLogger().debug(message, meta);
	},
	log(level: LogLevel, message: string, meta?: any): void {
		getDefaultLogger().log(level, message, meta);
	},
};

export default logger;
export {logger};