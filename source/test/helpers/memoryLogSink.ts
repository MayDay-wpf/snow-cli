import type {LogLevel} from '../../utils/core/logger.js';

export interface CapturedLogEntry {
	level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
	message: string;
	meta?: any;
	timestamp: string;
}

export interface LoggerSink {
	write(entry: CapturedLogEntry): void;
}

/**
 * 内存日志接收器：在测试沙箱中截流所有日志输出，提供零 IO、无竞态的断言能力。
 */
export class MemoryLogSink implements LoggerSink {
	private readonly entries: CapturedLogEntry[] = [];

	write(entry: CapturedLogEntry): void {
		this.entries.push(entry);
	}

	getEntries(): readonly CapturedLogEntry[] {
		return [...this.entries];
	}

	getMessages(level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'): string[] {
		return this.entries
			.filter(e => (level ? e.level === level : true))
			.map(e => e.message);
	}

	hasMessage(pattern: string | RegExp, level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'): boolean {
		const msgs = this.getMessages(level);
		return msgs.some(msg =>
			typeof pattern === 'string' ? msg.includes(pattern) : pattern.test(msg),
		);
	}

	clear(): void {
		this.entries.length = 0;
	}
}
