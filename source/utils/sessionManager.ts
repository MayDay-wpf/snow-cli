import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type { ChatMessage as APIChatMessage } from '../api/chat.js';
import { summaryAgent } from '../agents/summaryAgent.js';
import { getTodoService } from './mcpToolsManager.js';
import { logger } from './logger.js';

// Session 中直接使用 API 的消息格式，额外添加 timestamp 用于会话管理
export interface ChatMessage extends APIChatMessage {
	timestamp: number;
}

export interface Session {
	id: string;
	title: string;
	summary: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
	messageCount: number;
}

export interface SessionListItem {
	id: string;
	title: string;
	summary: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

class SessionManager {
	private readonly sessionsDir: string;
	private currentSession: Session | null = null;
	private summaryAbortController: AbortController | null = null;
	private summaryTimeoutId: NodeJS.Timeout | null = null;

	constructor() {
		this.sessionsDir = path.join(os.homedir(), '.snow', 'sessions');
	}

	private async ensureSessionsDir(date?: Date): Promise<void> {
		try {
			await fs.mkdir(this.sessionsDir, { recursive: true });

			if (date) {
				const dateFolder = this.formatDateForFolder(date);
				const sessionDir = path.join(this.sessionsDir, dateFolder);
				await fs.mkdir(sessionDir, { recursive: true });
			}
		} catch (error) {
			// Directory already exists or other error
		}
	}
	private getSessionPath(sessionId: string, date?: Date): string {
		const sessionDate = date || new Date();
		const dateFolder = this.formatDateForFolder(sessionDate);
		const sessionDir = path.join(this.sessionsDir, dateFolder);
		return path.join(sessionDir, `${sessionId}.json`);
	}

	private formatDateForFolder(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	/**
	 * Clean title by removing newlines and extra spaces
	 */
	private cleanTitle(title: string): string {
		return title
			.replace(/[\r\n]+/g, ' ') // Replace newlines with space
			.replace(/\s+/g, ' ') // Replace multiple spaces with single space
			.trim(); // Remove leading/trailing spaces
	}

	/**
	 * Cancel any ongoing summary generation
	 * This prevents wasted resources and race conditions
	 */
	private cancelOngoingSummaryGeneration(): void {
		if (this.summaryAbortController) {
			this.summaryAbortController.abort();
			this.summaryAbortController = null;
		}
		if (this.summaryTimeoutId) {
			clearTimeout(this.summaryTimeoutId);
			this.summaryTimeoutId = null;
		}
	}

	async createNewSession(): Promise<Session> {
		await this.ensureSessionsDir(new Date());

		// 使用 UUID v4 生成唯一会话 ID，避免并发冲突
		const sessionId = randomUUID();
		const session: Session = {
			id: sessionId,
			title: 'New Chat',
			summary: '',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
			messageCount: 0,
		};

		this.currentSession = session;
		await this.saveSession(session);
		return session;
	}

	async saveSession(session: Session): Promise<void> {
		const sessionDate = new Date(session.createdAt);
		await this.ensureSessionsDir(sessionDate);
		const sessionPath = this.getSessionPath(session.id, sessionDate);
		await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
	}

	async loadSession(sessionId: string): Promise<Session | null> {
		// 首先尝试从旧格式加载（向下兼容）
		try {
			const oldSessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
			const data = await fs.readFile(oldSessionPath, 'utf-8');
			const session: Session = JSON.parse(data);
			this.currentSession = session;
			return session;
		} catch (error) {
			// 旧格式不存在，搜索日期文件夹
		}

		// 在日期文件夹中查找会话
		try {
			const session = await this.findSessionInDateFolders(sessionId);
			if (session) {
				this.currentSession = session;
				return session;
			}
		} catch (error) {
			// 搜索失败
		}

		return null;
	}

	private async findSessionInDateFolders(
		sessionId: string,
	): Promise<Session | null> {
		try {
			const files = await fs.readdir(this.sessionsDir);

			for (const file of files) {
				const filePath = path.join(this.sessionsDir, file);
				const stat = await fs.stat(filePath);

				if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(file)) {
					// 这是日期文件夹，查找会话文件
					const sessionPath = path.join(filePath, `${sessionId}.json`);
					try {
						const data = await fs.readFile(sessionPath, 'utf-8');
						const session: Session = JSON.parse(data);
						return session;
					} catch (error) {
						// 文件不存在或读取失败，继续搜索
						continue;
					}
				}
			}
		} catch (error) {
			// 目录读取失败
		}

		return null;
	}

