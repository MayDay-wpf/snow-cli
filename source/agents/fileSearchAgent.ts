import {getSnowConfig} from '../utils/config/apiConfig.js';
import {logger} from '../utils/core/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {RequestMethod} from '../utils/config/apiConfig.js';
import {
	collectAllMCPTools,
	executeMCPTool,
	type MCPTool,
} from '../utils/execution/mcpToolsManager.js';
import type {WorkingDirectory} from '../utils/config/workingDirConfig.js';
import * as path from 'path';

/**
 * A single file match discovered by the agent search.
 *
 * `path` is always relative to its `sourceDir` (prefixed with `./` for local
 * working dirs) so it maps 1:1 onto the FileItem shape consumed by FileList.
 * Absolute / ssh:// paths are only used when no working directory owns them.
 */
export interface FileSearchResult {
	path: string;
	name: string;
	sourceDir?: string;
	lineNumber?: number;
	lineContent?: string;
	reason?: string;
}

/**
 * Events emitted by the search generator.
 * - `progress`: fired at the start of every AI round (UI shows "round N").
 * - `preview`: live assistant/tool status text for the file picker panel.
 * - `partial`: best-effort file paths extracted from tool results mid-loop.
 * - `done`:    the final, structured answer parsed from the model output.
 * - `error`:   the agent could not run / was aborted.
 */
export type FileSearchEvent =
	| {type: 'progress'; round: number; message: string}
	| {type: 'preview'; round: number; content: string}
	| {type: 'partial'; results: FileSearchResult[]}
	| {type: 'done'; results: FileSearchResult[]}
	| {type: 'error'; message: string};

export type FileSearchPreviewLabels = {
	assistantPrefix: string;
	roundRequest: string;
	requestedToolCalls: string;
	toolCall: string;
	toolResultCandidates: string;
	toolResultReceived: string;
	toolError: string;
	parsingFinalResults: string;
	finalizing: string;
};

const DEFAULT_FILE_SEARCH_PREVIEW_LABELS: FileSearchPreviewLabels = {
	assistantPrefix: 'AI',
	roundRequest: 'Round {round}/{maxRounds}: sending search request',
	requestedToolCalls: 'AI requested {count} tool call(s)',
	toolCall: 'Tool: {tool}{args}',
	toolResultCandidates: 'Tool result: {count} candidate file(s)',
	toolResultReceived: 'Tool result received',
	toolError: 'Tool error: {error}',
	parsingFinalResults: 'Parsing final results',
	finalizing: 'Finalizing results without more tool calls',
};

const formatFileSearchPreviewLabel = (
	template: string,
	values: Record<string, string | number>,
): string =>
	template.replace(/\{(\w+)\}/g, (match, key) => {
		const value = values[key];
		return value === undefined ? match : String(value);
	});

// Only read-only search tools are exposed to the automated agent loop. This
// keeps the picker-triggered search safe: no destructive commands can run
// without user confirmation. terminal-execute is intentionally excluded.
const ALLOWED_TOOL_PREFIXES = ['ace-search', 'filesystem-read'];

const MAX_ROUNDS = 10;
const MAX_RESULTS = 50;
const MAX_TOOL_RESULT_CHARS = 12000;

type StreamProcessEvent =
	| {type: 'preview'; content: string}
	| {type: 'result'; content: string; toolCalls: any[]};

/**
 * File Search Agent
 *
 * Lets the user search files with natural language from the @ / @@ picker by
 * typing `@??<query>` (file search) or `@@??<query>` (content search).
 *
 * The agent runs its own AI loop — calling the same MCP tools the main flow
 * uses (ace-search, filesystem-read) — and returns a structured list of file
 * paths that are rendered directly in the FileList picker.
 */
export class FileSearchAgent {
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private initialized: boolean = false;

