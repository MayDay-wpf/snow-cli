import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {randomUUID} from 'crypto';
import type {ChatMessage as APIChatMessage} from '../../api/chat.js';
import {getTodoService} from '../execution/mcpToolsManager.js';
import {logger} from '../core/logger.js';
import {summaryAgent} from '../../agents/summaryAgent.js';
import {
	getProjectId,
	getProjectPath,
	formatDateCompact,
	isDateFolder,
	isProjectFolder,
} from './projectUtils.js';
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
	projectPath?: string; // 项目路径，用于区分不同项目的会话
	projectId?: string; // 项目ID（项目名-哈希），用于存储分类
	compressedFrom?: string; // 如果是压缩产生的会话，记录来源会话ID
	compressedAt?: number; // 压缩时间戳
	originalMessageIndex?: number; // 压缩点在原会话中的消息索引
}

export interface SessionListItem {
	id: string;
	title: string;
	summary: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	projectPath?: string; // 项目路径
	projectId?: string; // 项目ID
	compressedFrom?: string; // 如果是压缩产生的会话，记录来源会话ID
	compressedAt?: number; // 压缩时间戳
}

export interface PaginatedSessionList {
	sessions: SessionListItem[];
	total: number;
	hasMore: boolean;
}

class SessionManager {
	private readonly sessionsDir: string;
	private currentSession: Session | null = null;
	private readonly currentProjectId: string;
	private readonly currentProjectPath: string;
	// 会话列表缓存
	private sessionListCache: SessionListItem[] | null = null;
	private cacheTimestamp: number = 0;
	private readonly CACHE_TTL = 5000; // 缓存有效期 5 秒

	constructor() {
		this.sessionsDir = path.join(os.homedir(), '.snow', 'sessions');
		this.currentProjectId = getProjectId();
		this.currentProjectPath = getProjectPath();
	}

	/**
	 * 获取当前项目的会话目录
	 * 路径结构: ~/.snow/sessions/项目名/YYYYMMDD/
	 */
	private getProjectSessionsDir(): string {
		return path.join(this.sessionsDir, this.currentProjectId);
	}

	private async ensureSessionsDir(date?: Date): Promise<void> {
		try {
			// 确保基础目录存在
			await fs.mkdir(this.sessionsDir, {recursive: true});

			// 确保项目目录存在
			const projectDir = this.getProjectSessionsDir();
			await fs.mkdir(projectDir, {recursive: true});

			if (date) {
				const dateFolder = formatDateCompact(date);
				const sessionDir = path.join(projectDir, dateFolder);
				await fs.mkdir(sessionDir, {recursive: true});
			}
		} catch (error) {
			// Directory already exists or other error
		}
	}

	/**
	 * 获取会话文件路径
	 * 新路径结构: ~/.snow/sessions/项目名/YYYYMMDD/UUID.json
	 */
	private getSessionPath(
		sessionId: string,
		date?: Date,
		projectId?: string,
	): string {
		const sessionDate = date || new Date();
		const dateFolder = formatDateCompact(sessionDate);
		const targetProjectId = projectId || this.currentProjectId;
		const sessionDir = path.join(this.sessionsDir, targetProjectId, dateFolder);
		return path.join(sessionDir, `${sessionId}.json`);
	}

	/**
	 * 获取当前项目ID
	 */
	getProjectId(): string {
		return this.currentProjectId;
	}