	async listSessions(): Promise<SessionListItem[]> {
		await this.ensureSessionsDir();
		const sessions: SessionListItem[] = [];

		try {
			// 首先处理新的日期文件夹结构
			const files = await fs.readdir(this.sessionsDir);

			for (const file of files) {
				const filePath = path.join(this.sessionsDir, file);
				const stat = await fs.stat(filePath);

				if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(file)) {
					// 这是日期文件夹，读取其中的会话文件
					await this.readSessionsFromDir(filePath, sessions);
				} else if (file.endsWith('.json')) {
					// 这是旧格式的会话文件（向下兼容）
					try {
						const data = await fs.readFile(filePath, 'utf-8');
						const session: Session = JSON.parse(data);

						sessions.push({
							id: session.id,
							title: this.cleanTitle(session.title),
							summary: session.summary,
							createdAt: session.createdAt,
							updatedAt: session.updatedAt,
							messageCount: session.messageCount,
						});
					} catch (error) {
						// Skip invalid session files
						continue;
					}
				}
			}

			// Sort by updatedAt (newest first)
			return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
		} catch (error) {
			return [];
		}
	}

	private async readSessionsFromDir(
		dirPath: string,
		sessions: SessionListItem[],
	): Promise<void> {
		try {
			const files = await fs.readdir(dirPath);

			for (const file of files) {
				if (file.endsWith('.json')) {
					try {
						const sessionPath = path.join(dirPath, file);
						const data = await fs.readFile(sessionPath, 'utf-8');
						const session: Session = JSON.parse(data);

						sessions.push({
							id: session.id,
							title: this.cleanTitle(session.title),
							summary: session.summary,
							createdAt: session.createdAt,
							updatedAt: session.updatedAt,
							messageCount: session.messageCount,
						});
					} catch (error) {
						// Skip invalid session files
						continue;
					}
				}
			}
		} catch (error) {
			// Skip directory if it can't be read
		}
	}

	async addMessage(message: ChatMessage): Promise<void> {
		if (!this.currentSession) {
			this.currentSession = await this.createNewSession();
		}

		// Check if this exact message already exists to prevent duplicates
		// For assistant messages with tool_calls, also compare tool_call_id to ensure uniqueness
		const existingMessage = this.currentSession.messages.find(m => {
			if (m.role !== message.role) return false;
			if (m.content !== message.content) return false;
			if (Math.abs(m.timestamp - message.timestamp) >= 5000) return false;

			// If both messages have tool_calls, compare tool call IDs
			if (m.tool_calls && message.tool_calls) {
				// Create sets of tool call IDs for comparison
				const existingIds = new Set(m.tool_calls.map(tc => tc.id));
				const newIds = new Set(message.tool_calls.map(tc => tc.id));

				// If IDs are different, these are different messages
				if (existingIds.size !== newIds.size) return false;
				for (const id of newIds) {
					if (!existingIds.has(id)) return false;
				}
			} else if (m.tool_calls || message.tool_calls) {
				// One has tool_calls, the other doesn't - different messages
				return false;
			}

			// If both have tool_call_id (tool response), compare them
			if (m.tool_call_id && message.tool_call_id) {
				return m.tool_call_id === message.tool_call_id;
			} else if (m.tool_call_id || message.tool_call_id) {
				// One has tool_call_id, the other doesn't - different messages
				return false;
			}

			return true;
		});

		if (existingMessage) {
			return; // Don't add duplicate message
		}

		this.currentSession.messages.push(message);
		this.currentSession.messageCount = this.currentSession.messages.length;
		this.currentSession.updatedAt = Date.now();

		// Generate summary from first user message using summaryAgent (parallel, non-blocking)
		if (this.currentSession.messageCount === 1 && message.role === 'user') {
			// Set temporary title immediately (synchronous)
			this.currentSession.title = message.content.slice(0, 50);
			this.currentSession.summary = message.content.slice(0, 100);

			// Cancel any previous summary generation (防呆机制)
			this.cancelOngoingSummaryGeneration();

			// Create new AbortController for this summary generation
			this.summaryAbortController = new AbortController();
			const currentSessionId = this.currentSession.id;
			const abortSignal = this.summaryAbortController.signal;

			// Set timeout to cancel summary generation after 30 seconds (防呆机制)
			this.summaryTimeoutId = setTimeout(() => {
				if (this.summaryAbortController) {
					logger.warn('Summary generation timeout after 30s, aborting...');
					this.summaryAbortController.abort();
					this.summaryAbortController = null;
				}
			}, 30000);

			// Generate better summary in parallel (non-blocking)
			// This won't delay the main conversation flow
			summaryAgent
				.generateSummary(message.content, abortSignal)
				.then(summary => {
					// 防呆检查：确保会话没有被切换，且仍然是第一条消息
					if (
						this.currentSession &&
						this.currentSession.id === currentSessionId &&
						this.currentSession.messageCount === 1
					) {
						// Only update if this is still the first message in the same session
						this.currentSession.title = summary;
						this.currentSession.summary = summary;
						this.saveSession(this.currentSession).catch(error => {
							logger.error(
								'Failed to save session with generated summary:',
								error,
							);
						});
					}
					// Clean up
					this.cancelOngoingSummaryGeneration();
				})
				.catch(error => {
					// Clean up on error
					this.cancelOngoingSummaryGeneration();

					// Silently fail if aborted (expected behavior)
					if (error.name === 'AbortError' || abortSignal.aborted) {
						logger.warn('Summary generation cancelled (expected)');
						return;
					}

					// Log other errors - we already have a fallback title/summary
					logger.warn('Using fallback title/summary:' + error);
				});
		} else if (this.currentSession.messageCount > 1) {
			// 防呆机制：如果不是第一条消息，取消任何正在进行的摘要生成
			this.cancelOngoingSummaryGeneration();
		}

		await this.saveSession(this.currentSession);
	}