	private async initialize(): Promise<boolean> {
		try {
			const config = getSnowConfig();

			// Tool-calling search needs a capable model; prefer advancedModel,
			// fall back to basicModel so the feature still works on minimal setups.
			const advancedModel = config.advancedModel?.trim();
			const basicModel = config.basicModel?.trim();
			if (advancedModel) {
				this.modelName = advancedModel;
			} else if (basicModel) {
				this.modelName = basicModel;
			} else {
				return false;
			}

			this.requestMethod = config.requestMethod;
			this.initialized = true;
			return true;
		} catch (error) {
			logger.warn('Failed to initialize file search agent:', error);
			return false;
		}
	}

	clearCache(): void {
		this.initialized = false;
		this.modelName = '';
		this.requestMethod = 'chat';
	}

	async isAvailable(): Promise<boolean> {
		if (!this.initialized) {
			return await this.initialize();
		}
		return true;
	}

	/**
	 * Collect all MCP tools but keep only the read-only search subset.
	 */
	private async getSearchTools(): Promise<MCPTool[]> {
		const allTools = await collectAllMCPTools();
		return allTools.filter(tool =>
			ALLOWED_TOOL_PREFIXES.some(prefix =>
				tool.function.name.startsWith(prefix),
			),
		);
	}

	/**
	 * Create a streaming completion request routed the same way as the main
	 * flow. When `tools` is empty the field is omitted so the model is forced
	 * to produce a final text answer.
	 */
	private createStream(
		messages: ChatMessage[],
		tools: MCPTool[],
		abortSignal?: AbortSignal,
	): AsyncIterable<any> {
		const toolOption = tools.length > 0 ? tools : undefined;

		switch (this.requestMethod) {
			case 'anthropic':
				return createStreamingAnthropicCompletion(
					{
						model: this.modelName,
						messages,
						temperature: 0,
						max_tokens: 4096,
						tools: toolOption,
						disableThinking: true, // Agents 不使用 Extended Thinking
						includeBuiltinSystemPrompt: false,
					},
					abortSignal,
				);
			case 'gemini':
				return createStreamingGeminiCompletion(
					{
						model: this.modelName,
						messages,
						temperature: 0,
						tools: toolOption,
						disableThinking: true,
						includeBuiltinSystemPrompt: false,
					},
					abortSignal,
				);
			case 'responses':
				return createStreamingResponse(
					{
						model: this.modelName,
						messages,
						temperature: 0,
						tools: toolOption,
						stream: true,
						disableThinking: true,
						includeBuiltinSystemPrompt: false,
					},
					abortSignal,
				);
			case 'chat':
			default:
				return createStreamingChatCompletion(
					{
						model: this.modelName,
						messages,
						temperature: 0,
						tools: toolOption,
						stream: true,
						disableThinking: true,
						includeBuiltinSystemPrompt: false,
					},
					abortSignal,
				);
		}
	}

	/**
	 * Consume a stream and accumulate text content + tool calls. Works for all
	 * request methods because every create*Completion emits the unified event
	 * shape ({type:'content'|'tool_calls'|'done'}). It also yields throttled
	 * text previews so the picker can show live agent output while the round is
	 * still streaming.
	 */
	private async *processStream(
		stream: AsyncIterable<any>,
		abortSignal?: AbortSignal,
	): AsyncGenerator<StreamProcessEvent, void, unknown> {
		let content = '';
		let toolCalls: any[] = [];
		let lastPreviewAt = 0;
		let lastPreviewContent = '';

		for await (const event of stream) {
			if (abortSignal?.aborted) {
				throw new Error('File search aborted');
			}
			if (event.type === 'content' && event.content) {
				content += event.content;
				const now = Date.now();
				if (now - lastPreviewAt >= 80) {
					lastPreviewAt = now;
					lastPreviewContent = content;
					yield {type: 'preview', content};
				}
			} else if (event.type === 'tool_calls' && event.tool_calls) {
				toolCalls = event.tool_calls;
			}
		}

		if (content && content !== lastPreviewContent) {
			yield {type: 'preview', content};
		}
		yield {type: 'result', content, toolCalls};
	}

