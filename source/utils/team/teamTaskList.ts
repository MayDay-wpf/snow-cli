import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync} from 'fs';
import {join, dirname} from 'path';
import {homedir} from 'os';
import {randomUUID} from 'crypto';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TeamTask {
	id: string;
	title: string;
	description?: string;
	status: TaskStatus;
	assigneeId?: string;
	assigneeName?: string;
	dependencies?: string[];
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

interface TaskListData {
	tasks: TeamTask[];
	updatedAt: string;
}

const SNOW_DIR = join(homedir(), '.snow');
const TEAMS_DIR = join(SNOW_DIR, 'teams');

function getTaskListPath(teamName: string): string {
	return join(TEAMS_DIR, teamName, 'tasks.json');
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
}

function readTaskList(teamName: string): TaskListData {
	const filePath = getTaskListPath(teamName);
	if (!existsSync(filePath)) {
		return {tasks: [], updatedAt: new Date().toISOString()};
	}
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as TaskListData;
	} catch {
		return {tasks: [], updatedAt: new Date().toISOString()};
	}
}

function writeTaskList(teamName: string, data: TaskListData): void {
	const filePath = getTaskListPath(teamName);
	ensureDir(dirname(filePath));

	// Atomic write via temp file + rename
	const tmpPath = filePath + '.tmp.' + process.pid;
	data.updatedAt = new Date().toISOString();
	writeFileSync(tmpPath, JSON.stringify(data, null, 2));
	renameSync(tmpPath, filePath);
}

export function createTask(
	teamName: string,
	title: string,
	description?: string,
	dependencies?: string[],
	assigneeId?: string,
	assigneeName?: string,
): TeamTask {
	const data = readTaskList(teamName);
	const now = new Date().toISOString();

	const task: TeamTask = {
		id: randomUUID().slice(0, 8),
		title,
		description,
		status: 'pending',
		assigneeId,
		assigneeName,
		dependencies: dependencies && dependencies.length > 0 ? dependencies : undefined,
		createdAt: now,
		updatedAt: now,
	};

	data.tasks.push(task);
	writeTaskList(teamName, data);
	return task;
}

export function claimTask(
	teamName: string,
	taskId: string,
	assigneeId: string,
	assigneeName: string,
): TeamTask | null {
	const data = readTaskList(teamName);
	const task = data.tasks.find(t => t.id === taskId);
	if (!task) return null;

	if (task.status !== 'pending') {
		throw new Error(
			`Task "${task.title}" is already ${task.status}`,
		);
	}

	// Check unresolved dependencies
	if (task.dependencies && task.dependencies.length > 0) {
		const unresolved = task.dependencies.filter(depId => {
			const dep = data.tasks.find(t => t.id === depId);
			return !dep || dep.status !== 'completed';
		});
		if (unresolved.length > 0) {
			throw new Error(
				`Task "${task.title}" has unresolved dependencies: ${unresolved.join(', ')}`,
			);
		}
	}

	task.status = 'in_progress';
	task.assigneeId = assigneeId;
	task.assigneeName = assigneeName;
	task.updatedAt = new Date().toISOString();

	writeTaskList(teamName, data);
	return task;
}

export function completeTask(
	teamName: string,
	taskId: string,
): TeamTask | null {
	const data = readTaskList(teamName);
	const task = data.tasks.find(t => t.id === taskId);
	if (!task) return null;

	task.status = 'completed';
	task.completedAt = new Date().toISOString();
	task.updatedAt = task.completedAt;

	writeTaskList(teamName, data);
	return task;
}

export function assignTask(
	teamName: string,
	taskId: string,
	assigneeId: string,
	assigneeName: string,
): TeamTask | null {
	const data = readTaskList(teamName);
	const task = data.tasks.find(t => t.id === taskId);
	if (!task) return null;

	task.assigneeId = assigneeId;
	task.assigneeName = assigneeName;
	task.updatedAt = new Date().toISOString();

	writeTaskList(teamName, data);
	return task;
}

export function updateTaskStatus(
	teamName: string,
	taskId: string,
	status: TaskStatus,
): TeamTask | null {
	const data = readTaskList(teamName);
	const task = data.tasks.find(t => t.id === taskId);
	if (!task) return null;

	task.status = status;
	task.updatedAt = new Date().toISOString();
	if (status === 'completed') {
		task.completedAt = task.updatedAt;
	}

	writeTaskList(teamName, data);
	return task;
}

export function listTasks(teamName: string): TeamTask[] {
	return readTaskList(teamName).tasks;
}

export function getClaimableTasks(teamName: string): TeamTask[] {
	const data = readTaskList(teamName);
	return data.tasks.filter(task => {
		if (task.status !== 'pending') return false;
		if (!task.dependencies || task.dependencies.length === 0) return true;

		return task.dependencies.every(depId => {
			const dep = data.tasks.find(t => t.id === depId);
			return dep && dep.status === 'completed';
		});
	});
}

export function getTask(teamName: string, taskId: string): TeamTask | null {
	const data = readTaskList(teamName);
	return data.tasks.find(t => t.id === taskId) || null;
}

export function getTasksByAssignee(teamName: string, assigneeId: string): TeamTask[] {
	const data = readTaskList(teamName);
	return data.tasks.filter(t => t.assigneeId === assigneeId);
}

export function clearTasks(teamName: string): void {
	const filePath = getTaskListPath(teamName);
	if (existsSync(filePath)) {
		writeTaskList(teamName, {tasks: [], updatedAt: new Date().toISOString()});
	}
}
