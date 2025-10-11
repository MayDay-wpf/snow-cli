import { Tool, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';

interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'completed';
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
		await fs.mkdir(this.todoDir, { recursive: true });
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
										description: 'TODO item description - must be specific, actionable, and technically precise (e.g., "Modify handleSubmit function in ChatInput.tsx to validate user input before processing" NOT "fix input validation")',
									},
									parentId: {
										type: 'string',
										description: 'Parent TODO ID (optional, for creating subtasks in hierarchical structure)',
									},
								},
								required: ['content'],
							},
							description: 'Complete list of TODO items. Each item must represent a discrete, verifiable unit of work. For programming tasks, typical structure: analyze code → implement changes → test functionality → verify build → commit (if requested).',
						},
					},
					required: ['todos'],
				},
			},
			{
				name: 'todo-get',
				description: `Get the current TODO list for this session.

## WHEN TO USE:
- Before making any updates to check current task status and IDs
- To verify what tasks exist before deciding to add/delete/update
- To inspect the TODO structure before planning next steps

## RETURNS:
Complete TODO list with all task IDs, content, status, and hierarchy.`,
				inputSchema: {
					type: 'object',
					properties: {},
				},
			},
			{
				name: 'todo-update',
				description: `Update TODO status or content - USE ONLY WHEN COMPLETING TASKS.

## CORE PRINCIPLE - WORK FIRST, completed in an orderly manner:

## STATUS MODEL:
- **pending**: Task not yet completed (default)
- **completed**: Task is 100% finished and verified

## WHEN TO UPDATE:
✅ **Mark "completed"** ONLY when:
  - When completing a task in the List
  - No errors or blockers
  - You've actually verified it works

## WHEN NOT TO UPDATE:
❌ Don't update status to track "in progress" - just do the work
❌ Don't update before verifying the work is complete

## BEST PRACTICE:
Every time you complete a task in Task, it will be updated to "Completed" immediately.`,


				inputSchema: {
					type: 'object',
					properties: {
						todoId: {
							type: 'string',
							description: 'TODO item ID to update (get exact ID from todo-get)',
						},
						status: {
							type: 'string',
							enum: ['pending', 'completed'],
							description: 'New status - "pending" (not done) or "completed" (100% finished and verified)',
						},

						content: {
							type: 'string',
							description: 'Updated TODO content (optional, only if task description needs refinement)',
						},
					},
					required: ['todoId'],
				},
			},
			{
				name: 'todo-add',
				description: `Add tasks to existing TODO list (use sparingly).

## CORE PRINCIPLE - AVOID TODO BLOAT:
Don't constantly add TODO items while working. If you discover small steps during execution, JUST DO THEM instead of creating TODO items. Only add to TODO if it's genuinely complex or user-requested.

## WHEN TO USE (Rare):
1. **User Adds Requirements**: User explicitly requests additional tasks
2. **Major Discovery**: You find a significant, complex step that wasn't initially planned
3. **Blocking Issue**: You discover a prerequisite that requires substantial separate work

## WHEN NOT TO USE (Common):
- ❌ Discovered a small 5-minute task while working (just do it, don't track it)
- ❌ Breaking down an existing task into micro-steps (over-planning)
- ❌ "Organizing" or "clarifying" existing tasks (maintain original structure)
- ❌ New unrelated requirement (use todo-delete + todo-create instead)

## GUIDELINE:
If a task takes less than 10 minutes, just do it instead of adding it to TODO. The goal is progress, not perfect tracking.`,
				inputSchema: {
					type: 'object',
					properties: {
						content: {
							type: 'string',
							description: 'TODO item description - must be specific, actionable, and technically precise',
						},
						parentId: {
							type: 'string',
							description: 'Parent TODO ID to create a subtask (optional). Get valid IDs from todo-get.',
						},
					},
					required: ['content'],
				},
			},
			{
				name: 'todo-delete',
				description: `Delete TODO items from the current session.

## WHEN TO USE:
1. **Task No Longer Needed**: Requirement changed, task became irrelevant
2. **Mistake Correction**: Task was added by error or duplicated
3. **Clearing for New Requirement**: User provides COMPLETELY NEW requirement - delete all old todos first, then create new list
4. **Cascade Deletion**: Delete parent task with subtasks (automatically removes children)

## LIFECYCLE PATTERN FOR NEW REQUIREMENTS:
When user asks for something completely different:
1. Use todo-get to see current list
2. Use todo-delete on root items (children auto-delete via parentId cascade)
3. Use todo-create for the new requirement

## WHEN NOT TO USE:
- Do NOT delete completed tasks just for "cleanup" (keep as history)
- Do NOT delete in-progress tasks unless requirement truly changed
- Do NOT use for "reorganizing" (maintain original structure)

## CASCADE BEHAVIOR:
Deleting a parent task automatically deletes all its subtasks (parentId relationship).`,
				inputSchema: {
					type: 'object',
					properties: {
						todoId: {
							type: 'string',
							description: 'TODO item ID to delete. Deleting a parent will cascade delete all its children. Get exact ID from todo-get.',
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
					const { todos } = args as {
						todos: Array<{ content: string; parentId?: string }>;
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
					const { todoId, status, content } = args as {
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
								text: result ? JSON.stringify(result, null, 2) : 'TODO item not found',
							},
						],
					};
				}

				case 'todo-add': {
					const { content, parentId } = args as {
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
					const { todoId } = args as {
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
