import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {randomUUID} from 'crypto';
import type {ChatMessage as APIChatMessage} from '../../api/chat.js';
import {getTodoService} from '../execution/mcpToolsManager.js';
import {logger} from '../core/logger.js';
import {summaryAgent} from '../../agents/summaryAgent.js';
// Session 中直接使用 API 的消息格式,额外添加 timestamp 用于会话管理
export interface ChatMessage extends APIChatMessage {
	timestamp: number;
	// 存储用户的原始消息(在提示词优化之前),仅用于显示,不影响API请求
	originalContent?: string;
}

export interface Session {
	id: string;
	title: string;
	summary: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
	messageCount: number;
	isTemporary?: boolean; // Temporary sessions are not shown in resume list
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

	constructor() {
		this.sessionsDir = path.join(os.homedir(), '.snow', 'sessions');
	}

	private async ensureSessionsDir(date?: Date): Promise<void> {
		try {
			await fs.mkdir(this.sessionsDir, {recursive: true});

			if (date) {
				const dateFolder = this.formatDateForFolder(date);
				const sessionDir = path.join(this.sessionsDir, dateFolder);
				await fs.mkdir(sessionDir, {recursive: true});
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

	async createNewSession(isTemporary = false): Promise<Session> {
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
			isTemporary,
		};

		this.currentSession = session;

		// Don't save temporary sessions to disk
		if (!isTemporary) {
			await this.saveSession(session);
		}

		// 🔥 新增：自动创建空TODO
		await this.createEmptyTodoForSession(sessionId);

		return session;
	}

	/**
	 * 为会话创建空TODO列表
	 */
	private async createEmptyTodoForSession(sessionId: string): Promise<void> {
		try {
			const todoService = getTodoService();
			await todoService.createEmptyTodo(sessionId);
		} catch (error) {
			// TODO创建失败不应该影响会话创建，记录日志即可
			logger.warn('Failed to create empty TODO for session:', {
				sessionId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async saveSession(session: Session): Promise<void> {
		// Don't save temporary sessions to disk
		if (session.isTemporary) {
			return;
		}

		const sessionDate = new Date(session.createdAt);
		await this.ensureSessionsDir(sessionDate);
		const sessionPath = this.getSessionPath(session.id, sessionDate);
		await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
	}

	lastLoadHookError?: {
		type: 'warning' | 'error';
		exitCode: number;
		command: string;
		output?: string;
		error?: string;
	};
	lastLoadHookWarning?: string;

	async loadSession(sessionId: string): Promise<Session | null> {
		// Clear previous error and warning
		this.lastLoadHookError = undefined;
		this.lastLoadHookWarning = undefined;

		// 首先尝试从旧格式加载（向下兼容）
		try {
			const oldSessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
			const data = await fs.readFile(oldSessionPath, 'utf-8');
			const session: Session = JSON.parse(data);

			// Execute onSessionStart hook before setting current session
			const hookResult = await this.executeSessionStartHook(session.messages);
			if (!hookResult.shouldContinue) {
				// Hook failed, store error details and abort loading
				this.lastLoadHookError = hookResult.errorDetails;
				return null;
			}
			// Store warning if exists
			if (hookResult.warningMessage) {
				this.lastLoadHookWarning = hookResult.warningMessage;
			}

			this.currentSession = session;
			return session;
		} catch (error) {
			// 旧格式不存在，搜索日期文件夹
		}

		// 在日期文件夹中查找会话
		try {
			const session = await this.findSessionInDateFolders(sessionId);
			if (session) {
				// Execute onSessionStart hook before setting current session
				const hookResult = await this.executeSessionStartHook(session.messages);
				if (!hookResult.shouldContinue) {
					// Hook failed, store error details and abort loading
					this.lastLoadHookError = hookResult.errorDetails;
					return null;
				}
				// Store warning if exists
				if (hookResult.warningMessage) {
					this.lastLoadHookWarning = hookResult.warningMessage;
				}
				// Set as current session before returning
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

		// Generate simple title and summary from first user message
		if (this.currentSession.messageCount === 1 && message.role === 'user') {
			// Use first 50 chars as title, first 100 chars as summary
			const title =
				message.content.slice(0, 50) +
				(message.content.length > 50 ? '...' : '');
			const summary =
				message.content.slice(0, 100) +
				(message.content.length > 100 ? '...' : '');

			this.currentSession.title = this.cleanTitle(title);
			this.currentSession.summary = this.cleanTitle(summary);
		}

		// After the first complete conversation exchange (user + assistant), generate AI summary
		// Only run once when messageCount becomes 2 and the second message is from assistant
		if (
			this.currentSession.messageCount === 2 &&
			message.role === 'assistant'
		) {
			// Run summary generation in background without blocking
			this.generateAndUpdateSummary().catch(error => {
				logger.error('Failed to generate conversation summary:', error);
			});
		}

		await this.saveSession(this.currentSession);
	}

	/**
	 * Generate AI-powered summary for the first conversation exchange
	 * This runs in the background without blocking the main flow
	 */
	private async generateAndUpdateSummary(): Promise<void> {
		if (!this.currentSession || this.currentSession.messages.length < 2) {
			return;
		}

		try {
			// Extract first user and assistant messages
			const firstUserMessage = this.currentSession.messages.find(
				m => m.role === 'user',
			);
			const firstAssistantMessage = this.currentSession.messages.find(
				m => m.role === 'assistant',
			);

			if (!firstUserMessage || !firstAssistantMessage) {
				logger.warn(
					'Summary agent: Could not find first user/assistant messages',
				);
				return;
			}

			// Generate summary using summary agent
			const result = await summaryAgent.generateSummary(
				firstUserMessage.content,
				firstAssistantMessage.content,
			);

			if (result) {
				// Update session with generated summary
				this.currentSession.title = result.title;
				this.currentSession.summary = result.summary;

				// Save updated session
				await this.saveSession(this.currentSession);

				logger.info('Summary agent: Successfully updated session summary', {
					sessionId: this.currentSession.id,
					title: result.title,
					summary: result.summary,
				});
			}
		} catch (error) {
			// Silently fail - don't disrupt main conversation flow
			logger.error('Summary agent: Failed to generate summary', error);
		}
	}

	getCurrentSession(): Session | null {
		return this.currentSession;
	}

	setCurrentSession(session: Session): void {
		this.currentSession = session;
	}

	clearCurrentSession(): void {
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

	/**
	 * Execute onSessionStart hook
	 * @param messages - Chat messages from the session (empty array for new sessions)
	 * @returns {shouldContinue: boolean, errorDetails?: HookErrorDetails}
	 */
	private async executeSessionStartHook(messages: ChatMessage[]): Promise<{
		shouldContinue: boolean;
		errorDetails?: {
			type: 'warning' | 'error';
			exitCode: number;
			command: string;
			output?: string;
			error?: string;
		};
		warningMessage?: string;
	}> {
		try {
			const {unifiedHooksExecutor} = await import(
				'../execution/unifiedHooksExecutor.js'
			);

			// Execute hook with messages passed via stdin
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'onSessionStart',
				{
					messages,
					messageCount: messages.length,
				},
			);

			// onSessionStart only uses command type hooks
			// exitCode 0: continue normally
			// exitCode 1: warning (log to console)
			// exitCode >= 2: critical error (return error details for UI display)

			// Check for command hook failures
			if (!hookResult.success) {
				const commandError = hookResult.results.find(
					r => r.type === 'command' && !r.success,
				);

				if (commandError && commandError.type === 'command') {
					const {exitCode, command, output, error} = commandError;
					const combinedOutput =
						[output, error].filter(Boolean).join('\n\n') || '(no output)';

					if (exitCode === 1) {
						// Warning - continue
						const warningMsg = `[WARN] onSessionStart hook warning:\nCommand: ${command}\nOutput: ${combinedOutput}`;
						logger.warn(warningMsg);
						return {shouldContinue: true, warningMessage: warningMsg};
					} else if (exitCode >= 2 || exitCode < 0) {
						// Critical error - return error details for UI display
						logger.error(
							`onSessionStart hook failed (exitCode=${exitCode}):\nCommand: ${command}\nOutput: ${combinedOutput}`,
						);
						return {
							shouldContinue: false,
							errorDetails: {
								type: 'error',
								exitCode,
								command,
								output,
								error,
							},
						};
					}
				}
			}
			return {shouldContinue: true};
		} catch (error) {
			logger.error('Failed to execute onSessionStart hook:', error);
			return {shouldContinue: true}; // On exception, continue
		}
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
