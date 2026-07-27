/**
 * Pure helpers for compact tool-result title summaries in the TUI.
 * Kept free of React/Ink so unit tests and non-UI callers can import safely.
 */

/**
 * Optional call-site context so compact summaries can include basename / action
 * without re-parsing the full tool payload in React.
 */
export type ToolResultSummaryContext = {
	/** Formatted args from formatToolCallMessage / message.toolDisplay */
	displayArgs?: Array<{key: string; value: string}>;
	/** Raw tool-call arguments when available (edit tools, etc.) */
	rawArgs?: Record<string, unknown>;
};

/** Strip quotes/brackets noise from display arg values. */
function unwrapDisplayArgValue(raw: string): string {
	const trimmed = raw.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Basename only — keep terminal rows short. */
function basenameOfPath(filePath: string): string {
	// Normalize Windows separators; keep as path.posix-style split.
	const cleaned = unwrapDisplayArgValue(filePath).replace(/[\\/]+/g, '/');
	const parts = cleaned.split('/').filter(Boolean);
	return parts[parts.length - 1] || cleaned || filePath;
}

/** Path-like keys should be shortened to basename; action/id stay as-is. */
function isPathLikeKey(key: string): boolean {
	return (
		key === 'filePath' ||
		key === 'path' ||
		key === 'filename' ||
		key.endsWith('Path') ||
		key.endsWith('File')
	);
}

function getContextArgValue(
	context: ToolResultSummaryContext | undefined,
	keys: string[],
): string | undefined {
	if (!context) return undefined;
	if (context.rawArgs) {
		for (const key of keys) {
			const value = context.rawArgs[key];
			if (typeof value === 'string' && value.trim()) {
				const raw = value.trim();
				return isPathLikeKey(key) ? basenameOfPath(raw) : raw;
			}
			if (Array.isArray(value) && value.length > 0) {
				const names = value
					.map(item => {
						if (typeof item === 'string') return basenameOfPath(item);
						if (item && typeof item === 'object' && 'path' in item) {
							const p = (item as {path?: unknown}).path;
							return typeof p === 'string' ? basenameOfPath(p) : '';
						}
						return '';
					})
					.filter(Boolean);
				if (names.length === 1) return names[0];
				if (names.length > 1) {
					const shown = names.slice(0, 2).join(', ');
					return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
				}
			}
		}
	}
	if (context.displayArgs) {
		for (const key of keys) {
			const hit = context.displayArgs.find(a => a.key === key);
			if (!hit?.value) continue;
			const value = unwrapDisplayArgValue(hit.value);
			// Array display: <array with N items> / <array with N 项> / [a, b]
			if (value.startsWith('<array with ')) {
				const m = value.match(/<array with (\d+) (?:items|项)>/);
				if (m) return `${m[1]} files`;
			}
			if (value.startsWith('[') && value.endsWith(']')) {
				return value;
			}
			return isPathLikeKey(key) ? basenameOfPath(value) : value;
		}
	}
	return undefined;
}

function formatLineCount(count: number): string {
	return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

function summarizeFilesystemRead(
	data: any,
	context?: ToolResultSummaryContext,
): string | null {
	const label = getContextArgValue(context, ['filePath', 'path']);

	// Batch read: multimodal array or totalFiles
	if (typeof data.totalFiles === 'number' && data.totalFiles > 0) {
		const filePart =
			label && !label.endsWith('files')
				? label
				: `${data.totalFiles} ${data.totalFiles === 1 ? 'file' : 'files'}`;
		return filePart;
	}

	if (Array.isArray(data.content)) {
		const n = data.content.length;
		if (n === 0) return label || 'empty';
		return label || `${n} ${n === 1 ? 'file' : 'files'}`;
	}

	if (typeof data.content !== 'string' || !data.content) {
		return label || null;
	}

	const lines = data.content.split('\n');
	const linePart = formatLineCount(lines.length);
	const range =
		typeof data.startLine === 'number' &&
		typeof data.endLine === 'number' &&
		(data.startLine !== 1 ||
			(typeof data.totalLines === 'number' && data.endLine < data.totalLines))
			? ` L${data.startLine}-${data.endLine}`
			: '';

	if (label) {
		return `${label} · ${linePart}${range}`;
	}
	return `${linePart}${range}`;
}

/**
 * plan-manage returns plain text (not JSON). Compact rows should show progress
 * action, not a bare tool name.
 */
function summarizePlanManage(
	resultText: string,
	context?: ToolResultSummaryContext,
): string | null {
	const text = (resultText || '').trim();
	if (!text) {
		const action = getContextArgValue(context, ['action']);
		return action ? action : null;
	}

	// Prefer the first meaningful line (errors/acceptance can be multi-line).
	const firstLine =
		text
			.split(/\r?\n/)
			.find(l => l.trim())
			?.trim() || text;

	let m = firstLine.match(
		/^Step\s+(\d+)\s+checked\.\s+All steps of phase\s+(\d+)\s+are done/i,
	);
	if (m) return `P${m[2]} S${m[1]} checked · phase done`;

	m = firstLine.match(
		/^Step\s+(\d+)\s+checked\.\s+Remaining steps in phase\s+(\d+):\s*(.*)$/i,
	);
	if (m) {
		const remaining = (m[3] || '')
			.split('|')
			.map(s => s.trim())
			.filter(Boolean).length;
		return remaining > 0
			? `P${m[2]} S${m[1]} checked · ${remaining} left`
			: `P${m[2]} S${m[1]} checked`;
	}

	m = firstLine.match(/^Step\s+(\d+)\s+checked/i);
	if (m) return `S${m[1]} checked`;

	m = firstLine.match(
		/^Phase\s+(\d+)\s+accepted\b.*Now on phase\s+(\d+)(?::\s*(.*))?/i,
	);
	if (m) {
		const title = (m[3] || '').trim().replace(/[.\s]+$/, '');
		return title
			? `P${m[1]} accepted → P${m[2]} ${title}`.slice(0, 80)
			: `P${m[1]} accepted → P${m[2]}`;
	}

	m = firstLine.match(/^Phase\s+(\d+)\s+acceptance passed\b.*last phase/i);
	if (m) return `P${m[1]} accepted · last phase`;

	m = firstLine.match(/^Phase\s+(\d+)\s+acceptance FAILED/i);
	if (m) return `P${m[1]} acceptance failed`;

	m = firstLine.match(
		/^Plan amended \(phase\s+(\d+)\):\s*\+(\d+)\s+files,\s*\+(\d+)\s+steps/i,
	);
	if (m) return `P${m[1]} amended · +${m[2]} files · +${m[3]} steps`;

	if (/archived/i.test(firstLine) || /plan complete/i.test(firstLine)) {
		return 'archived';
	}

	if (/^Error:/i.test(firstLine)) {
		return firstLine.replace(/^Error:\s*/i, '').slice(0, 72);
	}

	const action = getContextArgValue(context, ['action']);
	if (action) {
		// Fallback: action + short snippet
		const snippet = firstLine.slice(0, 48);
		return snippet ? `${action} · ${snippet}` : action;
	}

	return firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine;
}

/**
 * Extract a brief summary string from a tool result for compact display mode.
 * Returns null if no meaningful summary can be extracted.
 *
 * Optional context supplies path/action from the tool call so rows can show
 * e.g. `MessageRenderer.tsx · 129 lines` or `P1 S2 checked · 1 left`.
 */
export function getToolResultSummary(
	toolName: string,
	result: string,
	context?: ToolResultSummaryContext,
): string | null {
	// plan-manage returns plain text — handle before JSON parse.
	if (toolName === 'plan-manage') {
		return summarizePlanManage(result, context);
	}

	try {
		const data = JSON.parse(result);

		if (toolName.startsWith('subagent-')) {
			// Prefer first non-empty result line for compact inline summaries.
			if (typeof data.result === 'string' && data.result.trim()) {
				const first = data.result
					.split('\n')
					.map((l: string) => l.trim())
					.find(Boolean);
				if (first) {
					return first.length > 72 ? `${first.slice(0, 72)}…` : first;
				}
			}
			if (typeof data.error === 'string' && data.error.trim()) {
				const err = data.error.trim();
				return err.length > 72 ? `${err.slice(0, 72)}…` : err;
			}
			return null;
		}

		if (toolName === 'terminal-execute') {
			const hasError = data.exitCode !== 0;
			if (hasError) return `exit ${data.exitCode}`;
			const stdoutLines = data.stdout
				? data.stdout.split('\n').filter((l: string) => l.trim()).length
				: 0;
			return stdoutLines > 0
				? `${stdoutLines} ${stdoutLines === 1 ? 'line' : 'lines'} output`
				: 'done';
		}

		if (toolName === 'filesystem-read') {
			return summarizeFilesystemRead(data, context);
		}

		if (toolName === 'filesystem-create') {
			const label = getContextArgValue(context, ['filePath', 'path']);
			const msg = data.message || 'created';
			return label ? `${label} · ${msg}` : msg;
		}

		if (
			toolName === 'filesystem-edit' ||
			toolName === 'filesystem-replaceedit'
		) {
			const label = getContextArgValue(context, [
				'filePath',
				'path',
				'filename',
			]);
			const detail =
				(data.totalLines && formatLineCount(data.totalLines)) ||
				data.message ||
				'edited';
			return label ? `${label} · ${detail}` : detail;
		}

		if (toolName === 'websearch-search') {
			const count = data.totalResults || data.results?.length || 0;
			return `${count} ${count === 1 ? 'result' : 'results'}`;
		}

		if (toolName === 'websearch-fetch') {
			const len = data.textLength || data.content?.length || 0;
			return `${len} chars`;
		}

		if (toolName.startsWith('ace-')) {
			// text_search / find_references results
			if (Array.isArray(data)) {
				if (data.length === 0) return 'no matches';
				if (data[0] && 'referenceType' in data[0])
					return `${data.length} ${data.length === 1 ? 'ref' : 'refs'}`;
				if (data[0] && 'content' in data[0] && 'line' in data[0])
					return `${data.length} ${data.length === 1 ? 'match' : 'matches'}`;
				if (data[0] && 'name' in data[0] && 'type' in data[0])
					return `${data.length} ${data.length === 1 ? 'symbol' : 'symbols'}`;
			}
			// semantic_search
			if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
				if ('totalResults' in data) {
					const total =
						(data.symbols?.length || 0) + (data.references?.length || 0);
					if (total === 0) return 'no results';
					return `${total} ${total === 1 ? 'result' : 'results'}`;
				}
				// find_definition
				if ('name' in data && 'filePath' in data && 'line' in data) {
					const file = basenameOfPath(String(data.filePath));
					return `${data.name} · ${file}:${data.line}`;
				}
			}
			return null;
		}

		if (toolName.startsWith('todo-')) {
			// todo tools return various shapes; try common ones
			if (Array.isArray(data))
				return `${data.length} ${data.length === 1 ? 'item' : 'items'}`;
			if (data.todos && Array.isArray(data.todos))
				return `${data.todos.length} ${
					data.todos.length === 1 ? 'todo' : 'todos'
				}`;
			if (data.phases && Array.isArray(data.phases))
				return `${data.phases.length} ${
					data.phases.length === 1 ? 'phase' : 'phases'
				}`;
			if (data.message) return data.message;
			return null;
		}

		if (toolName === 'ide-get_diagnostics') {
			if (Array.isArray(data)) {
				const errors = data.filter((d: any) => d.severity === 'error').length;
				const warnings = data.filter(
					(d: any) => d.severity === 'warning',
				).length;
				if (errors === 0 && warnings === 0) return 'no issues';
				const parts: string[] = [];
				if (errors > 0)
					parts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`);
				if (warnings > 0)
					parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
				return parts.join(', ');
			}
			return null;
		}

		// Generic fallback: try to count array items or object keys
		if (Array.isArray(data)) {
			if (data.length === 0) return 'empty';
			return `${data.length} ${data.length === 1 ? 'item' : 'items'}`;
		}
		if (typeof data === 'object' && data !== null) {
			if (data.message) return data.message;
			const keys = Object.keys(data);
			if (keys.length > 0)
				return `${keys.length} ${keys.length === 1 ? 'field' : 'fields'}`;
		}

		return null;
	} catch {
		// Non-JSON tool results (other than plan-manage, handled above)
		const snippet = (result || '').trim().split(/\r?\n/)[0] || '';
		if (!snippet) return null;
		return snippet.length > 72 ? `${snippet.slice(0, 72)}…` : snippet;
	}
}
