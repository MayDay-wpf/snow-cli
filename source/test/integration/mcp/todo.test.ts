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
		const initialTodos: TodoItem[] = [
			{id: '1', title: 'Task 1', completed: false},
			{id: '2', title: 'Task 2', completed: true},
		];

		// 1. 保存 TodoList
		const saved = await service.saveTodoList(sessionId, initialTodos);
		t.is(saved.sessionId, sessionId);
		t.is(saved.todos.length, 2);

		// 2. 获取并断言
		const retrieved = await service.getTodoList(sessionId);
		t.truthy(retrieved);
		t.is(retrieved?.todos.length, 2);
		t.is(retrieved?.todos[0]?.title, 'Task 1');
		t.is(retrieved?.todos[1]?.completed, true);

		// 3. 增量更新状态 (Task 1 改为 completed: true)
		const updatedTodos: TodoItem[] = [
			{id: '1', title: 'Task 1', completed: true},
			{id: '2', title: 'Task 2', completed: true},
		];
		await service.saveTodoList(sessionId, updatedTodos, retrieved);

		const afterUpdate = await service.getTodoList(sessionId);
		t.is(afterUpdate?.todos[0]?.completed, true);
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
