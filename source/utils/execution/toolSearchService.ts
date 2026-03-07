/**
 * Tool Search Service - Progressive tool discovery
 *
 * Instead of loading all MCP tools upfront into the API request context,
 * this service provides a tool_search meta-tool that lets the AI discover
 * and activate tools on-demand, dramatically reducing context consumption.
 *
 * Inspired by Claude Code's Tool Search mechanism.
 */

import type {MCPTool, MCPServiceTools} from './mcpToolsManager.js';

interface SearchResult {
	toolName: string;
	description: string;
	score: number;
}

interface ExternalServiceMeta {
	serviceName: string;
	toolNames: string[];
	toolDescriptions: string[];
}

class ToolSearchService {
	private registry: MCPTool[] = [];
	private toolMap: Map<string, MCPTool> = new Map();
	private externalServices: ExternalServiceMeta[] = [];

	/**
	 * Update the tool registry with all available tools.
	 * Called once per conversation turn with the full tool set.
	 */
	updateRegistry(tools: MCPTool[], servicesInfo?: MCPServiceTools[]): void {
		this.registry = tools;
		this.toolMap.clear();
		for (const tool of tools) {
			this.toolMap.set(tool.function.name, tool);
		}

		this.externalServices = [];
		if (servicesInfo) {
			for (const svc of servicesInfo) {
				if (!svc.isBuiltIn && svc.connected && svc.tools.length > 0) {
					this.externalServices.push({
						serviceName: svc.serviceName,
						toolNames: svc.tools.map(t => t.name),
						toolDescriptions: svc.tools.map(t => t.description || t.name),
					});
				}
			}
		}
	}

	/**
	 * Search tools by keyword query.
	 * Scores tools by matching keywords against name, description, and parameter names.
	 * Returns formatted text result for the AI and the list of matched tool names.
	 */
	search(
		query: string,
		maxResults = 5,
	): {textResult: string; matchedToolNames: string[]} {
		const keywords = query
			.toLowerCase()
			.split(/[\s,._-]+/)
			.filter(k => k.length > 1);

		if (keywords.length === 0) {
			return {
				textResult: `Please provide a search query. Available tool categories:\n${this.getCategorySummary()}`,
				matchedToolNames: [],
			};
		}

		// Build a map of external service names for prefix matching bonus
		const externalServiceNames = new Set(
			this.externalServices.map(s => s.serviceName.toLowerCase()),
		);

		const scored: SearchResult[] = [];

		for (const tool of this.registry) {
			const name = tool.function.name.toLowerCase();
			const desc = (tool.function.description || '').toLowerCase();
			let score = 0;

			for (const keyword of keywords) {
				if (name === keyword) {
					score += 20;
				} else if (name.startsWith(keyword + '-') || name.startsWith(keyword)) {
					score += 15;
				} else if (name.includes(keyword)) {
					score += 10;
				}

				if (desc.includes(keyword)) {
					score += 3;
				}

				const params = tool.function.parameters;
				if (params?.properties) {
					const paramNames = Object.keys(params.properties)
						.join(' ')
						.toLowerCase();
					if (paramNames.includes(keyword)) {
						score += 2;
					}
				}

				// Boost score when keyword matches an external service prefix
				// This ensures searching by service name surfaces all its tools
				if (externalServiceNames.has(keyword)) {
					const prefix = keyword + '-';
					if (name.startsWith(prefix) || name === keyword) {
						score += 10;
					}
				}
			}

			if (score > 0) {
				scored.push({
					toolName: tool.function.name,
					description: tool.function.description || '',
					score,
				});
			}
		}

		scored.sort((a, b) => b.score - a.score);
		const results = scored.slice(0, maxResults);

		if (results.length === 0) {
			return {
				textResult: `No tools found matching "${query}". Available tool categories:\n${this.getCategorySummary()}`,
				matchedToolNames: [],
			};
		}

		const lines = results.map(
			(r, i) => `${i + 1}. **${r.toolName}** - ${r.description}`,
		);

		const textResult = `Found ${results.length} tool(s) matching "${query}" (now available for use):\n\n${lines.join('\n\n')}\n\nThese tools are now loaded and ready to call directly.`;
		const matchedToolNames = results.map(r => r.toolName);

		return {textResult, matchedToolNames};
	}

