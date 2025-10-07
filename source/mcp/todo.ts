import {Tool, type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';

interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
	createdAt: string;
	updatedAt: string;
	parentId?: string;
}

interface TodoList {
	sessionId: string;
	todos: TodoItem[];
	createdAt: string;
	updatedAt: string;
}

// 回调函数类型,用于获取当前 sessionId
type GetCurrentSessionId = () => string | null;

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

	private getTodoPath(sessionId: string): string {
		return path.join(this.todoDir, `${sessionId}.json`);
	}

	/**
	 * 创建或更新会话的 TODO List
	 */
	async saveTodoList(sessionId: string, todos: TodoItem[]): Promise<TodoList> {
		const todoPath = this.getTodoPath(sessionId);
		let existingList: TodoList | undefined;

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
		const todoPath = this.getTodoPath(sessionId);
		try {
			const content = await fs.readFile(todoPath, 'utf-8');
			return JSON.parse(content);
		} catch {
			return null;
		}
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

		return this.saveTodoList(sessionId, todoList.todos);
	}

	/**
	 * 添加 TODO 项
	 */
	async addTodoItem(sessionId: string, content: string, parentId?: string): Promise<TodoList> {
		const todoList = await this.getTodoList(sessionId);
		const now = new Date().toISOString();

		const newTodo: TodoItem = {
			id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
			content,
			status: 'pending',
			createdAt: now,
			updatedAt: now,
			parentId,
		};

		const todos = todoList ? [...todoList.todos, newTodo] : [newTodo];
		return this.saveTodoList(sessionId, todos);
	}

	/**
	 * 删除 TODO 项
	 */
	async deleteTodoItem(sessionId: string, todoId: string): Promise<TodoList | null> {
		const todoList = await this.getTodoList(sessionId);
		if (!todoList) {
			return null;
		}

		const filteredTodos = todoList.todos.filter(t => t.id !== todoId && t.parentId !== todoId);
		return this.saveTodoList(sessionId, filteredTodos);
	}

	/**
	 * 获取所有工具定义
	 */
	getTools(): Tool[] {
		return [
			{
				name: 'todo-create',
				description: 'Create a TODO list for current session. CRITICAL FOR PROGRAMMING TASKS: You MUST use this tool at the start of ANY programming task (bug fixes, new features, refactoring, optimization, etc.) to break down the work into trackable steps. This ensures systematic execution and prevents missing critical steps. The TODO list helps maintain context and provides clear progress visibility to the user. WARNING: This tool creates/replaces the entire TODO list for the session - use it ONLY ONCE at the beginning. To add more tasks later, use "todo-add" instead.',
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
										description: 'TODO item description (be specific and actionable)',
									},
									parentId: {
										type: 'string',
										description: 'Parent TODO ID (optional, for creating subtasks)',
									},
								},
								required: ['content'],
							},
							description: 'List of TODO items to create. For programming tasks, include steps like: analyze requirements, implement changes, test functionality, verify build, etc. The list can contain multiple tasks that will be tracked and executed sequentially.',
						},
					},
					required: ['todos'],
				},
			},
			{
				name: 'todo-get',
				description: 'Get the TODO list for current session. Use this to check existing tasks and their status before making updates.',
				inputSchema: {
					type: 'object',
					properties: {},
				},
			},
			{
				name: 'todo-update',
				description: 'Update TODO item status or content. IMPORTANT: Mark task as "in_progress" BEFORE starting work, and "completed" IMMEDIATELY after finishing. Keep exactly ONE task in "in_progress" status at any time. This provides real-time progress feedback to the user.',
				inputSchema: {
					type: 'object',
					properties: {
						todoId: {
							type: 'string',
							description: 'TODO item ID to update',
						},
						status: {
							type: 'string',
							enum: ['pending', 'in_progress', 'completed'],
							description: 'New status: "in_progress" when starting, "completed" when done, "pending" for not started',
						},
						content: {
							type: 'string',
							description: 'Updated TODO content (optional)',
						},
					},
					required: ['todoId'],
				},
			},
			{
				name: 'todo-add',
				description: 'Add a new TODO item to current session. Use this when you discover additional steps during execution, or when breaking down complex tasks into smaller subtasks.',
				inputSchema: {
					type: 'object',
					properties: {
						content: {
							type: 'string',
							description: 'TODO item description (be specific and actionable)',
						},
						parentId: {
							type: 'string',
							description: 'Parent TODO ID (optional, for creating subtasks)',
						},
					},
					required: ['content'],
				},
			},
			{
				name: 'todo-delete',
				description: 'Delete a TODO item from current session. Use this to remove tasks that are no longer relevant or were created by mistake.',
				inputSchema: {
					type: 'object',
					properties: {
						todoId: {
							type: 'string',
							description: 'TODO item ID to delete',
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
	async executeTool(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
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
				case 'todo-create': {
					const {todos} = args as {
						todos: Array<{content: string; parentId?: string}>;
					};

					const todoItems: TodoItem[] = todos.map(t => {
						const now = new Date().toISOString();
						return {
							id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
							content: t.content,
							status: 'pending' as const,
							createdAt: now,
							updatedAt: now,
							parentId: t.parentId,
						};
					});

					const result = await this.saveTodoList(sessionId, todoItems);
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				case 'todo-get': {
					const result = await this.getTodoList(sessionId);
					return {
						content: [
							{
								type: 'text',
								text: result ? JSON.stringify(result, null, 2) : 'No TODO list found',
							},
						],
					};
				}

				case 'todo-update': {
					const {todoId, status, content} = args as {
						todoId: string;
						status?: 'pending' | 'in_progress' | 'completed';
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
								text: result ? JSON.stringify(result, null, 2) : 'TODO item not found',
							},
						],
					};
				}

				case 'todo-add': {
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

				case 'todo-delete': {
					const {todoId} = args as {
						todoId: string;
					};

					const result = await this.deleteTodoItem(sessionId, todoId);
					return {
						content: [
							{
								type: 'text',
								text: result ? JSON.stringify(result, null, 2) : 'TODO item not found',
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
						text: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				isError: true,
			};
		}
	}
}