	/**
	 * Main entry point: run an AI loop that searches files using the main
	 * flow's MCP tools, yielding progress / partial / done / error events.
	 */
	async *search(
		query: string,
		searchMode: 'file' | 'content',
		workingDirs: WorkingDirectory[],
		abortSignal?: AbortSignal,
		previewLabels: FileSearchPreviewLabels = DEFAULT_FILE_SEARCH_PREVIEW_LABELS,
	): AsyncGenerator<FileSearchEvent, void, unknown> {
		const labels = previewLabels;
		const available = await this.isAvailable();
		if (!available) {
			yield {
				type: 'error',
				message: 'File search agent is not available (no model configured)',
			};
			return;
		}

		let tools: MCPTool[] = [];
		try {
			tools = await this.getSearchTools();
		} catch (error) {
			logger.warn('File search agent: failed to collect tools:', error);
		}
		if (tools.length === 0) {
			yield {
				type: 'error',
				message:
					'No search tools available (enable ace-search or filesystem-read)',
			};
			return;
		}

		const systemPrompt = this.buildSystemPrompt(searchMode, workingDirs);
		const messages: ChatMessage[] = [
			{role: 'system', content: systemPrompt},
			{role: 'user', content: this.buildUserPrompt(query, searchMode)},
		];
		const previewLines: string[] = [];
		const formatAssistantPreviewContent = (content: string): string =>
			`${labels.assistantPrefix}: ${content}`;
		const buildPreview = (
			round: number,
			currentContent?: string,
		): FileSearchEvent => {
			const lines = previewLines.slice(-40);
			const current = this.compactPreviewText(currentContent);
			if (current) {
				lines.push(formatAssistantPreviewContent(current));
			}
			return {type: 'preview', round, content: lines.join('\n')};
		};
		const pushPreview = (round: number, line: string): FileSearchEvent => {
			const safeLine = this.compactPreviewText(line);
			if (safeLine) {
				previewLines.push(safeLine);
				if (previewLines.length > 40) {
					previewLines.splice(0, previewLines.length - 40);
				}
			}
			return buildPreview(round);
		};

		const seenPaths = new Set<string>();
		const collect = (results: FileSearchResult[]): FileSearchResult[] => {
			const fresh: FileSearchResult[] = [];
			for (const r of results) {
				const key = `${r.sourceDir || ''}::${r.path}::${r.lineNumber ?? 0}`;
				if (seenPaths.has(key)) {
					continue;
				}
				seenPaths.add(key);
				fresh.push(r);
			}
			return fresh;
		};

		for (let round = 1; round <= MAX_ROUNDS; round++) {
			if (abortSignal?.aborted) {
				yield {type: 'error', message: 'Search aborted'};
				return;
			}

			const roundRequestMessage = formatFileSearchPreviewLabel(
				labels.roundRequest,
				{round, maxRounds: MAX_ROUNDS},
			);
			yield {
				type: 'progress',
				round,
				message: roundRequestMessage,
			};
			yield pushPreview(round, roundRequestMessage);

			let streamResult: {content: string; toolCalls: any[]} | null = null;
			try {
				const stream = this.createStream(messages, tools, abortSignal);
				for await (const streamEvent of this.processStream(
					stream,
					abortSignal,
				)) {
					if (streamEvent.type === 'preview') {
						yield buildPreview(round, streamEvent.content);
					} else {
						streamResult = {
							content: streamEvent.content,
							toolCalls: streamEvent.toolCalls,
						};
					}
				}
				if (!streamResult) {
					throw new Error('Streaming did not return a result');
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Streaming failed';
				if (abortSignal?.aborted) {
					yield {type: 'error', message: 'Search aborted'};
				} else {
					yield {type: 'error', message};
				}
				return;
			}

			const {content, toolCalls} = streamResult;
			if (content.trim()) {
				previewLines.push(
					formatAssistantPreviewContent(this.compactPreviewText(content)),
				);
				if (previewLines.length > 40) {
					previewLines.splice(0, previewLines.length - 40);
				}
				yield buildPreview(round);
			} else if (toolCalls.length > 0) {
				yield pushPreview(
					round,
					formatFileSearchPreviewLabel(labels.requestedToolCalls, {
						count: toolCalls.length,
					}),
				);
			}

			// Record the assistant turn (with or without tool calls).
			if (content || toolCalls.length > 0) {
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: content || '',
				};
				if (toolCalls.length > 0) {
					assistantMessage.tool_calls = toolCalls;
				}
				messages.push(assistantMessage);
			}

			// No tool calls → the model produced its final answer. The final list
			// is authoritative (curated by the model), so it is NOT deduped against
			// the partial paths — it replaces whatever partials were shown.
			if (toolCalls.length === 0) {
				yield pushPreview(round, labels.parsingFinalResults);
				const results = this.parseResults(content, workingDirs, searchMode);
				yield {type: 'done', results};
				return;
			}

			// Execute each tool call and feed the results back.
			for (const toolCall of toolCalls) {
				if (abortSignal?.aborted) {
					yield {type: 'error', message: 'Search aborted'};
					return;
				}

				let args: any = {};
				try {
					args = JSON.parse(toolCall.function.arguments || '{}');
				} catch {
					args = {};
				}

				yield pushPreview(
					round,
					formatFileSearchPreviewLabel(labels.toolCall, {
						tool: toolCall.function.name,
						args: this.summarizeToolArgs(args),
					}),
				);

				let resultContent: string;
				try {
					const result = await executeMCPTool(
						toolCall.function.name,
						args,
						abortSignal,
					);
					resultContent =
						typeof result === 'string' ? result : JSON.stringify(result);
					// Best-effort incremental extraction so the user sees files
					// appear while the loop is still running.
					const partial = this.extractPartialResults(
						toolCall.function.name,
						result,
						workingDirs,
						searchMode,
					);
					const fresh = collect(partial);
					if (fresh.length > 0) {
						yield pushPreview(
							round,
							formatFileSearchPreviewLabel(labels.toolResultCandidates, {
								count: fresh.length,
							}),
						);
						yield {type: 'partial', results: fresh};
					} else {
						yield pushPreview(round, labels.toolResultReceived);
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : 'Tool execution failed';
					resultContent = `Error: ${errorMessage}`;
					yield pushPreview(
						round,
						formatFileSearchPreviewLabel(labels.toolError, {
							error: errorMessage,
						}),
					);
				}

				// Keep tool results compact to avoid blowing up the context.
				if (resultContent.length > MAX_TOOL_RESULT_CHARS) {
					resultContent =
						resultContent.slice(0, MAX_TOOL_RESULT_CHARS) + '\n... (truncated)';
				}

				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: resultContent,
				} as ChatMessage);
			}
		}