	/**
	 * Get a summary of tool categories for guidance.
	 * Separates built-in and third-party services for clarity.
	 */
	getCategorySummary(): string {
		const categories = new Map<string, number>();
		for (const tool of this.registry) {
			const prefix = tool.function.name.split('-')[0] || tool.function.name;
			categories.set(prefix, (categories.get(prefix) || 0) + 1);
		}

		const externalNames = new Set(
			this.externalServices.map(s => s.serviceName),
		);

		const builtInLines: string[] = [];
		const externalLines: string[] = [];

		for (const [prefix, count] of categories) {
			const line = `- ${prefix} (${count} tool${count > 1 ? 's' : ''})`;
			if (externalNames.has(prefix)) {
				externalLines.push(line);
			} else {
				builtInLines.push(line);
			}
		}

		let result = builtInLines.join('\n');
		if (externalLines.length > 0) {
			result += '\n\nThird-party MCP services:\n' + externalLines.join('\n');
		}
		return result;
	}

	/**
	 * Get a tool definition by its full name.
	 */
	getToolByName(name: string): MCPTool | undefined {
		return this.toolMap.get(name);
	}

	/**
	 * Get multiple tool definitions by names.
	 */
	getToolsByNames(names: Iterable<string>): MCPTool[] {
		const result: MCPTool[] = [];
		for (const name of names) {
			const tool = this.toolMap.get(name);
			if (tool) {
				result.push(tool);
			}
		}
		return result;
	}

	/**
	 * Extract tool names that were previously used in conversation history.
	 * These tools should be pre-loaded to avoid re-discovery.
	 */
	extractUsedToolNames(
		messages: Array<{tool_calls?: Array<{function: {name: string}}>}>,
	): Set<string> {
		const usedNames = new Set<string>();
		for (const msg of messages) {
			if (msg.tool_calls) {
				for (const tc of msg.tool_calls) {
					const name = tc.function.name;
					if (name !== 'tool_search') {
						usedNames.add(name);
					}
				}
			}
		}
		return usedNames;
	}

	/**
	 * Build the active tools array for an API request.
	 * Includes tool_search + any previously discovered/used tools.
	 */
	buildActiveTools(discoveredToolNames: Set<string>): MCPTool[] {
		const active: MCPTool[] = [this.getToolSearchDefinition()];
		for (const name of discoveredToolNames) {
			const tool = this.toolMap.get(name);
			if (tool) {
				active.push(tool);
			}
		}
		return active;
	}

	/**
	 * Get the tool_search meta-tool definition.
	 * Dynamically includes third-party MCP service info so the AI knows they exist.
	 */
	getToolSearchDefinition(): MCPTool {
		let description =
			'Search for available tools by keyword or description. Call this FIRST to discover tools you need. Found tools become immediately available. ' +
			'Search by category (e.g., "filesystem", "terminal", "todo", "ace", "websearch") or by action (e.g., "edit file", "search code", "run command"). ' +
			'You can call this multiple times to discover different tool categories.';

		if (this.externalServices.length > 0) {
			const externalSummaries = this.externalServices.map(svc => {
				const toolBrief = svc.toolDescriptions
					.slice(0, 3)
					.map(d => {
						const short = d.length > 60 ? d.substring(0, 57) + '...' : d;
						return short;
					})
					.join('; ');
				const extra = svc.toolNames.length > 3 ? ` +${svc.toolNames.length - 3} more` : '';
				return `"${svc.serviceName}" (${toolBrief}${extra})`;
			});
			description +=
				` Additionally, the following third-party MCP services are loaded and searchable: ${externalSummaries.join(', ')}. ` +
				`Search by their service name to discover their tools.`;
		}

		let queryDescription =
			'Search query - tool name, keyword, or description of what you want to do. ' +
			'Examples: "filesystem", "code search", "edit file", "terminal execute", "todo", "websearch"';

		if (this.externalServices.length > 0) {
			const extNames = this.externalServices.map(s => `"${s.serviceName}"`).join(', ');
			queryDescription += `. Third-party services: ${extNames}`;
		}

		return {
			type: 'function',
			function: {
				name: 'tool_search',
				description,
				parameters: {
					type: 'object',
					properties: {
						query: {
							type: 'string',
							description: queryDescription,
						},
					},
					required: ['query'],
				},
			},
		};
	}

	hasTools(): boolean {
		return this.registry.length > 0;
	}

	getToolCount(): number {
		return this.registry.length;
	}
}

export const toolSearchService = new ToolSearchService();
