import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {randomUUID} from 'crypto';
import type {ChatMessage as APIChatMessage} from '../../api/chat.js';
import type {UsageInfo} from '../../api/types.js';
import {getTodoService} from '../execution/mcpToolsManager.js';
import {logger} from '../core/logger.js';
import {summaryAgent} from '../../agents/summaryAgent.js';
import {
	resolveProjectIdentity,
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

export function buildInitialUserPromptBlock(initialUserPrompt: string): string {
	return [
		'[INITIAL USER REQUEST - VERBATIM, MUST NOT BE PARAPHRASED]',
		'',
		initialUserPrompt,
		'',
		"The exact text above is the user's initial request and remains authoritative throughout this conversation. Do NOT rephrase it. If later summaries conflict with it, the verbatim request wins.",
	].join('\n');
}

export function buildSessionStartHookContext(
	messages: ChatMessage[],
	sessionId: string,
) {
	return {
		messages,
		messageCount: messages.length,
		sessionId,
		cwd: process.cwd(),
		isResume: messages.length > 0,
	};
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
	// 用户启动提示词原文。压缩会话继承该字段，防止摘要反复压缩后遗漏初始需求。
	initialUserPrompt?: string;
	// 图片压缩的本地文本归档：后续压缩从此文本重新渲染，不嵌套历史图片。
	imageContextArchive?: string;
	branchedFrom?: string; // 如果是 fork 产生的会话，记录来源会话ID
	branchName?: string; // 用户指定的分支名称
	contextUsage?: UsageInfo; // 最近一次 API 响应的上下文 token 使用信息（可选，向下兼容）
	// /goal 相关：标记本会话当前是否绑定了一个未完结的 Ralph Loop 目标。
	// - true：goal- MCP 工具应该注册供模型调用
	// - false / undefined：普通会话，goal- 工具不会注册
	// 由 goalManager 在 createGoal / resumeGoal / clearGoal / modelUpdateGoal 中同步维护
	hasGoal?: boolean;
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
	// /goal 相关元数据（仅 listGoalResumableSessions 填充，普通列表不返回）
	hasGoal?: boolean;
	goalStatus?: 'pursuing' | 'paused' | 'budget-limited' | 'achieved' | 'unmet';
	goalObjective?: string;
	goalTokensUsed?: number;
	goalTokenBudget?: number;
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
	private readonly projectAliasIds: string[];
	// 会话列表缓存
	private sessionListCache: SessionListItem[] | null = null;
	private cacheTimestamp: number = 0;
	private readonly CACHE_TTL = 5000; // 缓存有效期 5 秒
	// 消息变化监听器（单个消息添加）
	private messageListeners: Array<(message: ChatMessage) => void> = [];
	// 消息列表变化监听器（任何消息列表变化：添加、删除、截断、切换会话等）
	private messagesChangedListeners: Array<() => void> = [];

	constructor() {
		this.sessionsDir = path.join(os.homedir(), '.snow', 'sessions');
		const identity = resolveProjectIdentity();
		this.currentProjectId = identity.projectId;
		this.currentProjectPath = identity.projectPath;
		this.projectAliasIds = identity.projectAliasIds;
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

	createSessionId(): string {
		return randomUUID();
	}

	async createNewSession(
		isTemporary = false,
		skipEmptyTodo = false,
	): Promise<Session> {
		await this.ensureSessionsDir(new Date());

		const effectiveSessionId =
			this.consumePendingNewSessionId() || this.createSessionId();
		const session: Session = {
			id: effectiveSessionId,
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
			await this.createEmptyTodoForSession(effectiveSessionId);
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

		// 新版本统一写入稳定项目 ID；旧路径项目 ID 作为只读别名自动兼容。
		session.projectId = this.currentProjectId;
		session.projectPath = this.currentProjectPath;

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

	/**
	 * Pending model-visible context from onSessionStart additionalContext.
	 * Consumed once on the next user message sent to the API.
	 */
	private pendingAdditionalContext?: string;
	private pendingDisplayMessage?: string;
	private pendingNewSessionId?: string;

	setPendingNewSessionId(sessionId: string): void {
		this.pendingNewSessionId = sessionId;
	}

	reserveNewSessionId(): string {
		if (!this.pendingNewSessionId) {
			this.pendingNewSessionId = this.createSessionId();
		}
		return this.pendingNewSessionId;
	}

	private consumePendingNewSessionId(): string | undefined {
		const sessionId = this.pendingNewSessionId;
		this.pendingNewSessionId = undefined;
		return sessionId;
	}

	setPendingAdditionalContext(context?: string, displayMessage?: string): void {
		this.pendingAdditionalContext =
			context && context.trim() ? context : undefined;
		this.pendingDisplayMessage =
			displayMessage && displayMessage.trim() ? displayMessage : undefined;
	}

	/**
	 * Read and clear pending session-start additionalContext (one-shot).
	 */
	consumePendingAdditionalContext(): {
		context?: string;
		displayMessage?: string;
	} {
		const context = this.pendingAdditionalContext;
		const displayMessage = this.pendingDisplayMessage;
		this.pendingAdditionalContext = undefined;
		this.pendingDisplayMessage = undefined;
		return {
			...(context ? {context} : {}),
			...(displayMessage ? {displayMessage} : {}),
		};
	}

	peekPendingAdditionalContext(): string | undefined {
		return this.pendingAdditionalContext;
	}

	clearPendingAdditionalContext(): void {
		this.pendingAdditionalContext = undefined;
		this.pendingDisplayMessage = undefined;
	}

	private async loadSessionFromDisk(
		sessionId: string,
	): Promise<Session | null> {
		// 首先尝试从旧格式加载（向下兼容）
		try {
			const oldSessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
			const data = await fs.readFile(oldSessionPath, 'utf-8');
			const session: Session = JSON.parse(data);
			return session;
		} catch {
			// 旧格式不存在，搜索日期文件夹
		}

		// 在日期文件夹中查找会话
		try {
			return await this.findSessionInDateFolders(sessionId);
		} catch {
			// 搜索失败
		}

		return null;
	}

	async getLastAssistantMessageFromSession(
		sessionId: string,
	): Promise<ChatMessage | null> {
		const session = await this.loadSessionFromDisk(sessionId);
		if (!session) {
			return null;
		}

		this.cleanIncompleteToolCalls(session);

		for (let i = session.messages.length - 1; i >= 0; i--) {
			const msg = session.messages[i];
			if (msg && msg.role === 'assistant' && !msg.subAgentInternal) {
				return msg;
			}
		}

		return null;
	}

	async loadSession(sessionId: string): Promise<Session | null> {
		// Clear previous error and warning
		this.lastLoadHookError = undefined;
		this.lastLoadHookWarning = undefined;

		const session = await this.loadSessionFromDisk(sessionId);
		if (!session) {
			return null;
		}

		// 清理未完成的 tool_calls（防止强制退出时留下无效会话）
		this.cleanIncompleteToolCalls(session);

		// Execute onSessionStart with the identity of the session being resumed.
		const hookResult = await this.executeSessionStartHook(
			session.messages,
			session.id,
		);
		if (!hookResult.shouldContinue) {
			// Hook failed, store error details and abort loading
			this.lastLoadHookError = hookResult.errorDetails;
			return null;
		}

		// Store warning if exists
		if (hookResult.warningMessage) {
			this.lastLoadHookWarning = hookResult.warningMessage;
		}

		// Queue additionalContext for the next API user turn (one-shot)
		this.setPendingAdditionalContext(
			hookResult.additionalContext,
			hookResult.displayMessage,
		);

		this.setCurrentSession(session);
		return session;
	}

	async getInitialUserPrompt(session: Session): Promise<string | null> {
		const sessionChain: Session[] = [];
		const seenSessionIds = new Set<string>();
		let currentSession: Session | null = session;

		while (currentSession && !seenSessionIds.has(currentSession.id)) {
			sessionChain.push(currentSession);
			seenSessionIds.add(currentSession.id);

			if (!currentSession.compressedFrom) {
				break;
			}

			currentSession = await this.loadSessionFromDisk(
				currentSession.compressedFrom,
			);
		}

		for (const historicalSession of sessionChain.reverse()) {
			const storedPrompt = historicalSession.initialUserPrompt?.trim();
			if (storedPrompt) {
				return storedPrompt;
			}

			const firstUserMessage = historicalSession.messages.find(
				message => message.role === 'user' && Boolean(message.content?.trim()),
			);
			const prompt = firstUserMessage?.content?.trim();
			if (prompt) {
				return prompt;
			}
		}

		return null;
	}
	/**
	 * 获取可用于当前项目读取的项目目录。
	 * 第一个始终是稳定项目目录，后续是旧路径项目目录别名。
	 */
	private getProjectSessionDirsToRead(): Array<{
		projectId: string;
		dir: string;
	}> {
		const projectIds = new Set<string>([
			this.currentProjectId,
			...this.projectAliasIds,
		]);

		return [...projectIds].map(projectId => ({
			projectId,
			dir: path.join(this.sessionsDir, projectId),
		}));
	}

	private isCurrentProjectSession(session: Session): boolean {
		if (!session.projectId && !session.projectPath) {
			return true;
		}

		if (session.projectId) {
			return (
				session.projectId === this.currentProjectId ||
				this.projectAliasIds.includes(session.projectId)
			);
		}

		return session.projectPath === this.currentProjectPath;
	}

	private toSessionListItem(session: Session): SessionListItem {
		return {
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
			hasGoal: session.hasGoal, // 透传给 /goal resume 列表过滤
		};
	}

	private addSessionListItem(
		sessions: SessionListItem[],
		seenIds: Set<string>,
		session: Session,
	): void {
		if (seenIds.has(session.id) || !this.isCurrentProjectSession(session)) {
			return;
		}

		sessions.push(this.toSessionListItem(session));
		seenIds.add(session.id);
	}

	/**
	 * 在项目文件夹和日期文件夹中查找会话
	 * 搜索顺序:
	 * 1. 稳定项目目录
	 * 2. 当前项目的旧路径别名目录
	 * 3. 其他项目目录和旧格式日期目录（向后兼容）
	 */
	private async findSessionInDateFolders(
		sessionId: string,
	): Promise<Session | null> {
		try {
			const preferredProjectIds = new Set<string>();

			for (const {projectId, dir} of this.getProjectSessionDirsToRead()) {
				preferredProjectIds.add(projectId);
				const session = await this.findSessionInProjectDir(dir, sessionId);
				if (session) return session;
			}

			const files = await fs.readdir(this.sessionsDir);
			for (const file of files) {
				const filePath = path.join(this.sessionsDir, file);
				const stat = await fs.stat(filePath);

				if (!stat.isDirectory()) continue;
				if (preferredProjectIds.has(file)) continue;

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
	 * 自动合并稳定项目目录、旧路径项目目录和旧格式数据，用户移动工作目录后无需手动迁移。
	 */
	async listSessions(): Promise<SessionListItem[]> {
		await this.ensureSessionsDir();
		const sessions: SessionListItem[] = [];
		const seenIds = new Set<string>(); // 用于去重

		try {
			// 1. 读取稳定项目目录和旧路径别名目录
			for (const {dir} of this.getProjectSessionDirsToRead()) {
				try {
					const dateFolders = await fs.readdir(dir);
					for (const dateFolder of dateFolders) {
						if (!isDateFolder(dateFolder)) continue;
						const datePath = path.join(dir, dateFolder);
						await this.readSessionsFromDir(datePath, sessions, seenIds);
					}
				} catch (error) {
					// 项目目录不存在，继续读取其他兼容来源
				}
			}

			// 2. 读取旧格式作为备用（全程合并，而不是只在新目录为空时读取）
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
			this.addSessionListItem(sessions, seenIds, session);
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
		seenIds: Set<string>,
	): Promise<void> {
		try {
			const files = await fs.readdir(dirPath);

			for (const file of files) {
				if (!file.endsWith('.json')) continue;

				try {
					const sessionPath = path.join(dirPath, file);
					const data = await fs.readFile(sessionPath, 'utf-8');
					const session: Session = JSON.parse(data);
					this.addSessionListItem(sessions, seenIds, session);
				} catch (error) {
					// Skip invalid session files
					continue;
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

			if (m.tool_calls && message.tool_calls) {
				const existingIds = new Set(m.tool_calls.map(tc => tc.id));
				const newIds = new Set(message.tool_calls.map(tc => tc.id));
				if (existingIds.size !== newIds.size) return false;
				for (const id of newIds) {
					if (!existingIds.has(id)) return false;
				}
			} else if (m.tool_calls || message.tool_calls) {
				return false;
			}

			if (m.subAgentContent !== message.subAgentContent) {
				return false;
			}
			if (m.subAgent?.agentId !== message.subAgent?.agentId) {
				return false;
			}
			const existingThinking = m.thinking?.thinking || '';
			const newThinking = message.thinking?.thinking || '';
			if (existingThinking !== newThinking) {
				return false;
			}

			if (m.tool_call_id && message.tool_call_id) {
				return m.tool_call_id === message.tool_call_id;
			}
			if (m.tool_call_id || message.tool_call_id) {
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

		// 通知监听器有新消息
		this.notifyMessageListeners(message);

		// Generate simple title and summary from first user message
		if (this.currentSession.messageCount === 1 && message.role === 'user') {
			const initialUserPrompt = message.content.trim();
			if (initialUserPrompt) {
				this.currentSession.initialUserPrompt = initialUserPrompt;
			}

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

		// 通知消息列表已变化，也同步标题/摘要等会话元数据
		this.notifyMessagesChanged();

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

		// Capture session reference and ID at start to prevent cross-session pollution.
		// The async API call below can take seconds; by the time it completes,
		// this.currentSession may point to a different session (e.g. after /home → new chat).
		const targetSession = this.currentSession;
		const targetSessionId = targetSession.id;

		try {
			const firstUserMessage = targetSession.messages.find(
				m => m.role === 'user',
			);
			const firstAssistantMessage = targetSession.messages.find(
				m => m.role === 'assistant',
			);

			if (!firstUserMessage || !firstAssistantMessage) {
				logger.warn(
					'Summary agent: Could not find first user/assistant messages',
				);
				return;
			}

			const result = await summaryAgent.generateSummary(
				firstUserMessage.content,
				firstAssistantMessage.content,
			);

			if (result) {
				// Verify session hasn't changed during the async API call
				if (
					!this.currentSession ||
					this.currentSession.id !== targetSessionId
				) {
					// Session switched (e.g. /home was used). Write directly to the
					// captured session object and persist it, without touching the
					// now-different currentSession.
					targetSession.title = result.title;
					targetSession.summary = result.summary;
					await this.saveSession(targetSession);

					logger.info('Summary agent: Updated detached session summary', {
						sessionId: targetSessionId,
						title: result.title,
						summary: result.summary,
					});
					return;
				}

				targetSession.title = result.title;
				targetSession.summary = result.summary;
				await this.saveSession(targetSession);
				this.notifyMessagesChanged();

				logger.info('Summary agent: Successfully updated session summary', {
					sessionId: targetSessionId,
					title: result.title,
					summary: result.summary,
				});
			}
		} catch (error) {
			logger.error('Summary agent: Failed to generate summary', error);
		}
	}

	/**
	 * 更新当前会话的上下文 token 使用信息（仅更新内存，下次 saveSession 时一并持久化）
	 */
	updateContextUsage(usage: UsageInfo | null): void {
		if (!this.currentSession) {
			return;
		}

		if (usage) {
			this.currentSession.contextUsage = usage;
		} else {
			delete this.currentSession.contextUsage;
		}
	}

	getCurrentSession(): Session | null {
		return this.currentSession;
	}

	/**
	 * Load a session purely from disk for read-only purposes (e.g. /export).
	 *
	 * Unlike `loadSession`, this does not mutate `currentSession`, does not run
	 * the onSessionStart hook, and does not touch the session list cache. Returns
	 * null if the session file cannot be found.
	 */
	async getSessionForExport(sessionId: string): Promise<Session | null> {
		const session = await this.loadSessionFromDisk(sessionId);
		if (!session) return null;
		this.cleanIncompleteToolCalls(session);
		return session;
	}

	setCurrentSession(session: Session): void {
		this.currentSession = session;
		this.pendingNewSessionId = undefined;
		this.notifyMessagesChanged();
	}

	clearCurrentSession(): void {
		this.currentSession = null;
		this.pendingNewSessionId = undefined;
		this.clearPendingAdditionalContext();
		this.notifyMessagesChanged();
	}

	/**
	 * /goal 专用：把指定会话的 hasGoal 标记落盘。
	 *
	 * 使用方式：
	 * - goalManager.createGoal / resumeGoal 设置 true（让 mcpToolsManager 注册 goal- 工具）
	 * - goalManager.clearGoal / modelUpdateGoal(achieved|unmet) 设置 false（撤销 goal- 工具）
	 *
	 * 为什么必须落盘（而不是只改内存）：用户通过 /resume <id> 切换到一个旧的 goal 会话时，
	 * sessionManager 会 loadSessionFromDisk 重新读取，如果 hasGoal 没写入磁盘，
	 * 切换回来后 mcpToolsManager 拿不到 hasGoal=true，模型就无法调用 goal-update_goal
	 * 来停止 Ralph Loop —— 整个机制会失效。
	 *
	 * 如果会话已经在内存中（getCurrentSession），同步更新内存对象，
	 * 避免后续 saveMessage 用旧引用把 hasGoal 又抹掉。
	 */
	async setSessionGoalFlag(sessionId: string, hasGoal: boolean): Promise<void> {
		// 先更新内存中的当前会话（如果命中），避免读盘
		const isCurrent = this.currentSession?.id === sessionId;
		if (isCurrent) {
			this.currentSession!.hasGoal = hasGoal;
		}

		// 落盘：通过 findSessionInDateFolders 找到文件，改字段，再 saveSession。
		// saveSession 内部会按 createdAt 计算文件夹路径，保证写到正确位置。
		try {
			let session: Session | null = isCurrent
				? this.currentSession
				: await this.loadSessionFromDisk(sessionId);
			if (!session) {
				// 会话不存在（可能刚被删除），静默忽略。goal 文件本身仍可独立存在，
				// 但失去 session 后 goal- 工具反正也用不上。
				return;
			}
			session.hasGoal = hasGoal;
			await this.saveSession(session);
		} catch (error) {
			logger.warn('Failed to persist hasGoal flag:', {
				sessionId,
				hasGoal,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * /goal resume 专用：列出本项目下所有 goal 可恢复的会话。
	 *
	 * 筛选规则（与 /goal resume 的语义保持一致）：
	 * - 必须 session.hasGoal === true
	 * - 必须 goal 状态在 ['paused', 'pursuing', 'budget-limited'] 中（已完成 achieved / 已放弃 unmet 不可恢复）
	 *
	 * 为什么不直接复用 listSessions：普通列表不需要 goal 元数据，避免把 goalManager
	 * 引入热路径增加 IO。/goal resume 这种低频路径才扫描每个 goal 文件。
	 *
	 * 返回的 SessionListItem 会额外携带 goalStatus / goalObjective / tokens 字段
	 * 供 SessionListPanel 在 goalOnly 模式下展示。
	 */
	async listGoalResumableSessions(): Promise<SessionListItem[]> {
		const all = await this.listSessions();
		const result: SessionListItem[] = [];
		// 延迟 import 避免循环依赖（goalManager 内部已经反过来 import sessionManager）
		const {goalManager} = await import('../task/goalManager.js');
		for (const item of all) {
			if (!item.hasGoal) continue;
			try {
				const goal = await goalManager.loadGoalForSession(item.id);
				if (!goal) continue;
				if (
					goal.status !== 'paused' &&
					goal.status !== 'pursuing' &&
					goal.status !== 'budget-limited'
				) {
					continue;
				}
				result.push({
					...item,
					hasGoal: true,
					goalStatus: goal.status,
					goalObjective: goal.objective,
					goalTokensUsed: goal.tokensUsed,
					goalTokenBudget: goal.tokenBudget,
				});
			} catch {
				// 单个 goal 读失败不影响整体列表
			}
		}
		return result;
	}

	/**
	 * 订阅消息变化事件（单个消息添加）
	 */
	onMessageAdded(listener: (message: ChatMessage) => void): () => void {
		this.messageListeners.push(listener);
		return () => {
			const index = this.messageListeners.indexOf(listener);
			if (index > -1) {
				this.messageListeners.splice(index, 1);
			}
		};
	}

	/**
	 * 订阅消息列表变化事件（任何变化：添加、删除、截断、切换会话等）
	 */
	onMessagesChanged(listener: () => void): () => void {
		this.messagesChangedListeners.push(listener);
		return () => {
			const index = this.messagesChangedListeners.indexOf(listener);
			if (index > -1) {
				this.messagesChangedListeners.splice(index, 1);
			}
		};
	}

	/**
	 * 通知所有监听器有新消息
	 */
	private notifyMessageListeners(message: ChatMessage): void {
		for (const listener of this.messageListeners) {
			try {
				listener(message);
			} catch (error) {
				logger.error('Error in message listener:', error);
			}
		}
	}

	/**
	 * 通知所有监听器消息列表发生变化
	 */
	private notifyMessagesChanged(): void {
		for (const listener of this.messagesChangedListeners) {
			try {
				listener();
			} catch (error) {
				logger.error('Error in messages changed listener:', error);
			}
		}
	}
	/**
	 * Update the title of a session
	 * @param sessionId - Session ID to update
	 * @param newTitle - New title for the session
	 */
	async updateSessionTitle(
		sessionId: string,
		newTitle: string,
	): Promise<boolean> {
		try {
			// Find the session first
			const session = await this.findSessionInDateFolders(sessionId);
			if (!session) {
				logger.warn('Session not found for title update:', {sessionId});
				return false;
			}

			// Update title and timestamp
			session.title = this.cleanTitle(newTitle);
			session.updatedAt = Date.now();

			// Save the updated session
			await this.saveSession(session);

			// If this is the current session, update it
			if (this.currentSession?.id === sessionId) {
				this.currentSession.title = session.title;
				this.currentSession.updatedAt = session.updatedAt;
			}

			logger.info('Session title updated:', {
				sessionId,
				newTitle: session.title,
			});

			return true;
		} catch (error) {
			logger.error('Failed to update session title:', {
				sessionId,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
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

		// 2. 优先删除稳定项目目录和旧路径别名目录
		if (!sessionDeleted) {
			for (const {dir} of this.getProjectSessionDirsToRead()) {
				sessionDeleted = await this.deleteSessionFromProjectDir(dir, sessionId);
				if (sessionDeleted) break;
			}
		}

		// 3. 在所有项目文件夹和旧格式日期文件夹中查找
		if (!sessionDeleted) {
			try {
				const files = await fs.readdir(this.sessionsDir);
				const preferredProjectIds = new Set([
					this.currentProjectId,
					...this.projectAliasIds,
				]);

				for (const file of files) {
					if (sessionDeleted) break;

					const filePath = path.join(this.sessionsDir, file);
					const stat = await fs.stat(filePath);

					if (!stat.isDirectory()) continue;
					if (preferredProjectIds.has(file)) continue;

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

		// 如果会话删除成功，同时删除对应的TODO列表，并让会话列表缓存失效
		if (sessionDeleted) {
			// 删除会话会影响 listSessionsPaginated 的结果；必须失效缓存，否则 UI 会看到旧列表。
			this.invalidateCache();

			// 如果删除的是当前会话，清理当前会话引用，避免后续使用到已删除会话。
			if (this.currentSession?.id === sessionId) {
				this.clearCurrentSession();
			}

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
	private async executeSessionStartHook(
		messages: ChatMessage[],
		sessionId: string,
	): Promise<{
		shouldContinue: boolean;
		errorDetails?: {
			type: 'warning' | 'error';
			exitCode: number;
			command: string;
			output?: string;
			error?: string;
		};
		warningMessage?: string;
		additionalContext?: string;
		displayMessage?: string;
	}> {
		try {
			const {unifiedHooksExecutor} = await import(
				'../execution/unifiedHooksExecutor.js'
			);
			const {interpretHookResult} = await import(
				'../execution/hookResultInterpreter.js'
			);

			const hookResult = await unifiedHooksExecutor.executeHooks(
				'onSessionStart',
				buildSessionStartHookContext(messages, sessionId),
			);
			const interpreted = interpretHookResult('onSessionStart', hookResult);
			if (interpreted.action === 'warn') {
				logger.warn(interpreted.warningMessage || '');
				return {
					shouldContinue: true,
					warningMessage: interpreted.warningMessage,
					additionalContext: interpreted.additionalContext,
					displayMessage: interpreted.displayMessage,
				};
			}
			if (interpreted.action === 'block') {
				logger.error(
					`onSessionStart hook failed: ${JSON.stringify(
						interpreted.errorDetails,
					)}`,
				);
				return {shouldContinue: false, errorDetails: interpreted.errorDetails};
			}
			return {
				shouldContinue: true,
				additionalContext: interpreted.additionalContext,
				displayMessage: interpreted.displayMessage,
			};
		} catch (error) {
			logger.error('Failed to execute onSessionStart hook:', error);
			return {shouldContinue: true};
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

		// 通知监听器消息列表已变化
		this.notifyMessagesChanged();

		await this.saveSession(this.currentSession);
	}
}

export const sessionManager = new SessionManager();
