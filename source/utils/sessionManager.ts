import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getOpenAiConfig } from './apiConfig.js';

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
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

		const sessionId = Date.now().toString();
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

		// Generate summary for the first user message or when messages reach certain count
		if (this.shouldGenerateSummary()) {
			await this.generateSessionSummary();
		}

		await this.saveSession(this.currentSession);
	}

	private shouldGenerateSummary(): boolean {
		if (!this.currentSession) return false;

		const userMessages = this.currentSession.messages.filter(m => m.role === 'user');

		// Generate summary for first user message or every 5 user messages
		return userMessages.length === 1 || userMessages.length % 5 === 0;
	}

	private async generateSessionSummary(): Promise<void> {
		if (!this.currentSession || this.currentSession.messages.length === 0) return;

		try {
			const config = getOpenAiConfig();
			if (!config.basicModel || !config.baseUrl || !config.apiKey) {
				// No basic model configured, use simple title from first user message
				const firstUserMessage = this.currentSession.messages.find(m => m.role === 'user');
				if (firstUserMessage) {
					this.currentSession.title = firstUserMessage.content.slice(0, 50);
					this.currentSession.summary = firstUserMessage.content.slice(0, 100);
				}
				return;
			}

			// Prepare conversation context for summary
			const recentMessages = this.currentSession.messages.slice(-10); // Last 10 messages
			const conversationContext = recentMessages
				.map(m => `${m.role}: ${m.content}`)
				.join('\n');

			const summaryPrompt = `Please provide a brief title (max 50 characters) and summary (max 100 characters) for this conversation:

${conversationContext}

Format your response as JSON:
{
  "title": "Brief descriptive title",
  "summary": "Short summary of the conversation"
}`;

			// Call the basic model for summary generation
			const response = await this.callBasicModel(summaryPrompt);
			const summaryData = this.parseJsonResponse(response);

			if (summaryData && summaryData.title && summaryData.summary) {
				this.currentSession.title = summaryData.title.slice(0, 50);
				this.currentSession.summary = summaryData.summary.slice(0, 100);
			}
		} catch (error) {
			// Fallback to simple title from first user message
			const firstUserMessage = this.currentSession.messages.find(m => m.role === 'user');
			if (firstUserMessage) {
				this.currentSession.title = firstUserMessage.content.slice(0, 50);
				this.currentSession.summary = firstUserMessage.content.slice(0, 100);
			}
		}
	}

	private async callBasicModel(prompt: string): Promise<string> {
		const config = getOpenAiConfig();

		const requestBody = {
			model: config.basicModel,
			messages: [
				{
					role: 'user',
					content: prompt
				}
			],
			response_format: {
				type: 'json'
			},
			max_tokens: 150,
			temperature: 0.1
		};

		const response = await fetch(`${config.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${config.apiKey}`
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			throw new Error(`API request failed: ${response.statusText}`);
		}

		const data = await response.json();
		return data.choices?.[0]?.message?.content || '';
	}

	private parseJsonResponse(response: string): any {
		try {
			// Try to extract JSON from response
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				return JSON.parse(jsonMatch[0]);
			}
			return null;
		} catch (error) {
			return null;
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