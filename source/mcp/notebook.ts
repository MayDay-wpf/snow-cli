import {Tool, type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {
	addNotebook,
	queryNotebook,
	updateNotebook,
	deleteNotebook,
	getNotebooksByFile,
	findNotebookById,
	recordNotebookAddition,
	recordNotebookUpdate,
	recordNotebookDeletion,
} from '../utils/core/notebookManager.js';
import {getConversationContext} from '../utils/codebase/conversationContext.js';

/**
 * Notebook MCP 工具定义
 * 用于代码备忘录管理，帮助AI记录重要的代码注意事项
 */
export const mcpTools: Tool[] = [
	{
		name: 'notebook-manage',
		description: `📝 Unified notebook management tool. Use required "action" field to operate code memory.

**Core Purpose:** Prevent new features from breaking existing functionality.

**Actions:**
- query: Search entries by fuzzy file path pattern (default action to discover notes)
- list: List all entries for one exact file path
- add: Record a new note for a file
- update: Update existing note by notebookId
- delete: Delete outdated note by notebookId

**When to add notes:**
- After fixing bugs that could easily reoccur
- Fragile code that new features might break
- Non-obvious dependencies between components
- Workarounds that shouldn't be "optimized away"

**Examples:**
- "⚠️ validateInput() MUST be called first - new features broke this twice"
- "Component X depends on null return - DO NOT change to empty array"
- "setTimeout workaround for race condition - don't remove"
- "Parser expects exact format - adding fields breaks backward compat"`,
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['query', 'list', 'add', 'update', 'delete'],
					description:
						'Operation to run: query | list | add | update | delete.',
				},
				filePath: {
					type: 'string',
					description:
						'For action=add/list: file path (relative or absolute).',
				},
				filePathPattern: {
					type: 'string',
					description:
						'For action=query: fuzzy file path search pattern; empty means all.',
					default: '',
				},
				topN: {
					type: 'number',
					description:
						'For action=query: max results (default: 10, max: 50).',
					default: 10,
					minimum: 1,
					maximum: 50,
				},
				notebookId: {
					type: 'string',
					description:
						'For action=update/delete: notebook entry ID (from query/list).',
				},
				note: {
					type: 'string',
					description:
						'For action=add/update: brief and specific risk/constraint note.',
				},
			},
			required: ['action'],
		},
	},
];

/**
 * 执行 Notebook 工具
 */
