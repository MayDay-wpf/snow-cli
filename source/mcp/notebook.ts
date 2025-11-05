import {Tool, type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {
	addNotebook,
	queryNotebook,
	updateNotebook,
	deleteNotebook,
	getNotebooksByFile,
} from '../utils/notebookManager.js';

/**
 * Notebook MCP 工具定义
 * 用于代码备忘录管理，帮助AI记录重要的代码注意事项
 */
export const mcpTools: Tool[] = [
	{
		name: 'notebook-add',
		description: `📝 Record code parts that are fragile and easily broken during iteration.

**Core Purpose:** Prevent new features from breaking existing functionality.

**When to record:**
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
				filePath: {
					type: 'string',
					description:
						'File path (relative or absolute). Example: "src/utils/parser.ts"',
				},
				note: {
					type: 'string',
					description:
						'Brief, specific note. Focus on risks/constraints, NOT what code does.',
				},
			},
			required: ['filePath', 'note'],
		},
	},
	{
		name: 'notebook-query',
		description: `🔍 Search notebook entries by file path pattern.

**Auto-triggered:** When reading files, last 10 notebooks are automatically shown.
**Manual use:** Query specific patterns or see more entries.`,
		inputSchema: {
			type: 'object',
			properties: {
				filePathPattern: {
					type: 'string',
					description:
						'Fuzzy search pattern (e.g., "parser"). Empty = all entries.',
					default: '',
				},
				topN: {
					type: 'number',
					description: 'Max results to return (default: 10, max: 50)',
					default: 10,
					minimum: 1,
					maximum: 50,
				},
			},
		},
	},
	{
		name: 'notebook-update',
		description: `✏️ Update an existing notebook entry to fix mistakes or refine notes.

**Core Purpose:** Correct errors in previously recorded notes or update outdated information.

**When to use:**
- Found a mistake in a previously recorded note
- Need to clarify or improve the wording
- Update note after code changes
- Refine warning messages for better clarity

**Usage:**
1. Use notebook-query or notebook-list to find the entry ID
2. Call notebook-update with the ID and new note content

**Example:**
- Old: "⚠️ Don't change this"
- New: "⚠️ validateInput() MUST be called first - parser depends on sanitized input"`,
		inputSchema: {
			type: 'object',
			properties: {
				notebookId: {
					type: 'string',
					description:
						'Notebook entry ID to update (get from notebook-query or notebook-list)',
				},
				note: {
					type: 'string',
					description: 'New note content to replace the existing one',
				},
			},
			required: ['notebookId', 'note'],
		},
	},
	{
		name: 'notebook-delete',
		description: `🗑️ Delete an outdated or incorrect notebook entry.

**Core Purpose:** Remove notes that are no longer relevant or were recorded by mistake.

**When to use:**
- Code has been refactored and note is obsolete
- Note was recorded by mistake
- Workaround has been properly fixed
- Entry is duplicate or redundant

**Usage:**
1. Use notebook-query or notebook-list to find the entry ID
2. Call notebook-delete with the ID to remove it

**⚠️ Warning:** Deletion is permanent. Make sure the note is truly obsolete.`,
		inputSchema: {
			type: 'object',
			properties: {
				notebookId: {
					type: 'string',
					description: 'Notebook entry ID to delete (get from notebook-query)',
				},
			},
			required: ['notebookId'],
		},
	},
	{
		name: 'notebook-list',
		description: `📋 List all notebook entries for a specific file.

**Core Purpose:** View all notes associated with a particular file for management.

**When to use:**
- Need to see all notes for a file before editing
- Want to clean up old notes for a specific file
- Review constraints before making changes to a file

**Returns:** All notebook entries for the specified file, ordered by creation time.`,
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'File path (relative or absolute) to list notebooks for',
				},
			},
			required: ['filePath'],
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
		switch (toolName) {
			case 'notebook-add': {
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

			case 'notebook-query': {
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

			case 'notebook-update': {
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

			case 'notebook-delete': {
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

			case 'notebook-list': {
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
							text: `Unknown notebook tool: ${toolName}`,
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
					text: `Error executing notebook tool: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}
