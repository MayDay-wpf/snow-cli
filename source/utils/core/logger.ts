import fs from 'node:fs';
import path from 'node:path';
import {getSnowPath} from './snowContext.js';

export enum LogLevel {
	ERROR = 0,
	WARN = 1,
	INFO = 2,
	DEBUG = 3,
}

export type LogLevelName = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export interface StructuredLogEntry {
	timestamp: string; // ISO 8601
	level: LogLevelName;
	namespace: string; // e.g. 'root', 'mcp.catalog', 'session.compressor'
	sessionId?: string;
	taskId?: string;
	traceId?: string;
	spanId?: string;
	parentSpanId?: string;
	durationMs?: number; // 耗时（毫秒），与性能模块及 APM 观测强相关
	message: string;
	meta?: Record<string, unknown>;
	error?: {
		name: string;
		message: string;
		stack?: string;
		code?: string | number;
	};
}

export interface LoggerSink {
	write(entry: StructuredLogEntry): void;
}

/**
 * 内存环形缓冲区 Sink (CircularBufferMemorySink)
 * 用于交互式 TUI 运行环境：保留最近 bufferSize 条结构化日志，
 * 绝不在终端标准输出中直接打印，100% 杜绝 ANSI 控制码击穿终端界面。
 */
export class CircularBufferMemorySink implements LoggerSink {
	private readonly buffer: StructuredLogEntry[] = [];
	private readonly bufferSize: number;

	constructor(bufferSize?: number) {
		if (typeof bufferSize === 'number' && bufferSize > 0) {
			this.bufferSize = bufferSize;
		} else {
			const envVal = process.env['SNOW_LOG_BUFFER_SIZE']
				? parseInt(process.env['SNOW_LOG_BUFFER_SIZE'], 10)
				: NaN;
			this.bufferSize = !Number.isNaN(envVal) && envVal > 0 ? envVal : 1000;
		}
	}

	write(entry: StructuredLogEntry): void {
		if (this.buffer.length >= this.bufferSize) {
			this.buffer.shift();
		}
		this.buffer.push(entry);
	}

	getEntries(): readonly StructuredLogEntry[] {
		return [...this.buffer];
	}

	clear(): void {
		this.buffer.length = 0;
	}
}

export interface LoggerContext {
	namespace?: string;
	sessionId?: string;
	taskId?: string;
	traceId?: string;
	spanId?: string;
	parentSpanId?: string;
}

export interface LoggerConfig {
	logDir?: string;
	maxFileSize?: number;
	dateFormat?: string;
	context?: LoggerContext;
	sink?: LoggerSink | null;
}

export class Logger {
	private readonly logDir: string;
	private readonly maxFileSize: number;
	private readonly context: LoggerContext;
	private sink: LoggerSink | null = null;
	private static sharedSink: LoggerSink | null = null;

	constructor(config: LoggerConfig = {}) {
		this.logDir =
			config.logDir || getSnowPath('log', 'global').native;
		this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 10MB
		this.context = {
			namespace: 'root',
			...config.context,
		};
		if (config.sink !== undefined) {
			this.sink = config.sink;
		}

		this.ensureLogDirectory();
	}

