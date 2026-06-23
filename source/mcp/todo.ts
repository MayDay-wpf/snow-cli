import {Tool, type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
// Type definitions
import type {
	TodoItem,
	TodoList,
	GetCurrentSessionId,
	TodoPhase,
} from './types/todo.types.js';
// Utility functions
import {formatDateForFolder} from './utils/todo/date.utils.js';
import {recordTodoSnapshot} from './utils/todo/rollback.utils.js';
// Event emitter
import {todoEvents} from '../utils/events/todoEvents.js';
import {getConversationContext} from '../utils/codebase/conversationContext.js';

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
		const now = new Date().toISOString();
		let persistedList: TodoList | null = null;
		let baseList = existingList ?? null;

		if (!baseList) {
			baseList = await this.getTodoList(sessionId);
		}

		// 使用现有 TODO 列表的 createdAt 定位原始日期目录，避免跨天保存时新建空文件覆盖当前视图。
		const parsedCreatedAt = baseList?.createdAt
			? new Date(baseList.createdAt).getTime()
			: Date.now();
		const sessionCreatedAt = Number.isNaN(parsedCreatedAt)
			? Date.now()
			: parsedCreatedAt;
		const sessionDate = new Date(sessionCreatedAt);
		await this.ensureTodoDir(sessionDate);
		const todoPath = this.getTodoPath(sessionId, sessionDate);

		try {
			const content = await fs.readFile(todoPath, 'utf-8');
			persistedList = JSON.parse(content);
		} catch {
			// 文件不存在,创建新的
		}

		// 调用方传入的 existingList 可能已经在内存中更新过 phases/currentPhaseId。
		// 这里只能用磁盘内容补默认值，不能反向覆盖调用方的新状态，否则 todo-ultra 更新会把阶段列表重置为空。
		const metadataList: TodoList | null = baseList
			? persistedList
				? {...persistedList, ...baseList}
				: baseList
			: persistedList;

		const todoList: TodoList = {
			sessionId,
			todos,
			createdAt: metadataList?.createdAt ?? now,
			updatedAt: now,
			ultraMode: metadataList?.ultraMode,
			phases: metadataList?.phases,
			currentPhaseId: metadataList?.currentPhaseId,
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

	private createId(prefix: string): string {
		return `${prefix}-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
	}

	private createTextResult(value: unknown): CallToolResult {
		return {
			content: [
				{
					type: 'text',
					text:
						typeof value === 'string' ? value : JSON.stringify(value, null, 2),
				},
			],
		};
	}

	private createErrorResult(text: string): CallToolResult {
		return {
			content: [
				{
					type: 'text',
					text,
				},
			],
			isError: true,
		};
	}

	private async recordSnapshotBeforeMutation(sessionId: string): Promise<void> {
		try {
			const context = getConversationContext();
			if (context?.sessionId !== sessionId) {
				return;
			}

			recordTodoSnapshot(
				sessionId,
				context.messageIndex,
				await this.getTodoList(sessionId),
			);
		} catch {
			// Snapshot tracking is best-effort and must not block TODO mutations.
		}
	}

	async restoreTodoList(
		sessionId: string,
		todoList: TodoList | null,
	): Promise<void> {
		await this.deleteTodoList(sessionId);

		if (!todoList) {
			todoEvents.emitTodoUpdate(sessionId, []);
			return;
		}

		await this.saveTodoList(sessionId, todoList.todos, {
			...todoList,
			sessionId,
		});
	}

	private async getOrCreateTodoList(
		sessionId: string,
		ultraMode = false,
	): Promise<TodoList> {
		const existingList = await this.getTodoList(sessionId);
		if (!existingList) {
			const now = new Date().toISOString();
			return this.saveTodoList(sessionId, [], {
				sessionId,
				todos: [],
				createdAt: now,
				updatedAt: now,
				ultraMode,
				phases: ultraMode ? [] : undefined,
			});
		}

		if (ultraMode && !existingList.ultraMode) {
			return this.saveTodoList(sessionId, existingList.todos, {
				...existingList,
				ultraMode: true,
				phases: existingList.phases ?? [],
			});
		}

		return existingList;
	}

	private saveUltraTodoList(
		sessionId: string,
		todoList: TodoList,
	): Promise<TodoList> {
		return this.saveTodoList(sessionId, todoList.todos, {
			...todoList,
			ultraMode: true,
			phases: todoList.phases ?? [],
		});
	}

	private getPhaseTodos(todoList: TodoList, phaseId: string): TodoItem[] {
		return todoList.todos.filter(todo => todo.phaseId === phaseId);
	}

	private getIncompletePhaseTodos(
		todoList: TodoList,
		phaseId: string,
	): TodoItem[] {
		return this.getPhaseTodos(todoList, phaseId).filter(
			todo => todo.status !== 'completed',
		);
	}

	private findPhase(
		todoList: TodoList,
		phaseId: string,
	): TodoPhase | undefined {
		return todoList.phases?.find(phase => phase.id === phaseId);
	}

	private normalizeStringArray(value: unknown): string[] | null {
		if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
			return value.map(item => item.trim()).filter(Boolean);
		}

		if (typeof value === 'string') {
			try {
				const parsed = JSON.parse(value);
				if (
					Array.isArray(parsed) &&
					parsed.every(item => typeof item === 'string')
				) {
					return parsed.map(item => item.trim()).filter(Boolean);
				}
			} catch {
				return [value.trim()].filter(Boolean);
			}
		}

		return null;
	}

	private buildIncompletePhaseMessage(
		phase: TodoPhase,
		incompleteTodos: TodoItem[],
	): string {
		const items = incompleteTodos
			.map(todo => `- ${todo.id} [${todo.status}]: ${todo.content}`)
			.join('\n');
		return `Blocked: phase "${phase.title}" cannot advance because ${incompleteTodos.length} item(s) are not completed. Complete or update them first.\n${items}`;
	}

	private async executeUltraTodoTool(
		sessionId: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		const rawAction = args['action'];
		const allowedActions = [
			'get',
			'add_phase',
			'add_item',
			'update_item',
			'complete_phase',
			'advance_phase',
			'delete_item',
		];

		if (typeof rawAction !== 'string' || !allowedActions.includes(rawAction)) {
			return this.createErrorResult(
				'Error: "action" must be one of: get, add_phase, add_item, update_item, complete_phase, advance_phase, delete_item',
			);
		}

		try {
			const action = rawAction as (typeof allowedActions)[number];
			if (action !== 'get') {
				await this.recordSnapshotBeforeMutation(sessionId);
			}

			const todoList = await this.getOrCreateTodoList(sessionId, true);
			todoList.phases = todoList.phases ?? [];

			switch (action) {
				case 'get': {
					if (todoList.todos.length > 0) {
						todoEvents.emitTodoUpdate(sessionId, todoList.todos);
					}
					return this.createTextResult(todoList);
				}

				case 'add_phase': {
					const title =
						typeof args['title'] === 'string' ? args['title'].trim() : '';
					const items = this.normalizeStringArray(args['items']);

					if (!title) {
						return this.createErrorResult(
							'Error: action=add_phase requires "title"',
						);
					}

					if (!items || items.length === 0) {
						return this.createErrorResult(
							'Error: action=add_phase requires non-empty "items" so every phase is decomposed into concrete TODO items',
						);
					}

					const now = new Date().toISOString();
					const phaseId = this.createId('phase');
					const shouldBecomeCurrent = !todoList.currentPhaseId;
					const phase: TodoPhase = {
						id: phaseId,
						title,
						status: shouldBecomeCurrent ? 'inProgress' : 'pending',
						createdAt: now,
						updatedAt: now,
					};
					const phaseTodos: TodoItem[] = items.map(content => ({
						id: this.createId('todo'),
						content,
						status: 'pending',
						createdAt: now,
						updatedAt: now,
						phaseId,
					}));

					todoList.phases.push(phase);
					todoList.todos = [...todoList.todos, ...phaseTodos];
					if (shouldBecomeCurrent) {
						todoList.currentPhaseId = phaseId;
					}

					const result = await this.saveUltraTodoList(sessionId, todoList);
					return this.createTextResult(result);
				}

				case 'add_item': {
					const content =
						typeof args['content'] === 'string' ? args['content'].trim() : '';
					const phaseId =
						typeof args['phaseId'] === 'string' && args['phaseId'].trim()
							? args['phaseId'].trim()
							: todoList.currentPhaseId;
					const parentId =
						typeof args['parentId'] === 'string' && args['parentId'].trim()
							? args['parentId'].trim()
							: undefined;

					if (!content) {
						return this.createErrorResult(
							'Error: action=add_item requires "content"',
						);
					}

					if (!phaseId || !this.findPhase(todoList, phaseId)) {
						return this.createErrorResult(
							'Error: action=add_item requires a valid "phaseId" or an active current phase',
						);
					}

					const validatedParentId =
						parentId && todoList.todos.some(todo => todo.id === parentId)
							? parentId
							: undefined;
					const now = new Date().toISOString();
					todoList.todos.push({
						id: this.createId('todo'),
						content,
						status: 'pending',
						createdAt: now,
						updatedAt: now,
						parentId: validatedParentId,
						phaseId,
					});

					const result = await this.saveUltraTodoList(sessionId, todoList);
					return this.createTextResult(result);
				}

				case 'update_item': {
					const todoId = args['todoId'] as string | string[] | undefined;
					const status = args['status'] as
						| 'pending'
						| 'inProgress'
						| 'completed'
						| undefined;
					const content = args['content'];

					if (todoId === undefined || todoId === null) {
						return this.createErrorResult(
							'Error: action=update_item requires "todoId"',
						);
					}

					if (
						status !== undefined &&
						!['pending', 'inProgress', 'completed'].includes(status)
					) {
						return this.createErrorResult(
							'Error: "status" must be one of: pending, inProgress, completed',
						);
					}

					const ids = Array.isArray(todoId) ? todoId : [todoId];
					const idSet = new Set(ids);
					const updatedAt = new Date().toISOString();
					let anyFound = false;
					todoList.todos = todoList.todos.map(todo => {
						if (!idSet.has(todo.id)) {
							return todo;
						}
						anyFound = true;
						return {
							...todo,
							...(status ? {status} : {}),
							...(typeof content === 'string' ? {content} : {}),
							updatedAt,
						};
					});

					if (!anyFound) {
						return this.createTextResult('TODO item not found');
					}

					const result = await this.saveUltraTodoList(sessionId, todoList);
					return this.createTextResult(result);
				}

				case 'complete_phase': {
					const phaseId =
						typeof args['phaseId'] === 'string' && args['phaseId'].trim()
							? args['phaseId'].trim()
							: todoList.currentPhaseId;

					if (!phaseId) {
						return this.createErrorResult(
							'Error: action=complete_phase requires "phaseId" or an active current phase',
						);
					}

					const phase = this.findPhase(todoList, phaseId);
					if (!phase) {
						return this.createErrorResult(`Error: phase not found: ${phaseId}`);
					}

					const incompleteTodos = this.getIncompletePhaseTodos(
						todoList,
						phaseId,
					);
					if (incompleteTodos.length > 0) {
						return this.createErrorResult(
							this.buildIncompletePhaseMessage(phase, incompleteTodos),
						);
					}

					phase.status = 'completed';
					phase.updatedAt = new Date().toISOString();
					const result = await this.saveUltraTodoList(sessionId, todoList);
					return this.createTextResult(result);
				}

				case 'advance_phase': {
					const currentPhaseId = todoList.currentPhaseId;
					if (currentPhaseId) {
						const currentPhase = this.findPhase(todoList, currentPhaseId);
						if (!currentPhase) {
							return this.createErrorResult(
								`Error: current phase not found: ${currentPhaseId}`,
							);
						}

						const incompleteTodos = this.getIncompletePhaseTodos(
							todoList,
							currentPhaseId,
						);
						if (incompleteTodos.length > 0) {
							return this.createErrorResult(
								this.buildIncompletePhaseMessage(currentPhase, incompleteTodos),
							);
						}

						currentPhase.status = 'completed';
						currentPhase.updatedAt = new Date().toISOString();
					}

					const requestedNextPhaseId =
						typeof args['nextPhaseId'] === 'string' &&
						args['nextPhaseId'].trim()
							? args['nextPhaseId'].trim()
							: undefined;
					const nextPhase = requestedNextPhaseId
						? this.findPhase(todoList, requestedNextPhaseId)
						: todoList.phases.find(phase => phase.status !== 'completed');

					if (requestedNextPhaseId && !nextPhase) {
						return this.createErrorResult(
							`Error: next phase not found: ${requestedNextPhaseId}`,
						);
					}

					if (nextPhase) {
						nextPhase.status = 'inProgress';
						nextPhase.updatedAt = new Date().toISOString();
						todoList.currentPhaseId = nextPhase.id;
					} else {
						todoList.currentPhaseId = undefined;
					}

					const result = await this.saveUltraTodoList(sessionId, todoList);
					return this.createTextResult(result);
				}

				case 'delete_item': {
					const todoId = args['todoId'] as string | string[] | undefined;
					if (todoId === undefined || todoId === null) {
						return this.createErrorResult(
							'Error: action=delete_item requires "todoId"',
						);
					}

					const ids = Array.isArray(todoId) ? todoId : [todoId];
					const idSet = new Set(ids);
					todoList.todos = todoList.todos.filter(
						todo => !idSet.has(todo.id) && !idSet.has(todo.parentId ?? ''),
					);
					const result = await this.saveUltraTodoList(sessionId, todoList);
					return this.createTextResult(result);
				}

				default:
					return this.createErrorResult(`Unknown action: ${String(action)}`);
			}
		} catch (error) {
			return this.createErrorResult(
				`Error executing ultra-todo (${rawAction}): ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
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

		// 保存到新会话，并保留 ultra TODO 的阶段元数据。
		return this.saveTodoList(toSessionId, copiedTodos, {
			...sourceTodoList,
			sessionId: toSessionId,
			createdAt: now,
			updatedAt: now,
		});
	}

	/**
	 * 删除整个会话的 TODO 列表
	 */
	async deleteTodoList(sessionId: string): Promise<boolean> {
		let deleted = false;

		// 首先尝试删除旧格式（向下兼容）
		try {
			const oldTodoPath = path.join(this.todoDir, `${sessionId}.json`);
			await fs.unlink(oldTodoPath);
			deleted = true;
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
						deleted = true;
					} catch (error) {
						// 文件不存在，继续搜索
						continue;
					}
				}
			}
		} catch (error) {
			// 目录读取失败
		}

		return deleted;
	}

	/**
	 * 获取所有工具定义（单一 todo-manage，通过 action 区分 get / add / update / delete）
	 */
	getTools(ultraMode = false): Tool[] {
		if (ultraMode) {
			return [
				{
					name: 'todo-ultra',
					description: `Ultra TODO session planner: use required field "action" — one of get | add_phase | add_item | update_item | complete_phase | advance_phase | delete_item.

Ultra TODO is stricter than todo-manage. Every requirement phase MUST be decomposed into concrete TODO items. Before advancing to the next phase, the current phase is automatically checked; if any item is not completed, the tool blocks advancement and returns the incomplete items.

ACTIONS:
- get: Current ultra TODO state with phases, currentPhaseId, and items.
- add_phase: Create a phase and its decomposed TODO items. Required: "title" and non-empty "items" (string[] or JSON string array).
- add_item: Add one item to a phase. Required: "content" and a valid "phaseId" unless there is an active current phase. Optional "parentId".
- update_item: Update item status/content. Required "todoId" (string or string[]). Optional "status" (pending|inProgress|completed) and/or "content".
- complete_phase: Mark a phase completed only if all its items are completed. Optional "phaseId"; defaults to current phase.
- advance_phase: Move from current phase to the next phase. Blocks if current phase has incomplete items. Optional "nextPhaseId".
- delete_item: Delete item(s), cascading direct children. Required "todoId" (string or string[]).

IMPORTANT:
- Do not start a new phase until advance_phase succeeds.
- If advance_phase or complete_phase is blocked, update every listed incomplete item before trying again.
- In Ultra TODO mode, the legacy todo-manage tool is not available.
- Update each TODO item's status IMMEDIATELY after completing it — do NOT batch multiple updates at the end. Completing several steps first and then doing one bulk status update is strictly forbidden.
- Before finishing, you MUST complete ALL phases and mark every TODO item completed, keeping the list status fully up to date — never end the session with pending or incomplete items left behind.`,
					inputSchema: {
						type: 'object',
						properties: {
							action: {
								type: 'string',
								enum: [
									'get',
									'add_phase',
									'add_item',
									'update_item',
									'complete_phase',
									'advance_phase',
									'delete_item',
								],
								description: 'Which Ultra TODO operation to run.',
							},
							title: {
								type: 'string',
								description: 'For action=add_phase: phase title.',
							},
							items: {
								oneOf: [
									{type: 'array', items: {type: 'string'}},
									{type: 'string'},
								],
								description:
									'For action=add_phase: required decomposed items as string[] or JSON string array.',
							},
							phaseId: {
								type: 'string',
								description:
									'For add_item/complete_phase: target phase id. Defaults to current phase where applicable.',
							},
							nextPhaseId: {
								type: 'string',
								description:
									'For action=advance_phase: optional explicit next phase id.',
							},
							content: {
								type: 'string',
								description:
									'For add_item: item content. For update_item: optional updated content.',
							},
							parentId: {
								type: 'string',
								description: 'For action=add_item: optional parent TODO id.',
							},
							todoId: {
								oneOf: [
									{type: 'string'},
									{type: 'array', items: {type: 'string'}},
								],
								description:
									'For update_item/delete_item: item id(s) from action=get.',
							},
							status: {
								type: 'string',
								enum: ['pending', 'inProgress', 'completed'],
								description: 'For action=update_item only.',
							},
						},
						required: ['action'],
					},
				},
			];
		}

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
									description:
										'Multiple ids (same update or delete applies to all)',
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

		if (toolName === 'ultra' || toolName === 'ultra-todo') {
			return this.executeUltraTodoTool(sessionId, args);
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
			if (action !== 'get') {
				await this.recordSnapshotBeforeMutation(sessionId);
			}

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
