import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {TodoService} from '../../../mcp/todo.js';
import type {TodoItem} from '../../../mcp/types/todo.types.js';

// ============================================================================
// MCP Domain (L1 Integration): TodoService 任务状态机与按天目录持久化
// 依据 testing-scenario-cli 沙箱隔离原则
// ============================================================================

test('todo: saveTodoList and getTodoList basic lifecycle', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-mcp-todo-'));
	const sessionId = 'test-session-123';
	const service = new TodoService(tempDir, () => sessionId);
	await service.initialize();

	try {
		const now = new Date().toISOString();
		const initialTodos: TodoItem[] = [
			{id: '1', content: 'Task 1', status: 'pending', createdAt: now, updatedAt: now},
			{id: '2', content: 'Task 2', status: 'completed', createdAt: now, updatedAt: now},
		];

		// 1. 保存 TodoList
		const saved = await service.saveTodoList(sessionId, initialTodos);
		t.is(saved.sessionId, sessionId);
		t.is(saved.todos.length, 2);

		// 2. 获取并断言
		const retrieved = await service.getTodoList(sessionId);
		t.truthy(retrieved);
		t.is(retrieved?.todos.length, 2);
		t.is(retrieved?.todos[0]?.content, 'Task 1');
		t.is(retrieved?.todos[1]?.status, 'completed');

		// 3. 增量更新状态 (Task 1 改为 status: 'completed')
		const updatedTodos: TodoItem[] = [
			{id: '1', content: 'Task 1', status: 'completed', createdAt: now, updatedAt: new Date().toISOString()},
			{id: '2', content: 'Task 2', status: 'completed', createdAt: now, updatedAt: now},
		];
		await service.saveTodoList(sessionId, updatedTodos, retrieved);

		const afterUpdate = await service.getTodoList(sessionId);
		t.is(afterUpdate?.todos[0]?.status, 'completed');
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});

test('todo: getTodoList returns null for non-existent session', async t => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-mcp-todo-null-'));
	const service = new TodoService(tempDir, () => 'missing-session');
	await service.initialize();

	try {
		const result = await service.getTodoList('non-existent-session-id');
		t.is(result, null);
	} finally {
		fs.rmSync(tempDir, {recursive: true, force: true});
	}
});
