import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {randomUUID} from 'crypto';
import type {ChatMessage} from '../session/sessionManager.js';

export interface Task {
	id: string;
	title: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
	prompt: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
	error?: string;
	pid?: number;
	pausedInfo?: {
		reason: 'sensitive_command';
		sensitiveCommand?: {
			command: string;
			description?: string;
			toolCallId: string;
			toolName: string;
			args: any;
			rejectionReason?: string;
		};
		pausedAt: number;
	};
}

export interface TaskListItem {
	id: string;
	title: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

class TaskManager {
	private readonly tasksDir: string;
	private readonly operationQueues: Map<string, Promise<any>> = new Map();

	constructor() {
		this.tasksDir = path.join(os.homedir(), '.snow', 'tasks');
	}

	/**
	 * Queue an operation for a specific task to prevent concurrent modifications
	 */
	private async queueOperation<T>(
		taskId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const existingQueue = this.operationQueues.get(taskId);
		const newQueue = (existingQueue || Promise.resolve()).then(
			() => operation(),
			() => operation(),
		);
		this.operationQueues.set(taskId, newQueue);

		try {
			return await newQueue;
		} finally {
			if (this.operationQueues.get(taskId) === newQueue) {
				this.operationQueues.delete(taskId);
			}
		}
	}

	private async ensureTasksDir(): Promise<void> {
		try {
			await fs.mkdir(this.tasksDir, {recursive: true});
		} catch (error) {
			// Directory already exists
		}
	}

	private getTaskPath(taskId: string): string {
		return path.join(this.tasksDir, `${taskId}.json`);
	}

	async createTask(prompt: string): Promise<Task> {
		await this.ensureTasksDir();

		const taskId = randomUUID();
		const title = prompt.slice(0, 50) + (prompt.length > 50 ? '...' : '');

		const task: Task = {
			id: taskId,
			title,
			status: 'pending',
			prompt,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
		};

		await this.saveTask(task);
		return task;
	}

	async saveTask(task: Task): Promise<void> {
		await this.ensureTasksDir();
		const taskPath = this.getTaskPath(task.id);
		await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
	}

	async loadTask(taskId: string): Promise<Task | null> {
		try {
			const taskPath = this.getTaskPath(taskId);
			const data = await fs.readFile(taskPath, 'utf-8');
			return JSON.parse(data);
		} catch (error) {
			return null;
		}
	}

	async listTasks(): Promise<TaskListItem[]> {
		await this.ensureTasksDir();
		const tasks: TaskListItem[] = [];

		try {
			const files = await fs.readdir(this.tasksDir);

			for (const file of files) {
				if (file.endsWith('.json')) {
					try {
						const taskPath = path.join(this.tasksDir, file);
						const data = await fs.readFile(taskPath, 'utf-8');
						const task: Task = JSON.parse(data);

						tasks.push({
							id: task.id,
							title: task.title,
							status: task.status,
							createdAt: task.createdAt,
							updatedAt: task.updatedAt,
							messageCount: task.messages.length,
						});
					} catch (error) {
						continue;
					}
				}
			}

			return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
		} catch (error) {
			return [];
		}
	}

	async deleteTask(taskId: string): Promise<boolean> {
		try {
			// Load task to check if it has a running process
			const task = await this.loadTask(taskId);
			if (task?.pid) {
				// Try to kill the process if it's still running
				try {
					process.kill(task.pid, 'SIGTERM');
					// Wait a bit for graceful shutdown
					await new Promise(resolve => setTimeout(resolve, 100));
					// If still running, force kill
					try {
						process.kill(task.pid, 'SIGKILL');
					} catch {
						// Process already terminated, ignore
					}
				} catch (killError) {
					// Process doesn't exist or already terminated, continue with deletion
				}
			}

			const taskPath = this.getTaskPath(taskId);
			await fs.unlink(taskPath);
			return true;
		} catch (error) {
			return false;
		}
	}

	async updateTaskStatus(
		taskId: string,
		status: Task['status'],
		error?: string,
	): Promise<void> {
		return this.queueOperation(taskId, async () => {
			const task = await this.loadTask(taskId);
			if (task) {
				task.status = status;
				task.updatedAt = Date.now();
				if (error) {
					task.error = error;
				}
				await this.saveTask(task);
			}
		});
	}

	async addMessage(taskId: string, message: ChatMessage): Promise<void> {
		return this.queueOperation(taskId, async () => {
			const task = await this.loadTask(taskId);
			if (task) {
				task.messages.push(message);
				task.updatedAt = Date.now();
				// Preserve paused status and pausedInfo - don't overwrite them
				await this.saveTask(task);
			}
		});
	}

	async convertTaskToSession(taskId: string): Promise<string | null> {
		const task = await this.loadTask(taskId);
		if (!task) {
			return null;
		}

		// Import sessionManager
		const {sessionManager} = await import('../session/sessionManager.js');

		// Create new session with task's messages
		const session = await sessionManager.createNewSession();
		session.title = task.title;
		session.messages = task.messages.map(msg => ({
			...msg,
			timestamp: msg.timestamp || Date.now(),
		}));
		session.messageCount = session.messages.length;
		session.updatedAt = Date.now();

		// Save the session
		await sessionManager.saveSession(session);

		// Set as current session
		sessionManager.setCurrentSession(session);

		// Delete the task
		await this.deleteTask(taskId);

		return session.id;
	}

	async pauseTaskForSensitiveCommand(
		taskId: string,
		sensitiveCommand: {
			command: string;
			description?: string;
			toolCallId: string;
			toolName: string;
			args: any;
		},
	): Promise<void> {
		return this.queueOperation(taskId, async () => {
			const task = await this.loadTask(taskId);
			if (task) {
				task.status = 'paused';
				task.pausedInfo = {
					reason: 'sensitive_command',
					sensitiveCommand,
					pausedAt: Date.now(),
				};
				task.updatedAt = Date.now();
				await this.saveTask(task);
			}
		});
	}

	async approveSensitiveCommand(taskId: string): Promise<boolean> {
		return this.queueOperation(taskId, async () => {
			const task = await this.loadTask(taskId);
			if (!task || task.status !== 'paused') {
				return false;
			}

			task.status = 'running';
			delete task.pausedInfo;
			task.updatedAt = Date.now();
			await this.saveTask(task);
			return true;
		});
	}

	async rejectSensitiveCommand(
		taskId: string,
		reason: string,
	): Promise<boolean> {
		return this.queueOperation(taskId, async () => {
			const task = await this.loadTask(taskId);
			if (
				!task ||
				task.status !== 'paused' ||
				!task.pausedInfo?.sensitiveCommand
			) {
				return false;
			}

			task.pausedInfo.sensitiveCommand = {
				...task.pausedInfo.sensitiveCommand,
				rejectionReason: reason,
			};

			task.status = 'running';
			task.updatedAt = Date.now();
			await this.saveTask(task);
			return true;
		});
	}

	async getPausedInfo(taskId: string): Promise<Task['pausedInfo'] | null> {
		const task = await this.loadTask(taskId);
		return task?.pausedInfo || null;
	}
}

export const taskManager = new TaskManager();