export async function executeNotebookTool(
	toolName: string,
	args: any,
): Promise<CallToolResult> {
	try {
		// Backward compatibility: old names map to action
		const legacyActionMap: Record<string, string> = {
			'notebook-add': 'add',
			'notebook-query': 'query',
			'notebook-update': 'update',
			'notebook-delete': 'delete',
			'notebook-list': 'list',
		};
		const action =
			(typeof args?.action === 'string' && args.action) ||
			legacyActionMap[toolName] ||
			(toolName === 'manage' || toolName === 'notebook-manage'
				? ''
				: undefined);

		if (!action || !['query', 'list', 'add', 'update', 'delete'].includes(action)) {
			return {
				content: [
					{
						type: 'text',
						text: 'Error: "action" must be one of: query, list, add, update, delete',
					},
				],
				isError: true,
			};
		}

		switch (action) {
			case 'add': {
				const {filePath, note} = args;
				if (!filePath || !note) {
					return {
						content: [
							{
								type: 'text',
								text: 'Error: Both filePath and note are required',
							},
						],
						isError: true,
					};
				}

				const entry = addNotebook(filePath, note);

				// 记录 notebook 添加到快照追踪（用于会话回滚时同步删除）
				try {
					const context = getConversationContext();
					if (context) {
						recordNotebookAddition(
							context.sessionId,
							context.messageIndex,
							entry.id,
						);
					}
				} catch {
					// 不影响主流程
				}

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									success: true,
									message: `Notebook entry added for: ${entry.filePath}`,
									entry: {
										id: entry.id,
										filePath: entry.filePath,
										note: entry.note,
										createdAt: entry.createdAt,
									},
								},
								null,
								2,
							),
						},
					],
				};
			}

			case 'query': {
				const {filePathPattern = '', topN = 10} = args;
				const results = queryNotebook(filePathPattern, topN);

				if (results.length === 0) {
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										message: 'No notebook entries found',
										pattern: filePathPattern || '(all)',
										totalResults: 0,
									},
									null,
									2,
								),
							},
						],
					};
				}

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									message: `Found ${results.length} notebook entries`,
									pattern: filePathPattern || '(all)',
									totalResults: results.length,
									entries: results.map(entry => ({
										id: entry.id,
										filePath: entry.filePath,
										note: entry.note,
										createdAt: entry.createdAt,
									})),
								},
								null,
								2,
							),
						},
					],
				};
			}

			case 'update': {
				const {notebookId, note} = args;
				if (!notebookId || !note) {
					return {
						content: [
							{
								type: 'text',
								text: 'Error: Both notebookId and note are required',
							},
						],
						isError: true,
					};
				}

				// 更新前先获取旧内容，用于回滚
				const previousEntry = findNotebookById(notebookId);
				const previousNote = previousEntry?.note;

				const updatedEntry = updateNotebook(notebookId, note);
				if (!updatedEntry) {
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: false,
										message: `Notebook entry not found: ${notebookId}`,
									},
									null,
									2,
								),
							},
						],
						isError: true,
					};
				}

				// 记录 notebook 更新到快照追踪（用于会话回滚时恢复旧内容）
				try {
					const context = getConversationContext();
					if (context && previousNote !== undefined) {
						recordNotebookUpdate(
							context.sessionId,
							context.messageIndex,
							notebookId,
							previousNote,
						);
					}
				} catch {
					// 不影响主流程
				}

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									success: true,
									message: `Notebook entry updated: ${notebookId}`,
									entry: {
										id: updatedEntry.id,
										filePath: updatedEntry.filePath,
										note: updatedEntry.note,
										updatedAt: updatedEntry.updatedAt,
									},
								},
								null,
								2,
							),
						},
					],
				};
			}

			case 'delete': {
				const {notebookId} = args;
				if (!notebookId) {
					return {
						content: [
							{
								type: 'text',
								text: 'Error: notebookId is required',
							},
						],
						isError: true,
					};
				}

				// 删除前先获取完整条目，用于回滚时恢复
				const entryToDelete = findNotebookById(notebookId);

				const deleted = deleteNotebook(notebookId);
				if (!deleted) {
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: false,
										message: `Notebook entry not found: ${notebookId}`,
									},
									null,
									2,
								),
							},
						],
						isError: true,
					};
				}

				// 记录 notebook 删除到快照追踪（用于会话回滚时恢复）
				try {
					const context = getConversationContext();
					if (context && entryToDelete) {
						recordNotebookDeletion(
							context.sessionId,
							context.messageIndex,
							entryToDelete,
						);
					}
				} catch {
					// 不影响主流程
				}

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									success: true,
									message: `Notebook entry deleted: ${notebookId}`,
								},
								null,
								2,
							),
						},
					],
				};
			}

			case 'list': {
				const {filePath} = args;
				if (!filePath) {
					return {
						content: [
							{
								type: 'text',
								text: 'Error: filePath is required',
							},
						],
						isError: true,
					};
				}

				const entries = getNotebooksByFile(filePath);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									message:
										entries.length > 0
											? `Found ${entries.length} notebook entries for: ${filePath}`
											: `No notebook entries found for: ${filePath}`,
									filePath,
									totalEntries: entries.length,
									entries: entries.map(entry => ({
										id: entry.id,
										note: entry.note,
										createdAt: entry.createdAt,
										updatedAt: entry.updatedAt,
									})),
								},
								null,
								2,
							),
						},
					],
				};
			}

			default:
				return {
					content: [
						{
							type: 'text',
							text: `Unknown notebook action: ${String(action)}`,
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
					text: `Error executing notebook-manage: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}
