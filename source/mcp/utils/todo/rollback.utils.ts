import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {TodoList} from '../../types/todo.types.js';
import {getProjectId} from '../../../utils/session/projectUtils.js';

export interface TodoSnapshotOperation {
	beforeList: TodoList | null;
}

interface TodoSnapshotData {
	[key: string]: TodoSnapshotOperation[];
}

interface TodoSnapshotRecord {
	messageIndex: number;
	operation: TodoSnapshotOperation;
}

function getTodoSnapshotDir(): string {
	return path.join(os.homedir(), '.snow', 'todo-snapshots');
}

function getTodoSnapshotFilePath(): string {
	const projectId = getProjectId();
	return path.join(getTodoSnapshotDir(), `${projectId}.json`);
}

function ensureDir(): void {
	const dir = getTodoSnapshotDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
}

function readTodoSnapshotData(): TodoSnapshotData {
	const filePath = getTodoSnapshotFilePath();
	if (!fs.existsSync(filePath)) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TodoSnapshotData;
	} catch {
		return {};
	}
}

function saveTodoSnapshotData(data: TodoSnapshotData): void {
	ensureDir();
	try {
		fs.writeFileSync(
			getTodoSnapshotFilePath(),
			JSON.stringify(data, null, 2),
			'utf-8',
		);
	} catch (error) {
		console.error('Failed to save TODO snapshot data:', error);
	}
}

function cloneTodoList(todoList: TodoList | null): TodoList | null {
	return todoList ? (JSON.parse(JSON.stringify(todoList)) as TodoList) : null;
}

export function recordTodoSnapshot(
	sessionId: string,
	messageIndex: number,
	beforeList: TodoList | null,
): void {
	const data = readTodoSnapshotData();
	const key = `${sessionId}:${messageIndex}`;
	if (data[key]?.length) {
		return;
	}

	data[key] = [{beforeList: cloneTodoList(beforeList)}];
	saveTodoSnapshotData(data);
}

export function getTodoSnapshotsToRollback(
	sessionId: string,
	targetMessageIndex: number,
): TodoSnapshotRecord[] {
	const data = readTodoSnapshotData();
	const records: TodoSnapshotRecord[] = [];

	for (const [key, operations] of Object.entries(data)) {
		if (!key.startsWith(`${sessionId}:`)) continue;
		const msgIndex = parseInt(key.split(':')[1] || '', 10);
		const operation = operations[0];
		if (
			operation &&
			!Number.isNaN(msgIndex) &&
			msgIndex >= targetMessageIndex
		) {
			records.push({messageIndex: msgIndex, operation});
		}
	}

	return records.sort((a, b) => a.messageIndex - b.messageIndex);
}

export function getTodoRollbackCount(
	sessionId: string,
	targetMessageIndex: number,
): number {
	return getTodoSnapshotsToRollback(sessionId, targetMessageIndex).length;
}

export async function rollbackTodos(
	sessionId: string,
	targetMessageIndex: number,
	restore: (todoList: TodoList | null) => Promise<void>,
): Promise<number> {
	const records = getTodoSnapshotsToRollback(sessionId, targetMessageIndex);
	if (records.length === 0) {
		return 0;
	}

	await restore(records[0]!.operation.beforeList);
	deleteTodoSnapshotsFromIndex(sessionId, targetMessageIndex);
	return records.length;
}

export function deleteTodoSnapshotsFromIndex(
	sessionId: string,
	targetMessageIndex: number,
): void {
	const data = readTodoSnapshotData();
	let changed = false;

	for (const key of Object.keys(data)) {
		if (!key.startsWith(`${sessionId}:`)) continue;
		const msgIndex = parseInt(key.split(':')[1] || '', 10);
		if (!Number.isNaN(msgIndex) && msgIndex >= targetMessageIndex) {
			delete data[key];
			changed = true;
		}
	}

	if (changed) {
		saveTodoSnapshotData(data);
	}
}

export function clearAllTodoSnapshots(sessionId: string): void {
	const data = readTodoSnapshotData();
	let changed = false;

	for (const key of Object.keys(data)) {
		if (key.startsWith(`${sessionId}:`)) {
			delete data[key];
			changed = true;
		}
	}

	if (changed) {
		saveTodoSnapshotData(data);
	}
}
