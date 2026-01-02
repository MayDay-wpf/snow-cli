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
// Event emitter
import {todoEvents} from '../utils/events/todoEvents.js';

/**
 * TODO 管理服务 - 支持创建、查询、更新 TODO
 * 路径结构: ~/.snow/todos/项目名/YYYY-MM-DD/sessionId.json
 */
export class TodoService {
	private readonly todoDir: string;
	private getCurrentSessionId: GetCurrentSessionId;

	constructor(baseDir: string, getCurrentSessionId: GetCurrentSessionId) {
		// baseDir 现在已经包含了项目ID，直接使用
		// 路径结构: baseDir/YYYY-MM-DD/sessionId.json
		this.todoDir = baseDir;
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

		// 触发 TODO 更新事件
		todoEvents.emitTodoUpdate(sessionId, todos);

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
	 * 复制 TODO 列表到新会话（用于会话压缩时继承 TODO）
	 * @param fromSessionId - 源会话ID
	 * @param toSessionId - 目标会话ID
	 * @returns 复制后的 TODO 列表，如果源会话没有 TODO 则返回 null
	 */
	async copyTodoList(
		fromSessionId: string,
		toSessionId: string,
	): Promise<TodoList | null> {
		// 获取源会话的 TODO 列表
		const sourceTodoList = await this.getTodoList(fromSessionId);

		// 如果源会话没有 TODO 或 TODO 为空，不需要复制
		if (!sourceTodoList || sourceTodoList.todos.length === 0) {
			return null;
		}

		// 复制 TODO 项到新会话（保留原有的 TODO 项，但更新时间戳）
		const now = new Date().toISOString();
		const copiedTodos: TodoItem[] = sourceTodoList.todos.map(todo => ({
			...todo,
			// 保留原有的 id、content、status、parentId
			// 更新时间戳
			updatedAt: now,
		}));

		// 保存到新会话
		return this.saveTodoList(toSessionId, copiedTodos, null);
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

PARALLEL CALLS ONLY: MUST pair with other tools (todo-get + filesystem-read/terminal-execute/etc).
NEVER call todo-get alone - always combine with an action tool.

USE WHEN:
- User provides additional info → Check what's already done before continuing
- User requests modifications → Check current progress before adding tasks
- Continuing work → Verify status to avoid redoing completed tasks

EXAMPLE: todo-get + filesystem-read (check progress while reading files)`,
				inputSchema: {
					type: 'object',
					properties: {},
				},
			},
			{
				name: 'todo-update',
				description: `Update TODO status/content - USE FREQUENTLY to track progress!

PARALLEL CALLS ONLY: MUST pair with other tools (todo-update + filesystem-edit/terminal-execute/etc).
NEVER call todo-update alone - always combine with an action tool.

BEST PRACTICE: 
- Mark "completed" ONLY after task is verified
- Update while working, not after
- Example: todo-update(task1, completed) + filesystem-edit(task2) 

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
				description: `Add tasks to TODO list - FIRST STEP for most programming tasks.

PARALLEL CALLS ONLY: MUST pair with other tools (todo-add + filesystem-read/etc).
NEVER call todo-add alone - always combine with an action tool.

WHEN TO USE (Very common):
- Start ANY multi-step task → Create TODO list immediately
- User adds new requirements → Add tasks for new work
- Break down complex work → Add subtasks

SUPPORTS BATCH ADDING:
- Single: content="Task description"
- Multiple: content=["Task 1", "Task 2", "Task 3"] (recommended for multi-step work)

EXAMPLE: todo-add(content=["Read file", "Modify code", "Test changes"]) + filesystem-read("file.ts")`,
				inputSchema: {
					type: 'object',
					properties: {
						content: {
							oneOf: [
								{
									type: 'string',
									description: 'Single TODO item description',
								},
								{
									type: 'array',
									items: {type: 'string'},
									description:
										'Multiple TODO item descriptions for batch adding',
								},
							],
							description:
								'TODO item description(s) - must be specific, actionable, and technically precise. Can be a single string or an array of strings.',
						},
						parentId: {
							type: 'string',
							description:
								'Parent TODO ID to create a subtask (optional). Get valid IDs from todo-get. When adding multiple tasks, all will be added under the same parent.',
						},
					},
					required: ['content'],
				},
			},
			{
				name: 'todo-delete',
				description: `Delete TODO item from the list.

PARALLEL CALLS ONLY: MUST pair with other tools (todo-delete + filesystem-edit/todo-get/etc).
NEVER call todo-delete alone - always combine with an action tool.

CASCADE DELETE: Deleting a parent task automatically deletes all its children.

BEST PRACTICE - KEEP TODO CLEAN:
Proactively delete obsolete, redundant, or overly detailed completed subtasks to maintain focus on current work.`,
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

					// 触发 TODO 更新事件，确保 UI 显示 TodoTree
					if (result && result.todos.length > 0) {
						todoEvents.emitTodoUpdate(sessionId, result.todos);
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
						content: string | string[];
						parentId?: string;
					};

					// 支持批量添加或单个添加
					if (Array.isArray(content)) {
						// 批量添加多个TODO项
						let currentList = await this.getTodoList(sessionId);
						for (const item of content) {
							currentList = await this.addTodoItem(sessionId, item, parentId);
						}
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify(currentList, null, 2),
								},
							],
						};
					} else {
						// 单个添加
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
