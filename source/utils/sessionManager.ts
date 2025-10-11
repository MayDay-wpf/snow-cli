import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type { ChatMessage as APIChatMessage } from '../api/chat.js';

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

	constructor() {
		this.sessionsDir = path.join(os.homedir(), '.snow', 'sessions');
	}

	private async ensureSessionsDir(): Promise<void> {
		try {
			await fs.mkdir(this.sessionsDir, { recursive: true });
		} catch (error) {
			// Directory already exists or other error
		}
	}

	private getSessionPath(sessionId: string): string {
		return path.join(this.sessionsDir, `${sessionId}.json`);
	}

	async createNewSession(): Promise<Session> {
		await this.ensureSessionsDir();

		// 使用 UUID v4 生成唯一会话 ID，避免并发冲突
		const sessionId = randomUUID();
		const session: Session = {
			id: sessionId,
			title: 'New Chat',
			summary: '',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
			messageCount: 0
		};

		this.currentSession = session;
		await this.saveSession(session);
		return session;
	}

	async saveSession(session: Session): Promise<void> {
		await this.ensureSessionsDir();
		const sessionPath = this.getSessionPath(session.id);
		await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
	}

	async loadSession(sessionId: string): Promise<Session | null> {
		try {
			const sessionPath = this.getSessionPath(sessionId);
			const data = await fs.readFile(sessionPath, 'utf-8');
			const session: Session = JSON.parse(data);
			this.currentSession = session;
			return session;
		} catch (error) {
			return null;
		}
	}

	async listSessions(): Promise<SessionListItem[]> {
		await this.ensureSessionsDir();

		try {
			const files = await fs.readdir(this.sessionsDir);
			const sessions: SessionListItem[] = [];

			for (const file of files) {
				if (file.endsWith('.json')) {
					try {
						const sessionPath = path.join(this.sessionsDir, file);
						const data = await fs.readFile(sessionPath, 'utf-8');
						const session: Session = JSON.parse(data);

						sessions.push({
							id: session.id,
							title: session.title,
							summary: session.summary,
							createdAt: session.createdAt,
							updatedAt: session.updatedAt,
							messageCount: session.messageCount
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

		// Simple title generation from first user message (no API call)
		if (this.currentSession.messageCount === 1 && message.role === 'user') {
			this.currentSession.title = message.content.slice(0, 50);
			this.currentSession.summary = message.content.slice(0, 100);
		}

		await this.saveSession(this.currentSession);
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
		try {
			const sessionPath = this.getSessionPath(sessionId);
			await fs.unlink(sessionPath);
			return true;
		} catch (error) {
			return false;
		}
	}
}

export const sessionManager = new SessionManager();