	/**
	 * 获取当前项目路径
	 */
	getProjectPath(): string {
		return this.currentProjectPath;
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

	async createNewSession(
		isTemporary = false,
		skipEmptyTodo = false,
	): Promise<Session> {
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
			projectPath: this.currentProjectPath, // 记录项目路径
			projectId: this.currentProjectId, // 记录项目ID
		};

		this.currentSession = session;

		// Don't save temporary sessions to disk
		if (!isTemporary) {
			await this.saveSession(session);
		}

		// 自动创建空TODO（压缩流程会跳过，因为需要继承原会话的TODO）
		if (!skipEmptyTodo) {
			await this.createEmptyTodoForSession(sessionId);
		}

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

		// 确保会话有项目信息（向后兼容：补充旧会话的项目信息）
		if (!session.projectId) {
			session.projectId = this.currentProjectId;
			session.projectPath = this.currentProjectPath;
		}

		const sessionDate = new Date(session.createdAt);
		await this.ensureSessionsDir(sessionDate);
		const sessionPath = this.getSessionPath(
			session.id,
			sessionDate,
			session.projectId,
		);
		await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));

		// 保存会话后使缓存失效
		this.invalidateCache();
	}

	/**
	 * 清理未完成的 tool_calls
	 * 如果最后一条 assistant 消息有 tool_calls，但后续没有对应的 tool results，则删除该消息
	 * 这种情况通常发生在用户强制退出（Ctrl+C）时
	 */
	private cleanIncompleteToolCalls(session: Session): void {
		if (!session.messages || session.messages.length === 0) {
			return;
		}

		// 从后往前查找最后一条 assistant 消息及其 tool_calls
		let lastAssistantWithToolCallsIndex = -1;
		let toolCallIds: string[] = [];

		for (let i = session.messages.length - 1; i >= 0; i--) {
			const msg = session.messages[i];
			if (
				msg &&
				msg.role === 'assistant' &&
				msg.tool_calls &&
				msg.tool_calls.length > 0
			) {
				lastAssistantWithToolCallsIndex = i;
				toolCallIds = msg.tool_calls.map(tc => tc.id);
				break;
			}
		}

		// 如果没有找到带 tool_calls 的 assistant 消息，不需要清理
		if (lastAssistantWithToolCallsIndex === -1) {
			return;
		}

		// 检查这些 tool_calls 是否都有对应的 tool results
		const toolResultIds = new Set<string>();
		for (
			let i = lastAssistantWithToolCallsIndex + 1;
			i < session.messages.length;
			i++
		) {
			const msg = session.messages[i];
			if (msg && msg.role === 'tool' && msg.tool_call_id) {
				toolResultIds.add(msg.tool_call_id);
			}
		}

		// 检查是否所有 tool_calls 都有对应的 results
		const hasIncompleteToolCalls = toolCallIds.some(
			id => !toolResultIds.has(id),
		);

		if (hasIncompleteToolCalls) {
			// 存在未完成的 tool_calls，需要删除该 assistant 消息及其之后的所有消息
			logger.warn('Detected incomplete tool_calls, cleaning up session', {
				sessionId: session.id,
				removingFromIndex: lastAssistantWithToolCallsIndex,
				totalMessages: session.messages.length,
				toolCallIds,
				toolResultIds: Array.from(toolResultIds),
			});

			// 截断消息列表，移除未完成的 tool_calls 及后续消息
			session.messages = session.messages.slice(
				0,
				lastAssistantWithToolCallsIndex,
			);
			session.messageCount = session.messages.length;
			session.updatedAt = Date.now();
		}
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

			// 清理未完成的 tool_calls（防止强制退出时留下无效会话）
			this.cleanIncompleteToolCalls(session);

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
				// 清理未完成的 tool_calls（防止强制退出时留下无效会话）
				this.cleanIncompleteToolCalls(session);

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

	/**
	 * 在项目文件夹和日期文件夹中查找会话
	 * 搜索顺序:
	 * 1. 当前项目的日期文件夹（新格式）
	 * 2. 其他项目的日期文件夹（跨项目兼容）
	 * 3. 旧格式的日期文件夹（向后兼容）
	 */
	private async findSessionInDateFolders(
		sessionId: string,
	): Promise<Session | null> {
		try {
			const files = await fs.readdir(this.sessionsDir);

			// 1. 首先在当前项目中查找
			const currentProjectDir = this.getProjectSessionsDir();
			const sessionFromCurrentProject = await this.findSessionInProjectDir(
				currentProjectDir,
				sessionId,
			);
			if (sessionFromCurrentProject) {
				return sessionFromCurrentProject;
			}

			// 2. 在所有项目文件夹中查找（跨项目和向后兼容）
			for (const file of files) {
				const filePath = path.join(this.sessionsDir, file);
				const stat = await fs.stat(filePath);

				if (!stat.isDirectory()) continue;

				// 跳过当前项目（已经搜索过了）
				if (file === this.currentProjectId) continue;

				// 新格式：项目文件夹（项目名-哈希）
				if (isProjectFolder(file)) {
					const session = await this.findSessionInProjectDir(
						filePath,
						sessionId,
					);
					if (session) return session;
				}

				// 旧格式：日期文件夹 YYYY-MM-DD（无项目层级）
				if (isDateFolder(file)) {
					const sessionPath = path.join(filePath, `${sessionId}.json`);
					try {
						const data = await fs.readFile(sessionPath, 'utf-8');
						const session: Session = JSON.parse(data);
						return session;
					} catch (error) {
						// 文件不存在，继续搜索
						continue;
					}
				}
			}
		} catch (error) {
			// 目录读取失败
		}

		return null;
	}

	/**
	 * 在指定项目目录中查找会话
	 */
	private async findSessionInProjectDir(
		projectDir: string,
		sessionId: string,
	): Promise<Session | null> {
		try {
			const dateFolders = await fs.readdir(projectDir);

			for (const dateFolder of dateFolders) {
				if (!isDateFolder(dateFolder)) continue;

				const sessionPath = path.join(
					projectDir,
					dateFolder,
					`${sessionId}.json`,
				);
				try {
					const data = await fs.readFile(sessionPath, 'utf-8');
					const session: Session = JSON.parse(data);
					return session;
				} catch (error) {
					// 文件不存在，继续搜索
					continue;
				}
			}
		} catch (error) {
			// 目录读取失败
		}

		return null;
	}

	/**
	 * 列出当前项目的所有会话
	 * 只返回与当前项目关联的会话，实现项目级别的会话隔离
	 * 旧格式数据作为只读备用显示，不迁移到新格式
	 */
	async listSessions(): Promise<SessionListItem[]> {
		await this.ensureSessionsDir();
		const sessions: SessionListItem[] = [];
		const seenIds = new Set<string>(); // 用于去重

		try {
			// 1. 从当前项目目录读取会话（新格式，优先）
			const projectDir = this.getProjectSessionsDir();
			try {
				const dateFolders = await fs.readdir(projectDir);
				for (const dateFolder of dateFolders) {
					if (!isDateFolder(dateFolder)) continue;
					const datePath = path.join(projectDir, dateFolder);
					await this.readSessionsFromDir(datePath, sessions);
				}
				// 记录新格式中的会话ID
				for (const s of sessions) {
					seenIds.add(s.id);
				}
			} catch (error) {
				// 项目目录不存在，继续处理旧格式
			}

			// 2. 只有当新格式目录为空时，才读取旧格式作为只读备用
			if (sessions.length === 0) {
				try {
					const files = await fs.readdir(this.sessionsDir);

					for (const file of files) {
						const filePath = path.join(this.sessionsDir, file);
						const stat = await fs.stat(filePath);

						// 旧格式：直接在 sessions 目录下的日期文件夹（不是项目文件夹）
						if (
							stat.isDirectory() &&
							isDateFolder(file) &&
							!isProjectFolder(file)
						) {
							await this.readLegacySessionsFromDir(filePath, sessions, seenIds);
						}

						// 旧格式：直接在 sessions 目录下的 JSON 文件
						if (file.endsWith('.json')) {
							await this.readLegacySessionFile(filePath, sessions, seenIds);
						}
					}
				} catch (error) {
					// 读取旧格式失败不影响主流程
				}
			}

			// Sort by updatedAt (newest first)
			const sorted = sessions.sort((a, b) => b.updatedAt - a.updatedAt);

			// 更新缓存
			this.sessionListCache = sorted;
			this.cacheTimestamp = Date.now();

			return sorted;
		} catch (error) {
			return [];
		}
	}

	/**
	 * 从旧格式目录读取会话（只读备用，按项目过滤）
	 */
	private async readLegacySessionsFromDir(
		dirPath: string,
		sessions: SessionListItem[],
		seenIds: Set<string>,
	): Promise<void> {
		try {
			const files = await fs.readdir(dirPath);
			for (const file of files) {
				if (!file.endsWith('.json')) continue;
				const filePath = path.join(dirPath, file);
				await this.readLegacySessionFile(filePath, sessions, seenIds);
			}
		} catch (error) {
			// Skip inaccessible directories
		}
	}

	/**
	 * 读取单个旧格式会话文件（只读备用，按项目过滤）
	 */
	private async readLegacySessionFile(
		filePath: string,
		sessions: SessionListItem[],
		seenIds: Set<string>,
	): Promise<void> {
		try {
			const data = await fs.readFile(filePath, 'utf-8');
			const session: Session = JSON.parse(data);

			// 跳过已在新格式中存在的会话
			if (seenIds.has(session.id)) {
				return;
			}

			// 项目过滤：只显示匹配当前项目或没有项目标识的会话
			if (
				session.projectPath &&
				session.projectPath !== this.currentProjectPath
			) {
				return;
			}
			if (session.projectId && session.projectId !== this.currentProjectId) {
				return;
			}

			sessions.push({
				id: session.id,
				title: this.cleanTitle(session.title),
				summary: session.summary,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				messageCount: session.messageCount,
				projectPath: session.projectPath,
				projectId: session.projectId,
				compressedFrom: session.compressedFrom,
				compressedAt: session.compressedAt,
			});
			seenIds.add(session.id);
		} catch (error) {
			// Skip invalid session files
		}
	}

	async listSessionsPaginated(
		page: number = 0,
		pageSize: number = 20,
		searchQuery?: string,
	): Promise<PaginatedSessionList> {
		// 检查缓存是否有效
		const now = Date.now();
		const cacheValid =
			this.sessionListCache && now - this.cacheTimestamp < this.CACHE_TTL;

		// 如果缓存有效且没有搜索条件，直接使用缓存
		let allSessions: SessionListItem[];
		if (cacheValid && !searchQuery) {
			allSessions = this.sessionListCache!;
		} else {
			// 缓存失效或有搜索条件，重新加载
			allSessions = await this.listSessions();
		}

		const normalizedQuery = searchQuery?.toLowerCase().trim();
		const matchesQuery = (session: SessionListItem): boolean => {
			if (!normalizedQuery) return true;
			const titleMatch = session.title.toLowerCase().includes(normalizedQuery);
			const summaryMatch = session.summary
				?.toLowerCase()
				.includes(normalizedQuery);
			const idMatch = session.id.toLowerCase().includes(normalizedQuery);
			return titleMatch || summaryMatch || idMatch;
		};

		// 过滤和分页
		const filtered = normalizedQuery
			? allSessions.filter(matchesQuery)
			: allSessions;
		const total = filtered.length;
		const startIndex = page * pageSize;
		const endIndex = startIndex + pageSize;

		// 直接从已过滤的数据中分页，不需要堆排序
		const sessions = filtered.slice(startIndex, endIndex);
		const hasMore = endIndex < total;

		return {sessions, total, hasMore};
	}

	/**
	 * 使缓存失效
	 */
	private invalidateCache(): void {
		this.sessionListCache = null;
		this.cacheTimestamp = 0;
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
							projectPath: session.projectPath,
							projectId: session.projectId,
							compressedFrom: session.compressedFrom,
							compressedAt: session.compressedAt,
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

		// 1. 首先尝试删除旧格式（向下兼容）
		try {
			const oldSessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
			await fs.unlink(oldSessionPath);
			sessionDeleted = true;
		} catch (error) {
			// 旧格式不存在，继续搜索
		}

		// 2. 在当前项目的日期文件夹中查找
		if (!sessionDeleted) {
			sessionDeleted = await this.deleteSessionFromProjectDir(
				this.getProjectSessionsDir(),
				sessionId,
			);
		}

		// 3. 在所有项目文件夹和旧格式日期文件夹中查找
		if (!sessionDeleted) {
			try {
				const files = await fs.readdir(this.sessionsDir);

				for (const file of files) {
					if (sessionDeleted) break;

					const filePath = path.join(this.sessionsDir, file);
					const stat = await fs.stat(filePath);

					if (!stat.isDirectory()) continue;

					// 跳过当前项目（已经搜索过了）
					if (file === this.currentProjectId) continue;

					// 新格式：项目文件夹
					if (isProjectFolder(file)) {
						sessionDeleted = await this.deleteSessionFromProjectDir(
							filePath,
							sessionId,
						);
						if (sessionDeleted) break;
					}

					// 旧格式：日期文件夹
					if (isDateFolder(file)) {
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
	 * 从指定项目目录中删除会话
	 */
	private async deleteSessionFromProjectDir(
		projectDir: string,
		sessionId: string,
	): Promise<boolean> {
		try {
			const dateFolders = await fs.readdir(projectDir);

			for (const dateFolder of dateFolders) {
				if (!isDateFolder(dateFolder)) continue;

				const sessionPath = path.join(
					projectDir,
					dateFolder,
					`${sessionId}.json`,
				);
				try {
					await fs.unlink(sessionPath);
					return true;
				} catch (error) {
					// 文件不存在，继续搜索
					continue;
				}
			}
		} catch (error) {
			// 目录读取失败
		}

		return false;
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