		// Reached the round cap while still calling tools — force one final
		// answer with no tools available.
		if (abortSignal?.aborted) {
			yield {type: 'error', message: 'Search aborted'};
			return;
		}
		const finalizingMessage = labels.finalizing;
		yield {
			type: 'progress',
			round: MAX_ROUNDS,
			message: finalizingMessage,
		};
		yield pushPreview(MAX_ROUNDS, finalizingMessage);
		messages.push({
			role: 'user',
			content:
				'You have reached the search step limit. Stop calling tools and output the final JSON results array now, based only on what you already found. Output ONLY the JSON array.',
		});

		try {
			const stream = this.createStream(messages, [], abortSignal);
			let finalStreamResult: {content: string; toolCalls: any[]} | null = null;
			for await (const streamEvent of this.processStream(stream, abortSignal)) {
				if (streamEvent.type === 'preview') {
					yield buildPreview(MAX_ROUNDS, streamEvent.content);
				} else {
					finalStreamResult = {
						content: streamEvent.content,
						toolCalls: streamEvent.toolCalls,
					};
				}
			}
			if (!finalStreamResult) {
				throw new Error('Final answer failed');
			}
			const {content} = finalStreamResult;
			if (content.trim()) {
				previewLines.push(
					formatAssistantPreviewContent(this.compactPreviewText(content)),
				);
				if (previewLines.length > 40) {
					previewLines.splice(0, previewLines.length - 40);
				}
				yield buildPreview(MAX_ROUNDS);
			}
			const results = this.parseResults(content, workingDirs, searchMode);
			yield {type: 'done', results};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Final answer failed';
			if (abortSignal?.aborted) {
				yield {type: 'error', message: 'Search aborted'};
			} else {
				yield {type: 'error', message};
			}
		}
	}

	// ── Prompt builders ───────────────────────────────────────────────

	private buildSystemPrompt(
		searchMode: 'file' | 'content',
		workingDirs: WorkingDirectory[],
	): string {
		const dirList = workingDirs
			.map(d => {
				const remote = d.isRemote ? ' (remote SSH)' : '';
				return `- ${d.path}${remote}`;
			})
			.join('\n');

		const modeInstruction =
			searchMode === 'content'
				? `CONTENT SEARCH: the user is looking for code/content that matches the query. Find files AND the specific line numbers where relevant code lives. Always include lineNumber and a short lineContent snippet for every result.`
				: `FILE SEARCH: the user is looking for files whose name, path, or purpose matches the query. Return the most relevant files. lineNumber/lineContent are optional (only include when a specific line is the reason for the match).`;

		return `You are a file search assistant embedded in a CLI file picker. The user typed a natural-language query and you must find the most relevant files in the workspace.

Working directories:
${dirList}

${modeInstruction}

Use the available search tools to explore the workspace:
- ace-search (action: text_search / semantic_search / find_definition / find_references / file_outline): the primary way to locate code and files. text_search runs a grep/ripgrep-style search.
- filesystem-read: read directory listings or file contents when you need to confirm a path.

Strategy:
1. Start with an ace-search text_search using keywords derived from the query.
2. If results are sparse, try semantic_search or broaden the pattern.
3. Use filesystem-read on directories only to confirm structure when needed.
4. Keep the number of tool calls small (aim for 1-4 rounds). Do not read large files in full.

When you are confident you have the relevant files, STOP calling tools and respond with ONLY a JSON array (no markdown, no prose). Each element must be an object with:
- "path": file path RELATIVE to its working directory, prefixed with "./" (e.g. "./src/auth.ts"). Use an absolute or ssh:// path only if the file is outside every working directory.
- "name": the file's basename (e.g. "auth.ts").
- "sourceDir": the working directory path the file belongs to (must match one listed above).
- "reason": one short sentence explaining why this file matches the query.
- "lineNumber": (content search) the 1-based line number of the most relevant line.
- "lineContent": (content search) a short snippet of that line.

Return at most ${MAX_RESULTS} results, most relevant first. If nothing matches, return [].

Example output:
[{"path":"./src/auth/login.ts","name":"login.ts","sourceDir":"/home/me/project","reason":"handles user login flow","lineNumber":42,"lineContent":"async function login(user) {"}]`;
	}

	private buildUserPrompt(
		query: string,
		searchMode: 'file' | 'content',
	): string {
		const mode = searchMode === 'content' ? 'content' : 'file';
		return `Search mode: ${mode}\nNatural language query: ${query.trim()}\n\nFind the relevant files now.`;
	}

	private compactPreviewText(content: string | undefined): string {
		if (!content) {
			return '';
		}

		const normalized = content
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.replace(/[\t\v\f]+/g, ' ')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.join('\n');

		if (normalized.length <= 1200) {
			return normalized;
		}

		return normalized.slice(0, 1200) + '\n...';
	}

	private summarizeToolArgs(args: any): string {
		try {
			if (!args || typeof args !== 'object') {
				return '';
			}

			const keys = [
				'action',
				'pattern',
				'query',
				'symbolName',
				'fileGlob',
				'filePath',
				'path',
			];
			const parts = keys
				.filter(key => typeof args[key] === 'string' && args[key])
				.map(key => {
					const value = this.compactPreviewText(String(args[key]))
						.replace(/\n/g, ' ')
						.slice(0, 80);
					return `${key}=${value}`;
				});

			if (parts.length > 0) {
				return ` (${parts.join(', ')})`;
			}

			const raw = JSON.stringify(args);
			if (!raw || raw === '{}') {
				return '';
			}

			return ` (${this.compactPreviewText(raw)
				.replace(/\n/g, ' ')
				.slice(0, 120)})`;
		} catch {
			return '';
		}
	}

	// ── Result parsing & normalization ────────────────────────────────

	/**
	 * Parse the model's final text answer into FileSearchResult[].
	 * Tolerates markdown fences and surrounding prose.
	 */
	private parseResults(
		content: string,
		workingDirs: WorkingDirectory[],
		searchMode: 'file' | 'content',
	): FileSearchResult[] {
		if (!content || !content.trim()) {
			return [];
		}

		let jsonStr = content.trim();

		// Strip markdown code fences.
		const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
		if (fenceMatch) {
			jsonStr = fenceMatch[1]!.trim();
		}

		// Isolate the outermost JSON array.
		const arrayStart = jsonStr.indexOf('[');
		const arrayEnd = jsonStr.lastIndexOf(']');
		if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
			jsonStr = jsonStr.substring(arrayStart, arrayEnd + 1);
		}

		let parsed: any;
		try {
			parsed = JSON.parse(jsonStr);
		} catch {
			return [];
		}

		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed
			.map((item: any) => this.normalizeResult(item, workingDirs, searchMode))
			.filter((r: FileSearchResult | null): r is FileSearchResult => r !== null)
			.slice(0, MAX_RESULTS);
	}

	private normalizeResult(
		item: any,
		workingDirs: WorkingDirectory[],
		searchMode: 'file' | 'content',
	): FileSearchResult | null {
		if (!item || typeof item !== 'object') {
			return null;
		}

		const rawPath =
			(typeof item.path === 'string' && item.path) ||
			(typeof item.filePath === 'string' && item.filePath) ||
			(typeof item.file === 'string' && item.file) ||
			null;
		if (!rawPath) {
			return null;
		}

		const name =
			(typeof item.name === 'string' && item.name) || path.basename(rawPath);

		const reason =
			typeof item.reason === 'string'
				? item.reason
				: typeof item.description === 'string'
				? item.description
				: undefined;

		const lineNumber =
			searchMode === 'content'
				? typeof item.lineNumber === 'number'
					? item.lineNumber
					: typeof item.line === 'number'
					? item.line
					: typeof item.startLine === 'number'
					? item.startLine
					: undefined
				: undefined;

		const lineContent =
			searchMode === 'content'
				? typeof item.lineContent === 'string'
					? item.lineContent
					: typeof item.content === 'string'
					? item.content
					: undefined
				: undefined;

		const normalized = this.normalizePath(rawPath, workingDirs, item.sourceDir);

		return {
			path: normalized.path,
			name,
			sourceDir: normalized.sourceDir,
			lineNumber,
			lineContent: lineContent ? lineContent.slice(0, 200) : undefined,
			reason,
		};
	}

	/**
	 * Convert an arbitrary path into a (sourceDir, relativePath) pair that
	 * matches how FileList's loadFiles builds FileItems. This guarantees the
	 * agent results plug into getFullFilePath() unchanged.
	 */
	private normalizePath(
		rawPath: string,
		workingDirs: WorkingDirectory[],
		hintSourceDir?: string,
	): {path: string; sourceDir?: string} {
		const normalized = rawPath.replace(/\\/g, '/').replace(/\/$/, '');

		// SSH path: match against remote working directories.
		if (normalized.startsWith('ssh://')) {
			for (const dir of workingDirs) {
				if (!dir.path.startsWith('ssh://')) {
					continue;
				}
				const base = dir.path.replace(/\/$/, '');
				if (normalized.toLowerCase().startsWith(base.toLowerCase())) {
					const rel = normalized.substring(base.length).replace(/^\//, '');
					return {path: rel ? './' + rel : '.', sourceDir: dir.path};
				}
			}
			return {path: normalized};
		}

		// Absolute local path: match against local working directories.
		if (path.isAbsolute(rawPath)) {
			for (const dir of workingDirs) {
				if (dir.isRemote) {
					continue;
				}
				const base = dir.path.replace(/\\/g, '/').replace(/\/$/, '');
				if (normalized.toLowerCase().startsWith(base.toLowerCase())) {
					const rel = normalized.substring(base.length).replace(/^\//, '');
					return {path: rel ? './' + rel : '.', sourceDir: dir.path};
				}
			}
			return {path: normalized};
		}

		// Already-relative path. Prefer the hinted source dir, else the first
		// working dir, so getFullFilePath can resolve it.
		const withPrefix = normalized.startsWith('./')
			? normalized
			: './' + normalized;
		const sourceDir =
			(hintSourceDir &&
				workingDirs.some(d => d.path === hintSourceDir) &&
				hintSourceDir) ||
			workingDirs[0]?.path;
		return {path: withPrefix, sourceDir};
	}

	/**
	 * Best-effort extraction of file paths from a tool result so the list can
	 * populate incrementally. Wrapped in try/catch — extraction failures never
	 * break the loop; the final structured answer is the source of truth.
	 */
	private extractPartialResults(
		toolName: string,
		result: any,
		workingDirs: WorkingDirectory[],
		searchMode: 'file' | 'content',
	): FileSearchResult[] {
		const results: FileSearchResult[] = [];
		try {
			if (toolName.startsWith('ace-search')) {
				// ace-search returns arrays of {filePath, line, column, content}
				// possibly nested under .results / .references / .symbols.
				const candidates: any[] = [];
				const pushFrom = (val: any) => {
					if (Array.isArray(val)) {
						candidates.push(...val);
					}
				};
				pushFrom(result);
				if (result && typeof result === 'object') {
					pushFrom(result.results);
					pushFrom(result.references);
					pushFrom(result.symbols);
					pushFrom(result.matches);
				}

				for (const item of candidates) {
					if (!item || typeof item !== 'object') {
						continue;
					}
					const filePath =
						(typeof item.filePath === 'string' && item.filePath) ||
						(typeof item.path === 'string' && item.path) ||
						null;
					if (!filePath) {
						continue;
					}
					const normalized = this.normalizePath(filePath, workingDirs);
					results.push({
						path: normalized.path,
						name: path.basename(filePath),
						sourceDir: normalized.sourceDir,
						lineNumber:
							searchMode === 'content'
								? typeof item.line === 'number'
									? item.line
									: typeof item.lineNumber === 'number'
									? item.lineNumber
									: typeof item.startLine === 'number'
									? item.startLine
									: undefined
								: undefined,
						lineContent:
							searchMode === 'content'
								? typeof item.content === 'string'
									? item.content.slice(0, 200)
									: undefined
								: undefined,
					});
				}
			}
			// Note: filesystem-read directory listings are intentionally NOT
			// extracted as partials — they would flood the list with every file in
			// a directory. Only targeted ace-search hits are surfaced mid-loop;
			// the model's final structured answer remains the source of truth.
		} catch {
			// Extraction is purely a UX nicety; ignore failures.
		}
		return results.slice(0, MAX_RESULTS);
	}
}

// Export singleton instance
export const fileSearchAgent = new FileSearchAgent();