	private ensureLogDirectory(): void {
		if (!this.sink) {
			try {
				if (!fs.existsSync(this.logDir)) {
					fs.mkdirSync(this.logDir, {recursive: true});
				}
			} catch (error) {
				// Best-effort in restricted environments
				void error;
			}
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
		try {
			const stats = fs.statSync(filePath);
			return stats.size >= this.maxFileSize;
		} catch {
			return false;
		}
	}

	private rotateLog(filePath: string): void {
		try {
			const timestamp = Date.now();
			const ext = path.extname(filePath);
			const basename = path.basename(filePath, ext);
			const dirname = path.dirname(filePath);
			const rotatedPath = path.join(dirname, `${basename}-${timestamp}${ext}`);
			fs.renameSync(filePath, rotatedPath);
		} catch (error) {
			// Best-effort rotation
			void error;
		}
	}

	setSink(sink: LoggerSink | null | undefined): void {
		this.sink = sink ?? null;
		Logger.sharedSink = this.sink;
	}

	getSink(): LoggerSink | null {
		return this.sink ?? Logger.sharedSink;
	}

	/**
	 * 创建携带子命名空间或上下文的子 Logger 实例
	 * 例: logger.child('mcp.catalog', { sessionId: 'abc-123' })
	 */
	child(subNamespace: string, context: Partial<LoggerContext> = {}): Logger {
		const parentNs = this.context.namespace;
		const nextNs =
			parentNs && parentNs !== 'root'
				? `${parentNs}.${subNamespace}`
				: subNamespace;

		return new Logger({
			logDir: this.logDir,
			maxFileSize: this.maxFileSize,
			sink: this.sink,
			context: {
				...this.context,
				...context,
				namespace: nextNs,
			},
		});
	}

	private writeLog(
		level: LogLevel,
		message: string,
		metaOrError?: any,
	): void {
		const timestamp = this.formatTimestamp(new Date());
		const levelName = LogLevel[level].toUpperCase() as LogLevelName;

		let errorObj: StructuredLogEntry['error'] | undefined;
		let metaObj: Record<string, unknown> | undefined;

		if (metaOrError instanceof Error) {
			errorObj = {
				name: metaOrError.name,
				message: metaOrError.message,
				stack: metaOrError.stack,
				code: (metaOrError as any).code,
			};
		} else if (metaOrError && typeof metaOrError === 'object') {
			if (metaOrError.error instanceof Error) {
				errorObj = {
					name: metaOrError.error.name,
					message: metaOrError.error.message,
					stack: metaOrError.error.stack,
					code: (metaOrError.error as any).code,
				};
				const {error: _, ...rest} = metaOrError;
				if (Object.keys(rest).length > 0) {
					metaObj = rest;
				}
			} else {
				metaObj = metaOrError;
			}
		}

		let durationMs: number | undefined;
		if (metaObj && typeof metaObj['durationMs'] === 'number') {
			durationMs = metaObj['durationMs'];
			const {durationMs: _, ...rest} = metaObj;
			metaObj = Object.keys(rest).length > 0 ? rest : undefined;
		}

		const entry: StructuredLogEntry = {
			timestamp,
			level: levelName,
			namespace: this.context.namespace || 'root',
			...(this.context.sessionId && {sessionId: this.context.sessionId}),
			...(this.context.taskId && {taskId: this.context.taskId}),
			...(this.context.traceId && {traceId: this.context.traceId}),
			...(this.context.spanId && {spanId: this.context.spanId}),
			...(this.context.parentSpanId && {parentSpanId: this.context.parentSpanId}),
			...(durationMs !== undefined && {durationMs}),
			message,
			...(metaObj && {meta: metaObj}),
			...(errorObj && {error: errorObj}),
		};

		const activeSink = this.sink ?? Logger.sharedSink;
		if (activeSink) {
			activeSink.write(entry);
			return;
		}

		try {
			const logLine = JSON.stringify(entry) + '\n';
			const filePath = this.getLogFilePath(level);

			if (this.shouldRotateLog(filePath)) {
				this.rotateLog(filePath);
			}

			fs.appendFileSync(filePath, logLine, 'utf8');
		} catch (error) {
			// Best-effort file sink without throwing unhandled exceptions
			void error;
		}
	}

	error(message: string, metaOrError?: any): void {
		this.writeLog(LogLevel.ERROR, message, metaOrError);
	}

	warn(message: string, metaOrError?: any): void {
		this.writeLog(LogLevel.WARN, message, metaOrError);
	}

	info(message: string, metaOrError?: any): void {
		this.writeLog(LogLevel.INFO, message, metaOrError);
	}

	debug(message: string, metaOrError?: any): void {
		this.writeLog(LogLevel.DEBUG, message, metaOrError);
	}

	log(level: LogLevel, message: string, metaOrError?: any): void {
		this.writeLog(level, message, metaOrError);
	}

	/**
	 * 启动高精度性能计时器
	 * 用于对慢工具、LLM API、文件 I/O 进行耗时可观测性追踪
	 */
	startTimer(operation: string, initialMeta?: Record<string, unknown>) {
		const start = performance.now();
		return {
			end: (message?: string, meta?: Record<string, unknown>): number => {
				const durationMs = Math.round((performance.now() - start) * 100) / 100;
				this.writeLog(LogLevel.INFO, message || `${operation} completed`, {
					...initialMeta,
					...meta,
					durationMs,
				});
				return durationMs;
			},
			fail: (message: string, errorOrMeta?: any): number => {
				const durationMs = Math.round((performance.now() - start) * 100) / 100;
				if (errorOrMeta instanceof Error) {
					this.writeLog(LogLevel.ERROR, message, {
						error: errorOrMeta,
						...initialMeta,
						durationMs,
					});
				} else {
					this.writeLog(LogLevel.ERROR, message, {
						...initialMeta,
						...errorOrMeta,
						durationMs,
					});
				}
				return durationMs;
			},
		};
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
	setSink(sink: LoggerSink | null | undefined): void {
		getDefaultLogger().setSink(sink);
	},
	getSink(): LoggerSink | null {
		return getDefaultLogger().getSink();
	},
	child(subNamespace: string, context?: Partial<LoggerContext>): Logger {
		return getDefaultLogger().child(subNamespace, context);
	},
	error(message: string, metaOrError?: any): void {
		getDefaultLogger().error(message, metaOrError);
	},
	warn(message: string, metaOrError?: any): void {
		getDefaultLogger().warn(message, metaOrError);
	},
	info(message: string, metaOrError?: any): void {
		getDefaultLogger().info(message, metaOrError);
	},
	debug(message: string, metaOrError?: any): void {
		getDefaultLogger().debug(message, metaOrError);
	},
	log(level: LogLevel, message: string, metaOrError?: any): void {
		getDefaultLogger().log(level, message, metaOrError);
	},
	startTimer(operation: string, initialMeta?: Record<string, unknown>) {
		return getDefaultLogger().startTimer(operation, initialMeta);
	},
};

export default logger;
export {logger};