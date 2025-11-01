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

		const newTodo: TodoItem = {
			id: `todo-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
			content,
			status: 'pending',
			createdAt: now,
			updatedAt: now,
			parentId,
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
				name: 'todo-create',
				description: `Create a TODO list for complex multi-step tasks (optional planning tool).

## CORE PRINCIPLE - FOCUS ON EXECUTION:
TODO lists are OPTIONAL helpers for complex tasks. Your PRIMARY goal is COMPLETING THE WORK, not maintaining perfect TODO lists. Use this tool only when it genuinely helps organize complex work - don't let TODO management slow you down.

## WHEN TO USE (Optional):
- Complex tasks with 5+ distinct steps that benefit from tracking
- Long-running tasks where progress visibility helps the user
- Tasks with multiple dependencies that need careful ordering
- User explicitly requests a TODO list

## WHEN TO SKIP:
- Simple 1-3 step tasks (just do the work directly)
- Straightforward file edits or single-function changes
- Quick fixes or minor modifications
- When TODO creation takes longer than just doing the task

## LIFECYCLE MANAGEMENT:
1. **NEW REQUEST = NEW TODO LIST**: Completely new requirement? Delete old todos first, then create new list.
2. **INCREMENTAL REQUEST = USE TODO-ADD**: Adding to existing requirement? Use "todo-add" instead.
3. Use this tool ONLY when starting fresh (new session or new requirement after cleanup).

## CREATION GUIDELINES:
- Keep it simple and actionable
- 3-7 main tasks is usually sufficient (don't over-plan)
- Include verification steps only if critical
- Order by dependencies

## WARNING:
This REPLACES the entire TODO list. Never use it to "add more tasks" - use "todo-add" instead.`,
				inputSchema: {
					type: 'object',
					properties: {
						todos: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									content: {
										type: 'string',
										description:
											'TODO item description - must be specific, actionable, and technically precise (e.g., "Modify handleSubmit function in ChatInput.tsx to validate user input before processing" NOT "fix input validation")',
									},
									parentId: {
										type: 'string',
										description:
											'Parent TODO ID (optional, for creating subtasks in hierarchical structure)',
									},
								},
								required: ['content'],
							},
							description:
								'Complete list of TODO items. Each item must represent a discrete, verifiable unit of work. For programming tasks, typical structure: analyze code → implement changes → test functionality → verify build → commit (if requested).',
						},
					},
					required: ['todos'],
				},
			},
			{
				name: 'todo-get',
				description: `Get current TODO list with task IDs, status, and hierarchy. Call with other tools in parallel when needed.`,
				inputSchema: {
					type: 'object',
					properties: {},
				},
			},
			{
				name: 'todo-update',
				description: `Update TODO status/content. MUST call with other tools - mark "completed" ONLY after task is verified and done.`,

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
				description: `Add task to existing TODO (rare use). MUST call with other tools. Only for user-requested or complex tasks, not small steps.`,
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
				description: `Delete TODO item. MUST call with other tools. Deleting parent auto-deletes children (cascade).`,
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
				case 'create': {
					const {todos} = args as {
						todos: Array<{content: string; parentId?: string}>;
					};

					const todoItems: TodoItem[] = todos.map(t => {
						const now = new Date().toISOString();
						return {
							id: `todo-${Date.now()}_${Math.random()
								.toString(36)
								.slice(2, 9)}`,
							content: t.content,
							status: 'pending' as const,
							createdAt: now,
							updatedAt: now,
							parentId: t.parentId,
						};
					});

					const existingList = await this.getTodoList(sessionId);
					const result = await this.saveTodoList(
						sessionId,
						todoItems,
						existingList,
					);
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				case 'get': {
					const result = await this.getTodoList(sessionId);
					return {
						content: [
							{
								type: 'text',
								text: result
									? JSON.stringify(result, null, 2)
									: 'No TODO list found',
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
