import {Tool, type CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {addNotebook, queryNotebook} from '../utils/notebookManager.js';

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
