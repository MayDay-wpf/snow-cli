import {Tool, type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
// Type definitions
import type {
	TodoItem,
	TodoList,
	GetCurrentSessionId,
} from './types/todo.types.js';
// Utility functions
import {formatDateForFolder} from './utils/todo/date.utils.js';

/**
 * TODO 管理服务 - 支持创建、查询、更新 TODO
 */
export class TodoService {
	private readonly todoDir: string;
	private getCurrentSessionId: GetCurrentSessionId;

	constructor(baseDir: string, getCurrentSessionId: GetCurrentSessionId) {
		this.todoDir = path.join(baseDir, 'todos');
		this.getCurrentSessionId = getCurrentSessionId;
	}

	async initialize(): Promise<void> {
		await fs.mkdir(this.todoDir, {recursive: true});
	}

	private getTodoPath(sessionId: string, date?: Date): string {
		const sessionDate = date || new Date();
		const dateFolder = formatDateForFolder(sessionDate);
		const todoDir = path.join(this.todoDir, dateFolder);
		return path.join(todoDir, `${sessionId}.json`);
	}

	private async ensureTodoDir(date?: Date): Promise<void> {
		try {
			await fs.mkdir(this.todoDir, {recursive: true});

			if (date) {
				const dateFolder = formatDateForFolder(date);
				const todoDir = path.join(this.todoDir, dateFolder);
				await fs.mkdir(todoDir, {recursive: true});
			}
		} catch (error) {
			// Directory already exists or other error
		}
	}

	/**
	 * 创建或更新会话的 TODO List
	 */
	async saveTodoList(
		sessionId: string,
		todos: TodoItem[],
		existingList?: TodoList | null,
	): Promise<TodoList> {
		// 使用现有TODO列表的createdAt信息，或者使用当前时间
		const sessionCreatedAt = existingList?.createdAt
			? new Date(existingList.createdAt).getTime()
			: Date.now();
		const sessionDate = new Date(sessionCreatedAt);
		await this.ensureTodoDir(sessionDate);
		const todoPath = this.getTodoPath(sessionId, sessionDate);

		try {
			const content = await fs.readFile(todoPath, 'utf-8');
			existingList = JSON.parse(content);
		} catch {
			// 文件不存在,创建新的
		}

		const now = new Date().toISOString();
		const todoList: TodoList = {
			sessionId,
			todos,
			createdAt: existingList?.createdAt ?? now,
			updatedAt: now,
		};

		await fs.writeFile(todoPath, JSON.stringify(todoList, null, 2));
		return todoList;
	}

	/**
	 * 获取会话的 TODO List
	 */
	async getTodoList(sessionId: string): Promise<TodoList | null> {
		// 首先尝试从旧格式加载（向下兼容）
		try {
			const oldTodoPath = path.join(this.todoDir, `${sessionId}.json`);
			const content = await fs.readFile(oldTodoPath, 'utf-8');
			return JSON.parse(content);
		} catch (error) {
			// 旧格式不存在，搜索日期文件夹
		}

		// 在日期文件夹中查找 TODO
		try {
			const todo = await this.findTodoInDateFolders(sessionId);
			return todo;
		} catch (error) {
			// 搜索失败
		}

		return null;
	}

	private async findTodoInDateFolders(
		sessionId: string,
	): Promise<TodoList | null> {
		try {
			const files = await fs.readdir(this.todoDir);

			for (const file of files) {
				const filePath = path.join(this.todoDir, file);
				const stat = await fs.stat(filePath);

				if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(file)) {
					// 这是日期文件夹，查找 TODO 文件
					const todoPath = path.join(filePath, `${sessionId}.json`);
					try {
						const content = await fs.readFile(todoPath, 'utf-8');
						return JSON.parse(content);
					} catch (error) {
						// 文件不存在或读取失败，继续搜索
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
	 * 更新单个 TODO 项
	 */
	async updateTodoItem(
		sessionId: string,
		todoId: string,
		updates: Partial<Omit<TodoItem, 'id' | 'createdAt'>>,
	): Promise<TodoList | null> {
		const todoList = await this.getTodoList(sessionId);
		if (!todoList) {
			return null;
		}

		const todoIndex = todoList.todos.findIndex(t => t.id === todoId);
		if (todoIndex === -1) {
			return null;
		}

		const existingTodo = todoList.todos[todoIndex]!;
		todoList.todos[todoIndex] = {
			...existingTodo,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		return this.saveTodoList(sessionId, todoList.todos, todoList);
	}

	/**
	 * 添加 TODO 项
	 */
	async addTodoItem(
		sessionId: string,
		content: string,
		parentId?: string,
	): Promise<TodoList> {
		const todoList = await this.getTodoList(sessionId);
		const now = new Date().toISOString();

		/**
		 * 验证并修正 parentId
		 * - 如果 parentId 为空或不存在于当前列表中，自动转为 undefined（创建根级任务）
		 * - 如果 parentId 有效，保持原值（创建子任务）
		 */
		let validatedParentId: string | undefined;
		if (parentId && parentId.trim() !== '' && todoList) {
			const parentExists = todoList.todos.some(todo => todo.id === parentId);
			if (parentExists) {
				validatedParentId = parentId;
			}
		}

		const newTodo: TodoItem = {
			id: `todo-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
			content,
			status: 'pending',
			createdAt: now,
			updatedAt: now,
			parentId: validatedParentId,
		};

		const todos = todoList ? [...todoList.todos, newTodo] : [newTodo];
		return this.saveTodoList(sessionId, todos, todoList);
	}

	/**
	 * 删除 TODO 项
	 */
	async deleteTodoItem(
		sessionId: string,
		todoId: string,
	): Promise<TodoList | null> {
		const todoList = await this.getTodoList(sessionId);
		if (!todoList) {
			return null;
		}

		const filteredTodos = todoList.todos.filter(
			t => t.id !== todoId && t.parentId !== todoId,
		);
		return this.saveTodoList(sessionId, filteredTodos, todoList);
	}

	/**
	 * 创建空 TODO 列表（会话自动创建时使用）
	 */
	async createEmptyTodo(sessionId: string): Promise<TodoList> {
		return this.saveTodoList(sessionId, [], null);
	}

	/**
	 * 删除整个会话的 TODO 列表
	 */
	async deleteTodoList(sessionId: string): Promise<boolean> {
		// 首先尝试删除旧格式（向下兼容）
		try {
			const oldTodoPath = path.join(this.todoDir, `${sessionId}.json`);
			await fs.unlink(oldTodoPath);
			return true;
		} catch (error) {
			// 旧格式不存在，搜索日期文件夹
		}

		// 在日期文件夹中查找并删除 TODO
		try {
			const files = await fs.readdir(this.todoDir);

			for (const file of files) {
				const filePath = path.join(this.todoDir, file);
				const stat = await fs.stat(filePath);

				if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(file)) {
					// 这是日期文件夹，查找 TODO 文件
					const todoPath = path.join(filePath, `${sessionId}.json`);
					try {
						await fs.unlink(todoPath);
						return true;
					} catch (error) {
						// 文件不存在，继续搜索
						continue;
					}
				}
			}
		} catch (error) {
			// 目录读取失败
		}

		return false;
	}

	/**
	 * 获取所有工具定义
	 */
	getTools(): Tool[] {
		return [
			{
				name: 'todo-get',
				description: `Get current TODO list with task IDs, status, and hierarchy.

 MANDATORY RULE - PARALLEL CALLS ONLY:
 NEVER call todo-get alone! MUST call with other tools in the SAME function call block.
 ALWAYS: todo-get + filesystem-read/terminal-execute/etc in parallel
 FORBIDDEN: Call todo-get alone to check status

##  WHEN TO USE IN DIALOGUE:
- **User provides additional info**: Use todo-get + filesystem-read to check what's done
- **User requests modifications**: Check current progress before adding/updating tasks
- **Continuing work**: Always check status first to avoid redoing completed tasks

USAGE: Combine with filesystem-read, terminal-execute, or other actions to check progress while working.`,
				inputSchema: {
					type: 'object',
					properties: {},
				},
			},
			{
				name: 'todo-update',
				description: `Update TODO status/content - USE THIS FREQUENTLY to track progress!

 MANDATORY RULE - PARALLEL CALLS ONLY:
 NEVER call todo-update alone! MUST call with other tools in the SAME function call block.
 ALWAYS: todo-update + filesystem-edit/terminal-execute/etc in parallel
 FORBIDDEN: Call todo-update, wait for result, then proceed

BEST PRACTICE: Mark "completed" ONLY after task is verified.
Example: todo-update(task1, completed) + filesystem-edit(task2) → Update while working!

 This ensures efficient workflow and prevents unnecessary wait times.`,

				inputSchema: {
					type: 'object',
					properties: {
						todoId: {
							type: 'string',
							description:
								'TODO item ID to update (get exact ID from todo-get)',
						},
						status: {
							type: 'string',
							enum: ['pending', 'completed'],
							description:
								'New status - "pending" (not done) or "completed" (100% finished and verified)',
						},

						content: {
							type: 'string',
							description:
								'Updated TODO content (optional, only if task description needs refinement)',
						},
					},
					required: ['todoId'],
				},
			},
			{
				name: 'todo-add',
				description: `Add new task to existing TODO list when requirements expand.

 MANDATORY RULE - PARALLEL CALLS ONLY:
 NEVER call todo-add alone! MUST call with other tools in the SAME function call block.
 ALWAYS: todo-add + filesystem-edit/filesystem-read/etc in parallel
 FORBIDDEN: Call todo-add alone to add task

USE WHEN:
- User adds new requirements during work
- You discover additional necessary steps
- Breaking down a complex task into subtasks

TODO will be automatically created for each session.`,
				inputSchema: {
					type: 'object',
					properties: {
						content: {
							type: 'string',
							description:
								'TODO item description - must be specific, actionable, and technically precise',
						},
						parentId: {
							type: 'string',
							description:
								'Parent TODO ID to create a subtask (optional). Get valid IDs from todo-get.',
						},
					},
					required: ['content'],
				},
			},
			{
				name: 'todo-delete',
				description: `Delete TODO item from the list.

 MANDATORY RULE - PARALLEL CALLS ONLY:
 NEVER call todo-delete alone! MUST call with other tools in the SAME function call block.
 ALWAYS: todo-delete + filesystem-edit/todo-get/etc in parallel
 FORBIDDEN: Call todo-delete alone

NOTE: Deleting a parent task will cascade delete all its children automatically.`,
				inputSchema: {
					type: 'object',
					properties: {
						todoId: {
							type: 'string',
							description:
								'TODO item ID to delete. Deleting a parent will cascade delete all its children. Get exact ID from todo-get.',
						},
					},
					required: ['todoId'],
				},
			},
		];
	}

	/**
	 * 执行工具调用
	 */
	async executeTool(
		toolName: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		// 自动获取当前会话 ID
		const sessionId = this.getCurrentSessionId();
		if (!sessionId) {
			return {
				content: [
					{
						type: 'text',
						text: 'Error: No active session found',
					},
				],
				isError: true,
			};
		}

		try {
			switch (toolName) {
				case 'get': {
					let result = await this.getTodoList(sessionId);

					// 兜底机制：如果TODO不存在，自动创建空TODO
					if (!result) {
						result = await this.createEmptyTodo(sessionId);
					}

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				case 'update': {
					const {todoId, status, content} = args as {
						todoId: string;
						status?: 'pending' | 'completed';
						content?: string;
					};

					const updates: Partial<Omit<TodoItem, 'id' | 'createdAt'>> = {};
					if (status) updates.status = status;
					if (content) updates.content = content;

					const result = await this.updateTodoItem(sessionId, todoId, updates);
					return {
						content: [
							{
								type: 'text',
								text: result
									? JSON.stringify(result, null, 2)
									: 'TODO item not found',
							},
						],
					};
				}

				case 'add': {
					const {content, parentId} = args as {
						content: string;
						parentId?: string;
					};

					const result = await this.addTodoItem(sessionId, content, parentId);
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				case 'delete': {
					const {todoId} = args as {
						todoId: string;
					};

					const result = await this.deleteTodoItem(sessionId, todoId);
					return {
						content: [
							{
								type: 'text',
								text: result
									? JSON.stringify(result, null, 2)
									: 'TODO item not found',
							},
						],
					};
				}

				default:
					return {
						content: [
							{
								type: 'text',
								text: `Unknown tool: ${toolName}`,
							},
						],
						isError: true,
					};
			}
		} catch (error) {
			return {
				content: [
					{
						type: 'text',
						text: `Error executing ${toolName}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					},
				],
				isError: true,
			};
		}
	}
}
