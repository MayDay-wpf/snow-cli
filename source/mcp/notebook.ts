import {Tool, type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {
	addNotebook,
	addNotebooks,
	queryNotebook,
	updateNotebook,
	deleteNotebook,
	deleteNotebooks,
	getNotebooksByFile,
	findNotebookById,
	recordNotebookAddition,
	recordNotebookUpdate,
	recordNotebookDeletion,
} from '../utils/core/notebookManager.js';
import {getConversationContext} from '../utils/codebase/conversationContext.js';

/**
 * Notebook MCP 工具定义
 * 单一批量管理工具，参考 todo-manage 模式
 */
export const mcpTools: Tool[] = [
	{
		name: 'notebook-manage',
		description: `Unified notebook management tool. Use required field "action" — one of query | list | add | update | delete.

PARALLEL CALLS ONLY: MUST pair with other tools (notebook-manage + filesystem-read/terminal-execute/etc).
NEVER call notebook-manage alone — always combine with an action tool in the same turn.

ACTIONS:
- query: Search entries by fuzzy file path pattern. Optional "filePathPattern" and "topN".
- list: List all entries for one exact file path. Required "filePath".
- add: Record note(s) for a file. Required "filePath" and "note" (string or string[]). Batch adds share the same filePath.
- update: Update note by ID. Required "notebookId" and "note".
- delete: Remove note(s) by ID. Required "notebookId" (string or string[]).

BEST PRACTICES:
- After fixing non-trivial bugs, record what caused it and why the fix works.
- When discovering fragile dependencies or hidden coupling, record immediately.
- When an existing note is outdated or incorrect, update/delete it immediately — do NOT leave stale notes.
- Use query before modifying code to recall relevant notes.

EXAMPLES:
- notebook-manage({action:"query", filePathPattern:"auth"}) + filesystem-read(...)
- notebook-manage({action:"add", filePath:"src/auth.ts", note:["validateInput() MUST be called first","Session token is nullable"]}) + filesystem-edit(...)
- notebook-manage({action:"delete", notebookId:["id1","id2"]}) + filesystem-edit(...)`,
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['query', 'list', 'add', 'update', 'delete'],
					description:
						'Which operation to run on the notebook.',
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
					oneOf: [
						{
							type: 'string',
							description: 'Single notebook entry ID',
						},
						{
							type: 'array',
							items: {type: 'string'},
							description: 'Multiple IDs (same delete applies to all)',
						},
					],
					description:
						'For action=update or delete: entry id(s) from action=query/list.',
				},
				note: {
					oneOf: [
						{
							type: 'string',
							description:
								'For action=add: one note. For action=update: new note content.',
						},
						{
							type: 'array',
							items: {type: 'string'},
							description:
								'For action=add only: batch add multiple notes for the same file.',
						},
					],
					description:
						'For add: required (string or string[]). For update: required string.',
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
				if (!filePath || note === undefined || note === null) {
					return {
						content: [
							{
								type: 'text',
								text: 'Error: action=add requires both "filePath" and "note"',
							},
						],
						isError: true,
					};
				}

				// 智能解析 note：处理 JSON 字符串形式的数组
				let parsedNote: string | string[] = note;
				if (typeof note === 'string') {
					try {
						const parsed = JSON.parse(note);
						if (Array.isArray(parsed)) {
							parsedNote = parsed;
						}
					} catch {
						// 保持原字符串
					}
				}

				if (Array.isArray(parsedNote)) {
					const entries = addNotebooks(filePath, parsedNote);

					try {
						const context = getConversationContext();
						if (context) {
							for (const entry of entries) {
								recordNotebookAddition(
									context.sessionId,
									context.messageIndex,
									entry.id,
								);
							}
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
										message: `${entries.length} notebook entries added for: ${entries[0]?.filePath ?? filePath}`,
										entries: entries.map(e => ({
											id: e.id,
											filePath: e.filePath,
											note: e.note,
											createdAt: e.createdAt,
										})),
									},
									null,
									2,
								),
							},
						],
					};
				}

				const entry = addNotebook(filePath, parsedNote);

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
				if (!notebookId || !note || typeof note !== 'string') {
					return {
						content: [
							{
								type: 'text',
								text: 'Error: action=update requires "notebookId" (string) and "note" (string)',
							},
						],
						isError: true,
					};
				}

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
				if (notebookId === undefined || notebookId === null) {
					return {
						content: [
							{
								type: 'text',
								text: 'Error: action=delete requires "notebookId"',
							},
						],
						isError: true,
					};
				}

				const ids = Array.isArray(notebookId) ? notebookId : [notebookId];

				// 批量删除前先获取完整条目用于回滚
				const entriesToDelete = ids
					.map(id => findNotebookById(id))
					.filter((e): e is NonNullable<typeof e> => e !== null);

				const result = ids.length === 1
					? (() => {
						const deleted = deleteNotebook(ids[0]!);
						return {
							deleted: deleted ? [ids[0]!] : [],
							notFound: deleted ? [] : [ids[0]!],
						};
					})()
					: deleteNotebooks(ids);

				// 记录删除到快照追踪
				try {
					const context = getConversationContext();
					if (context) {
						for (const entry of entriesToDelete) {
							if (result.deleted.includes(entry.id)) {
								recordNotebookDeletion(
									context.sessionId,
									context.messageIndex,
									entry,
								);
							}
						}
					}
				} catch {
					// 不影响主流程
				}

				if (result.deleted.length === 0) {
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(
									{
										success: false,
										message: `Notebook entries not found: ${result.notFound.join(', ')}`,
									},
									null,
									2,
								),
							},
						],
						isError: true,
					};
				}

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									success: true,
									message: `${result.deleted.length} notebook entries deleted`,
									deleted: result.deleted,
									...(result.notFound.length > 0
										? {notFound: result.notFound}
										: {}),
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
								text: 'Error: action=list requires "filePath"',
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