	getCurrentSession(): Session | null {
		return this.currentSession;
	}

	setCurrentSession(session: Session): void {
		// 防呆机制：切换会话时取消正在进行的摘要生成
		this.cancelOngoingSummaryGeneration();
		this.currentSession = session;
	}

	clearCurrentSession(): void {
		// 防呆机制：清除会话时取消正在进行的摘要生成
		this.cancelOngoingSummaryGeneration();
		this.currentSession = null;
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		let sessionDeleted = false;

		// 首先尝试删除旧格式（向下兼容）
		try {
			const oldSessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
			await fs.unlink(oldSessionPath);
			sessionDeleted = true;
		} catch (error) {
			// 旧格式不存在，搜索日期文件夹
		}

		// 在日期文件夹中查找并删除会话
		if (!sessionDeleted) {
			try {
				const files = await fs.readdir(this.sessionsDir);

				for (const file of files) {
					const filePath = path.join(this.sessionsDir, file);
					const stat = await fs.stat(filePath);

					if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(file)) {
						// 这是日期文件夹，查找会话文件
						const sessionPath = path.join(filePath, `${sessionId}.json`);
						try {
							await fs.unlink(sessionPath);
							sessionDeleted = true;
							break;
						} catch (error) {
							// 文件不存在，继续搜索
							continue;
						}
					}
				}
			} catch (error) {
				// 目录读取失败
			}
		}

		// 如果会话删除成功，同时删除对应的TODO列表
		if (sessionDeleted) {
			try {
				const todoService = getTodoService();
				await todoService.deleteTodoList(sessionId);
			} catch (error) {
				// TODO删除失败不影响会话删除结果
				logger.warn(
					`Failed to delete TODO list for session ${sessionId}:`,
					error,
				);
			}
		}

		return sessionDeleted;
	}

	async truncateMessages(messageCount: number): Promise<void> {
		if (!this.currentSession) {
			return;
		}

		// Truncate messages array to specified count
		this.currentSession.messages = this.currentSession.messages.slice(
			0,
			messageCount,
		);
		this.currentSession.messageCount = this.currentSession.messages.length;
		this.currentSession.updatedAt = Date.now();

		await this.saveSession(this.currentSession);
	}
}

export const sessionManager = new SessionManager();
