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
		const existingMessage = this.currentSession.messages.find(m =>
			m.role === message.role &&
			m.content === message.content &&
			Math.abs(m.timestamp - message.timestamp) < 5000 // Within 5 seconds
		);

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