/**
 * Built-in Snow Docs tools (issue #188)
 * Read-only progressive disclosure over bundled docs/usage.
 */
import {
	getSnowDoc,
	listSnowDocs,
	searchSnowDocs,
} from '../utils/docs/snowDocs.js';

export const mcpTools = [
	{
		name: 'snow-docs-list',
		description:
			'List bundled Snow CLI official usage docs (catalogue index only). Use this first when the user asks how to install/configure Snow (Profile, MCP, Skills, Hooks, sub-agents, sensitive commands, relay, etc.). Locale defaults to the user language setting (zh/en). Does NOT load full document bodies — call snow-docs-get for details. Read-only.',
		inputSchema: {
			type: 'object',
			properties: {
				locale: {
					type: 'string',
					enum: ['zh', 'en'],
					description:
						'Optional docs locale override. Defaults to the user Language Settings (zh/zh-TW -> zh, otherwise en).',
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: 'snow-docs-search',
		description:
			'Search bundled Snow CLI official usage docs by keyword/topic (MCP, Profile, Hooks, Skills, sub-agents, sensitive commands, proxy, relay, LSP, Team, SSE, etc.). Returns matching doc ids + short snippets only — progressive disclosure, never dumps the whole manual. Prefer this before guessing config paths. Read-only.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Search query, e.g. "MCP", "hooks", "profile", "skills", "敏感命令", "中转".',
				},
				locale: {
					type: 'string',
					enum: ['zh', 'en'],
					description: 'Optional locale override (zh/en).',
				},
				maxResults: {
					type: 'number',
					description: 'Max hits to return (default 8, max 12).',
				},
			},
			required: ['query'],
			additionalProperties: false,
		},
	},
	{
		name: 'snow-docs-get',
		description:
			'Get one bundled Snow CLI usage document by path/id returned from snow-docs-list or snow-docs-search (e.g. "14.MCP配置.md" or "14.MCP Configuration.md"). Returns a single doc body (may truncate very long files). Use for authoritative configuration steps; do not invent paths from model memory. Read-only — never writes config.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description:
						'Document id/path within the locale folder, e.g. "02.首次配置.md", "14.MCP Configuration.md", or "zh/14.MCP配置.md".',
				},
				locale: {
					type: 'string',
					enum: ['zh', 'en'],
					description: 'Optional locale override (zh/en).',
				},
				maxChars: {
					type: 'number',
					description: 'Optional max characters to return (default 24000).',
				},
			},
			required: ['path'],
			additionalProperties: false,
		},
	},
];

export async function executeSnowDocsTool(
	actualToolName: string,
	args: any,
): Promise<string> {
	switch (actualToolName) {
		case 'list': {
			const result = listSnowDocs({
				locale: args?.locale,
			});
			const lines = [
				`# Snow CLI docs catalogue (v${result.version})`,
				`Locale: ${result.locale}`,
				// Intentionally omit absolute docsRoot to avoid leaking local paths/usernames.
				'',
				'Use snow-docs-get with an id below for full content. Do not load every document.',
				'',
				...result.docs.map(
					doc =>
						`- \`${doc.id}\` — **${doc.title}**${
							doc.summary ? ` — ${doc.summary}` : ''
						}`,
				),
			];
			return lines.join('\n');
		}
		case 'search': {
			const result = searchSnowDocs({
				query: args?.query,
				locale: args?.locale,
				maxResults: args?.maxResults,
			});
			if (result.hits.length === 0) {
				return JSON.stringify(
					{
						version: result.version,
						locale: result.locale,
						query: result.query,
						hits: [],
						message:
							'No matching docs. Try snow-docs-list or broader keywords (mcp/profile/hooks/skills).',
					},
					null,
					2,
				);
			}
			return JSON.stringify(result, null, 2);
		}
		case 'get': {
			const result = getSnowDoc({
				path: args?.path,
				locale: args?.locale,
				maxChars: args?.maxChars,
			});
			const header = [
				`# ${result.title}`,
				'',
				`- id: ${result.id}`,
				`- locale: ${result.locale}`,
				`- version: ${result.version}`,
				// Prefer relative doc id over absolute filesystem path in tool output.
				result.truncated ? '- truncated: true' : '- truncated: false',
				'',
				'---',
				'',
			].join('\n');
			return `${header}${result.content}`;
		}
		default:
			throw new Error(`Unknown snow-docs tool: ${actualToolName}`);
	}
}
