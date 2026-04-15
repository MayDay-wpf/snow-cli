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
	 * 批量更新多个 TODO 项
	 */
	async updateTodoItems(
		sessionId: string,
		todoIds: string[],
		updates: Partial<Omit<TodoItem, 'id' | 'createdAt'>>,
	): Promise<TodoList | null> {
		const todoList = await this.getTodoList(sessionId);
		if (!todoList) {
			return null;
		}

		const idSet = new Set(todoIds);
		const updatedAt = new Date().toISOString();
		let anyFound = false;

		todoList.todos = todoList.todos.map(t => {
			if (idSet.has(t.id)) {
				anyFound = true;
				return {...t, ...updates, updatedAt};
			}

			return t;
		});

		if (!anyFound) {
			return null;
		}

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
	 * 批量删除多个 TODO 项（含级联删除子项）
	 */
	async deleteTodoItems(
		sessionId: string,
		todoIds: string[],
	): Promise<TodoList | null> {
		const todoList = await this.getTodoList(sessionId);
		if (!todoList) {
			return null;
		}

		const idSet = new Set(todoIds);
		const filteredTodos = todoList.todos.filter(
			t => !idSet.has(t.id) && !idSet.has(t.parentId ?? ''),
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
	 * 获取所有工具定义（单一 todo-manage，通过 action 区分 get / add / update / delete）
	 */
	getTools(): Tool[] {
		return [
			{
				name: 'todo-manage',
				description: `Unified session TODO list: use required field "action" — one of get | add | update | delete.

PARALLEL CALLS ONLY: MUST pair with other tools (todo-manage + filesystem-read/terminal-execute/etc).
NEVER call todo-manage alone for any action — always combine with an action tool in the same turn.

ACTIONS:
- get: Current list with IDs, status, hierarchy. Use before add/update when you need existing IDs.
- add: Create item(s). Use "content" (string or string[]). Optional "parentId" for subtasks (valid parent id from get).
- update: Required "todoId" (string or string[]). Optional "status" (pending|inProgress|completed) and/or "content" (refined wording). Batch ids share the same updates.
- delete: Required "todoId" (string or string[]). Deleting a parent cascades to children.

BEST PRACTICES:
- Mark "completed" only after the step is verified; update as you work.
- Update each item immediately after it is done; do NOT finish all work first and batch-update at the end.
- Delete obsolete or redundant items to keep the list focused.

EXAMPLES:
- todo-manage({action:"get"}) + filesystem-read(...)
- todo-manage({action:"add", content:["Step 1","Step 2"]}) + filesystem-read(...)
- todo-manage({action:"update", todoId:"...", status:"completed"}) + filesystem-edit(...)`,
				inputSchema: {
					type: 'object',
					properties: {
						action: {
							type: 'string',
							enum: ['get', 'add', 'update', 'delete'],
							description:
								'Which operation to run on the current session TODO list.',
						},
						content: {
							oneOf: [
								{
									type: 'string',
									description:
										'For action=add: one TODO description. For action=update: optional new wording.',
								},
								{
									type: 'array',
									items: {type: 'string'},
									description:
										'For action=add only: batch add multiple TODO descriptions.',
								},
							],
							description:
								'For add: required (string or string[]). For update: optional text refinement.',
						},
						parentId: {
							type: 'string',
							description:
								'For action=add only: parent TODO id for subtasks (from action=get).',
						},
						todoId: {
							oneOf: [
								{
									type: 'string',
									description: 'Single TODO item id',
								},
								{
									type: 'array',
									items: {type: 'string'},
									description: 'Multiple ids (same update or delete applies to all)',
								},
							],
							description:
								'For action=update or delete: item id(s) from action=get.',
						},
						status: {
							type: 'string',
							enum: ['pending', 'inProgress', 'completed'],
							description: 'For action=update only.',
						},
					},
					required: ['action'],
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

		if (toolName !== 'manage') {
			return {
				content: [
					{
						type: 'text',
						text: `Unknown TODO tool: ${toolName}`,
					},
				],
				isError: true,
			};
		}

		const rawAction = args['action'];
		if (
			typeof rawAction !== 'string' ||
			!['get', 'add', 'update', 'delete'].includes(rawAction)
		) {
			return {
				content: [
					{
						type: 'text',
						text: 'Error: "action" must be one of: get, add, update, delete',
					},
				],
				isError: true,
			};
		}

		const action = rawAction as 'get' | 'add' | 'update' | 'delete';

		try {
			switch (action) {
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
						todoId: string | string[];
						status?: 'pending' | 'inProgress' | 'completed';
						content?: string;
					};

					if (todoId === undefined || todoId === null) {
						return {
							content: [
								{
									type: 'text',
									text: 'Error: action=update requires "todoId"',
								},
							],
							isError: true,
						};
					}

					const updates: Partial<Omit<TodoItem, 'id' | 'createdAt'>> = {};
					if (status) updates.status = status;
					if (content !== undefined && typeof content === 'string') {
						updates.content = content;
					}

					const ids = Array.isArray(todoId) ? todoId : [todoId];
					const result = await this.updateTodoItems(sessionId, ids, updates);
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
						content?: string | string[];
						parentId?: string;
					};

					if (content === undefined || content === null) {
						return {
							content: [
								{
									type: 'text',
									text: 'Error: action=add requires "content"',
								},
							],
							isError: true,
						};
					}

					// 智能解析 content：处理 JSON 字符串形式的数组
					let parsedContent: string | string[] = content;
					if (typeof content === 'string') {
						// 尝试解析为 JSON 数组
						try {
							const parsed = JSON.parse(content);
							if (Array.isArray(parsed)) {
								parsedContent = parsed;
							}
							// 如果解析结果不是数组，保持原字符串作为单个 TODO
						} catch {
							// 解析失败，保持原字符串
						}
					}

					// 支持批量添加或单个添加
					if (Array.isArray(parsedContent)) {
						// 批量添加多个TODO项
						let currentList = await this.getTodoList(sessionId);
						for (const item of parsedContent) {
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
						const result = await this.addTodoItem(
							sessionId,
							parsedContent,
							parentId,
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
				}

				case 'delete': {
					const {todoId} = args as {
						todoId?: string | string[];
					};

					if (todoId === undefined || todoId === null) {
						return {
							content: [
								{
									type: 'text',
									text: 'Error: action=delete requires "todoId"',
								},
							],
							isError: true,
						};
					}

					const ids = Array.isArray(todoId) ? todoId : [todoId];
					const result = await this.deleteTodoItems(sessionId, ids);
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
								text: `Unknown action: ${String(action)}`,
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
						text: `Error executing todo-manage (${action}): ${
							error instanceof Error ? error.message : String(error)
						}`,
					},
				],
				isError: true,
			};
		}
	}
}
