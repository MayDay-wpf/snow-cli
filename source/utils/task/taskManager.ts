import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {randomUUID} from 'crypto';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {
	resolveProjectIdentity,
	type ProjectIdentity,
} from '../session/projectUtils.js';
import type {ChatMessage} from '../session/sessionManager.js';

const execFileAsync = promisify(execFile);
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_MS = 30000;

export type TaskScope = 'current' | 'all';

export interface Task {
	id: string;
	title: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
	prompt: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
	projectId?: string;
	projectPath?: string;
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
	status: Task['status'];
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	projectId?: string;
	projectPath?: string;
	isLegacy?: boolean;
}

export type TaskReference = Pick<TaskListItem, 'id' | 'projectId' | 'isLegacy'>;

export type TaskManagerOptions = {
	snowDir?: string;
	projectIdentity?: Pick<ProjectIdentity, 'projectId' | 'projectPath'>;
	inspectProcess?: (pid: number) => Promise<string | null>;
};

function isTaskReference(
	value: string | TaskReference,
): value is TaskReference {
	return typeof value !== 'string';
}

function isExpectedTaskProcess(commandLine: string, taskId: string): boolean {
	return commandLine.includes('--task-execute') && commandLine.includes(taskId);
}

async function inspectProcessCommand(pid: number): Promise<string | null> {
	try {
		if (process.platform === 'win32') {
			const {stdout} = await execFileAsync('powershell.exe', [
				'-NoProfile',
				'-Command',
				`(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
			]);
			return stdout.trim() || null;
		}

		const command = await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8');
		return command.replaceAll('\0', ' ').trim() || null;
	} catch {
		return null;
	}
}

export class TaskManager {
	private readonly tasksDir: string;
	private readonly currentProjectId: string;
	private readonly currentProjectPath: string;
	private readonly inspectProcess: (pid: number) => Promise<string | null>;

	constructor(options: TaskManagerOptions = {}) {
		const resolvedIdentity = resolveProjectIdentity();
		const identity =
			options.projectIdentity ||
			(process.env['SNOW_TASK_PROJECT_ID'] &&
			process.env['SNOW_TASK_PROJECT_PATH']
				? {
						projectId: process.env['SNOW_TASK_PROJECT_ID'],
						projectPath: process.env['SNOW_TASK_PROJECT_PATH'],
				  }
				: resolvedIdentity);
		this.tasksDir = path.join(
			options.snowDir || os.homedir(),
			'.snow',
			'tasks',
		);
		this.currentProjectId = identity.projectId;
		this.currentProjectPath = identity.projectPath;
		this.inspectProcess = options.inspectProcess || inspectProcessCommand;
	}

	getProjectId(): string {
		return this.currentProjectId;
	}

	getProjectPath(): string {
		return this.currentProjectPath;
	}

	private getProjectTasksDir(projectId = this.currentProjectId): string {
		return path.join(this.tasksDir, projectId);
	}

	private getTaskPath(
		taskId: string,
		projectId = this.currentProjectId,
	): string {
		return path.join(this.getProjectTasksDir(projectId), `${taskId}.json`);
	}

	private getLegacyTaskPath(taskId: string): string {
		return path.join(this.tasksDir, `${taskId}.json`);
	}

	private async ensureTasksDir(
		projectId = this.currentProjectId,
	): Promise<void> {
		await fs.mkdir(this.getProjectTasksDir(projectId), {recursive: true});
	}

	private getTaskPathForReference(reference: string | TaskReference): string {
		if (isTaskReference(reference) && reference.isLegacy) {
			return this.getLegacyTaskPath(reference.id);
		}

		return this.getTaskPath(
			isTaskReference(reference) ? reference.id : reference,
			isTaskReference(reference) ? reference.projectId : undefined,
		);
	}

	private async withTaskLock<T>(
		taskPath: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const lockPath = `${taskPath}.lock`;
		const deadline = Date.now() + LOCK_TIMEOUT_MS;

		while (true) {
			try {
				const handle = await fs.open(lockPath, 'wx');
				try {
					await handle.writeFile(`${process.pid}:${Date.now()}`, 'utf-8');
					return await operation();
				} finally {
					await handle.close();
					await fs.unlink(lockPath).catch(() => {});
				}
			} catch (error: any) {
				if (error?.code !== 'EEXIST') throw error;

				const stat = await fs.stat(lockPath).catch(() => undefined);
				if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
					await fs.unlink(lockPath).catch(() => {});
					continue;
				}

				if (Date.now() >= deadline) {
					throw new Error(`Timed out waiting for task lock: ${taskPath}`);
				}

				await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
			}
		}
	}

	private async writeTaskAtomically(
		taskPath: string,
		task: Task,
	): Promise<void> {
		await fs.mkdir(path.dirname(taskPath), {recursive: true});
		const tempPath = `${taskPath}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await fs.writeFile(tempPath, JSON.stringify(task, null, 2), 'utf-8');
			await fs.rename(tempPath, taskPath);
		} finally {
			await fs.unlink(tempPath).catch(() => {});
		}
	}

	private async readTaskAtPath(taskPath: string): Promise<Task | null> {
		try {
			return JSON.parse(await fs.readFile(taskPath, 'utf-8')) as Task;
		} catch {
			return null;
		}
	}

	private async mutateTask<T>(
		reference: string | TaskReference,
		mutator: (task: Task) => T | Promise<T>,
	): Promise<T | null> {
		const taskPath = this.getTaskPathForReference(reference);
		return this.withTaskLock(taskPath, async () => {
			const task = await this.readTaskAtPath(taskPath);
			if (!task) return null;
			const result = await mutator(task);
			task.updatedAt = Date.now();
			await this.writeTaskAtomically(taskPath, task);
			return result;
		});
	}

	async createTask(prompt: string): Promise<Task> {
		await this.ensureTasksDir();
		const task: Task = {
			id: randomUUID(),
			title: prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
			status: 'pending',
			prompt,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
			projectId: this.currentProjectId,
			projectPath: this.currentProjectPath,
		};
		await this.writeTaskAtomically(this.getTaskPath(task.id), task);
		return task;
	}

	async loadTask(reference: string | TaskReference): Promise<Task | null> {
		return this.readTaskAtPath(this.getTaskPathForReference(reference));
	}

	private toListItem(
		task: Task,
		options: {isLegacy?: boolean} = {},
	): TaskListItem {
		return {
			id: task.id,
			title: task.title,
			status: task.status,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
			messageCount: task.messages.length,
			projectId: task.projectId,
			projectPath: task.projectPath,
			isLegacy: options.isLegacy,
		};
	}

	private async listTasksInDirectory(
		directory: string,
		options: {isLegacy?: boolean} = {},
	): Promise<TaskListItem[]> {
		const entries = await fs
			.readdir(directory, {withFileTypes: true})
			.catch(() => []);
		const tasks = await Promise.all(
			entries
				.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
				.map(async entry => {
					const task = await this.readTaskAtPath(
						path.join(directory, entry.name),
					);
					return task ? this.toListItem(task, options) : null;
				}),
		);
		return tasks.filter((task): task is TaskListItem => Boolean(task));
	}

	async listTasks(scope: TaskScope = 'current'): Promise<TaskListItem[]> {
		await this.ensureTasksDir();
		if (scope === 'current') {
			return this.listTasksInDirectory(this.getProjectTasksDir());
		}

		const entries = await fs
			.readdir(this.tasksDir, {withFileTypes: true})
			.catch(() => []);
		const projectTasks = await Promise.all(
			entries
				.filter(entry => entry.isDirectory())
				.map(entry =>
					this.listTasksInDirectory(path.join(this.tasksDir, entry.name)),
				),
		);
		const legacyTasks = await this.listTasksInDirectory(this.tasksDir, {
			isLegacy: true,
		});
		return [...projectTasks.flat(), ...legacyTasks].sort(
			(a, b) => b.updatedAt - a.updatedAt,
		);
	}

	async deleteTask(reference: string | TaskReference): Promise<boolean> {
		const task = await this.loadTask(reference);
		if (!task) return false;

		if (task.pid) {
			const commandLine = await this.inspectProcess(task.pid);
			if (!commandLine || !isExpectedTaskProcess(commandLine, task.id)) {
				return false;
			}
			try {
				process.kill(task.pid, 'SIGTERM');
			} catch {
				return false;
			}
		}

		try {
			await fs.unlink(this.getTaskPathForReference(reference));
			return true;
		} catch {
			return false;
		}
	}

	async updateTaskStatus(
		taskId: string,
		status: Task['status'],
		error?: string,
	): Promise<void> {
		await this.mutateTask(taskId, task => {
			task.status = status;
			if (error) task.error = error;
		});
	}

	async addMessage(taskId: string, message: ChatMessage): Promise<void> {
		await this.mutateTask(taskId, task => {
			task.messages.push(message);
		});
	}

	async setTaskPid(taskId: string, pid: number): Promise<void> {
		await this.mutateTask(taskId, task => {
			task.pid = pid;
		});
	}

	async finalizeTask(
		taskId: string,
		status: Extract<Task['status'], 'completed' | 'failed'>,
		error?: string,
	): Promise<Task | null> {
		return this.mutateTask(taskId, task => {
			task.status = status;
			if (error) task.error = error;
			delete task.pid;
			return {...task};
		});
	}

	async convertTaskToSession(
		reference: string | TaskReference,
	): Promise<string | null> {
		const task = await this.loadTask(reference);
		if (!task) return null;
		const {sessionManager} = await import('../session/sessionManager.js');
		const session = await sessionManager.createNewSession();
		session.title = task.title;
		session.messages = task.messages.map(message => ({
			...message,
			timestamp: message.timestamp || Date.now(),
		}));
		session.messageCount = session.messages.length;
		session.updatedAt = Date.now();
		await sessionManager.saveSession(session);
		sessionManager.setCurrentSession(session);
		return (await this.deleteTask(reference)) ? session.id : null;
	}

	async pauseTaskForSensitiveCommand(
		taskId: string,
		sensitiveCommand: NonNullable<Task['pausedInfo']>['sensitiveCommand'],
	): Promise<void> {
		await this.mutateTask(taskId, task => {
			task.status = 'paused';
			task.pausedInfo = {
				reason: 'sensitive_command',
				sensitiveCommand,
				pausedAt: Date.now(),
			};
		});
	}

	async ensureTaskPaused(taskId: string): Promise<void> {
		await this.mutateTask(taskId, task => {
			if (task.pausedInfo) task.status = 'paused';
		});
	}

	async approveSensitiveCommand(taskId: string): Promise<boolean> {
		return Boolean(
			await this.mutateTask(taskId, task => {
				if (task.status !== 'paused') return false;
				task.status = 'running';
				delete task.pausedInfo;
				return true;
			}),
		);
	}

	async rejectSensitiveCommand(
		taskId: string,
		reason: string,
	): Promise<boolean> {
		return Boolean(
			await this.mutateTask(taskId, task => {
				if (task.status !== 'paused' || !task.pausedInfo?.sensitiveCommand) {
					return false;
				}
				task.pausedInfo.sensitiveCommand.rejectionReason = reason;
				task.status = 'running';
				return true;
			}),
		);
	}

	async consumeRejectionReason(taskId: string): Promise<string | undefined> {
		return (
			(await this.mutateTask(taskId, task => {
				const reason = task.pausedInfo?.sensitiveCommand?.rejectionReason;
				if (reason) delete task.pausedInfo;
				return reason;
			})) ?? undefined
		);
	}
}

export const taskManager = new TaskManager();
