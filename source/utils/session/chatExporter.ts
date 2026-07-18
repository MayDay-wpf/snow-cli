import * as fs from 'fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {ChatMessage, Session} from './sessionManager.js';

export type ExportFormat = 'txt' | 'md' | 'html' | 'json';

/**
 * Headless / agent exports should never land in process.cwd() (often the
 * project root). Keep them under the global Snow data dir instead.
 */
export function getDefaultExportDirectory(): string {
	return path.join(os.homedir(), '.snow', 'exports');
}

export function buildDefaultExportFileName(
	sessionId: string,
	format: ExportFormat,
): string {
	const shortId = sessionId.slice(0, 8);
	// ISO seconds only: 2026-07-15T08-52-40 (drop ms / trailing Z)
	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	return `snow-export-${timestamp}-${shortId}.${format}`;
}

/**
 * Resolve the final export path.
 * - Explicit --out / -o wins (absolute or relative to cwd)
 * - Otherwise: ~/.snow/exports/snow-export-{timestamp}-{shortId}.{format}
 */
export function resolveExportFilePath(
	sessionId: string,
	format: ExportFormat,
	outPath?: string,
): string {
	if (outPath) {
		return path.resolve(outPath);
	}
	return path.join(
		getDefaultExportDirectory(),
		buildDefaultExportFileName(sessionId, format),
	);
}

const ROLE_LABELS: Record<string, string> = {
	user: 'User',
	assistant: 'Assistant',
	system: 'System',
	tool: 'Tool',
};

function getRoleLabel(role: ChatMessage['role']): string {
	return ROLE_LABELS[role] ?? 'Unknown';
}

function tryPrettyJson(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return raw;
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return raw;
	}
}

function shouldSkip(message: ChatMessage): boolean {
	// Internal sub-agent shells are noise for end users
	return message.subAgentInternal === true;
}

function formatDisplayDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

// ---------------------------------------------------------------------------
// Plain text formatter
// ---------------------------------------------------------------------------

export function formatSessionAsText(session: Session): string {
	const lines: string[] = [];
	const divider = '====================================================';

	lines.push(divider);
	lines.push('Snow AI - Chat Export');
	if (session.title) lines.push(`Title:        ${session.title}`);
	lines.push(`Session ID:   ${session.id}`);
	lines.push(`Created at:   ${formatDisplayDate(session.createdAt)}`);
	lines.push(`Updated at:   ${formatDisplayDate(session.updatedAt)}`);
	lines.push(
		`Messages:     ${session.messageCount ?? session.messages.length}`,
	);
	if (session.projectPath) lines.push(`Project:      ${session.projectPath}`);
	if (session.summary) {
		lines.push('');
		lines.push('Summary:');
		lines.push(session.summary);
	}
	lines.push(divider);
	lines.push('');

	for (const message of session.messages) {
		if (shouldSkip(message)) continue;

		const role = getRoleLabel(message.role).toUpperCase();
		const stamp = message.timestamp ? formatDisplayDate(message.timestamp) : '';
		lines.push(stamp ? `[${role}]  ${stamp}` : `[${role}]`);
		lines.push('-'.repeat(52));

		const text = message.originalContent ?? message.content;
		if (text && text.length > 0) {
			lines.push(text);
		}

		if (message.thinking?.thinking) {
			lines.push('');
			lines.push('[THINKING]');
			lines.push(message.thinking.thinking);
		}

		if (message.reasoning_content) {
			lines.push('');
			lines.push('[REASONING]');
			lines.push(message.reasoning_content);
		}

		if (message.tool_calls && message.tool_calls.length > 0) {
			for (const tc of message.tool_calls) {
				lines.push('');
				lines.push(`[TOOL CALL] ${tc.function.name}`);
				lines.push(tryPrettyJson(tc.function.arguments));
			}
		}

		if (message.role === 'tool' && message.tool_call_id) {
			lines.push('');
			lines.push(`[TOOL RESULT] (call ${message.tool_call_id})`);
			// content already printed above; nothing more here
		}

		if (message.images && message.images.length > 0) {
			lines.push('');
			lines.push(`[${message.images.length} image(s) attached]`);
		}

		lines.push('');
		lines.push('');
	}

	lines.push(divider);
	lines.push('End of Chat Export');
	lines.push(divider);

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

export function formatSessionAsMarkdown(session: Session): string {
	const out: string[] = [];

	out.push(`# ${session.title || 'Snow AI Chat Export'}`);
	out.push('');
	out.push('| Field | Value |');
	out.push('| --- | --- |');
	out.push(`| Session ID | \`${session.id}\` |`);
	out.push(`| Created at | ${formatDisplayDate(session.createdAt)} |`);
	out.push(`| Updated at | ${formatDisplayDate(session.updatedAt)} |`);
	out.push(`| Messages | ${session.messageCount ?? session.messages.length} |`);
	if (session.projectPath) {
		out.push(`| Project | \`${session.projectPath}\` |`);
	}
	out.push('');

	if (session.summary) {
		out.push('> ' + session.summary.replace(/\n/g, '\n> '));
		out.push('');
	}

	out.push('---');
	out.push('');

	for (const message of session.messages) {
		if (shouldSkip(message)) continue;

		const role = getRoleLabel(message.role);
		const stamp = message.timestamp
			? ` &middot; <sub>${formatDisplayDate(message.timestamp)}</sub>`
			: '';
		out.push(`## ${role}${stamp}`);
		out.push('');

		const text = message.originalContent ?? message.content;
		if (text && text.trim().length > 0) {
			out.push(text);
			out.push('');
		}

		if (message.thinking?.thinking) {
			out.push('<details><summary>Thinking</summary>');
			out.push('');
			out.push('```');
			out.push(message.thinking.thinking);
			out.push('```');
			out.push('');
			out.push('</details>');
			out.push('');
		}

		if (message.reasoning_content) {
			out.push('<details><summary>Reasoning</summary>');
			out.push('');
			out.push('```');
			out.push(message.reasoning_content);
			out.push('```');
			out.push('');
			out.push('</details>');
			out.push('');
		}

		if (message.tool_calls && message.tool_calls.length > 0) {
			for (const tc of message.tool_calls) {
				out.push(`**Tool call:** \`${tc.function.name}\``);
				out.push('');
				out.push('```json');
				out.push(tryPrettyJson(tc.function.arguments));
				out.push('```');
				out.push('');
			}
		}

		if (message.images && message.images.length > 0) {
			out.push(`_${message.images.length} image(s) attached_`);
			out.push('');
		}

		out.push('---');
		out.push('');
	}

	return out.join('\n');
}

// ---------------------------------------------------------------------------
// HTML formatter
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function roleClass(role: ChatMessage['role']): string {
	switch (role) {
		case 'user':
			return 'user';
		case 'assistant':
			return 'assistant';
		case 'tool':
			return 'tool';
		case 'system':
			return 'system';
		default:
			return 'other';
	}
}

const HTML_STYLE = `
:root {
	--bg: #fafaf9;
	--surface: #ffffff;
	--border: #e7e5e4;
	--text: #1c1917;
	--muted: #78716c;
	--user: #2563eb;
	--assistant: #0f766e;
	--tool: #b45309;
	--system: #6b7280;
	--code-bg: #f5f5f4;
}
* { box-sizing: border-box; }
body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
	font-size: 15px;
	line-height: 1.65;
}
.container {
	max-width: 860px;
	margin: 0 auto;
	padding: 48px 24px 96px;
}
header.export-header {
	border-bottom: 1px solid var(--border);
	padding-bottom: 20px;
	margin-bottom: 32px;
}
header.export-header h1 {
	margin: 0 0 12px;
	font-size: 22px;
	font-weight: 600;
	letter-spacing: -0.01em;
}
.meta-grid {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 4px 16px;
	color: var(--muted);
	font-size: 13px;
}
.meta-grid .k { color: var(--muted); }
.meta-grid .v { color: var(--text); word-break: break-all; }
.summary {
	margin: 16px 0 0;
	padding: 12px 14px;
	border-left: 3px solid var(--border);
	background: var(--surface);
	color: var(--muted);
	white-space: pre-wrap;
}
.message {
	margin: 0 0 24px;
}
.message .role {
	display: inline-block;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	padding: 3px 10px;
	border-radius: 999px;
	border: 1px solid var(--border);
	background: var(--surface);
	color: var(--muted);
	margin-bottom: 10px;
}
.message .stamp {
	display: inline-block;
	margin-left: 8px;
	font-size: 12px;
	color: var(--muted);
}
.message.user .role { color: var(--user); border-color: rgba(37,99,235,0.25); }
.message.assistant .role { color: var(--assistant); border-color: rgba(15,118,110,0.25); }
.message.tool .role { color: var(--tool); border-color: rgba(180,83,9,0.25); }
.message.system .role { color: var(--system); border-color: rgba(107,114,128,0.25); }
.message .body {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 16px 18px;
}
.message .content {
	white-space: pre-wrap;
	word-wrap: break-word;
}
.section {
	margin-top: 14px;
	padding-top: 12px;
	border-top: 1px dashed var(--border);
}
.section h4 {
	margin: 0 0 8px;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--muted);
}
pre {
	margin: 0;
	padding: 12px 14px;
	background: var(--code-bg);
	border: 1px solid var(--border);
	border-radius: 6px;
	overflow-x: auto;
	font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
	font-size: 13px;
	line-height: 1.55;
}
code {
	font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
	font-size: 0.92em;
	background: var(--code-bg);
	padding: 1px 5px;
	border-radius: 4px;
}
pre code { background: transparent; padding: 0; border-radius: 0; }
.tag {
	display: inline-block;
	background: var(--code-bg);
	color: var(--muted);
	border: 1px solid var(--border);
	border-radius: 4px;
	padding: 0 6px;
	font-size: 12px;
}
details {
	margin-top: 10px;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: var(--code-bg);
}
details > summary {
	cursor: pointer;
	padding: 8px 12px;
	color: var(--muted);
	font-size: 13px;
	user-select: none;
}
details[open] > summary {
	border-bottom: 1px solid var(--border);
}
details pre { border: 0; border-radius: 0; }
footer.export-footer {
	margin-top: 48px;
	padding-top: 16px;
	border-top: 1px solid var(--border);
	color: var(--muted);
	font-size: 12px;
	text-align: center;
}
@media (prefers-color-scheme: dark) {
	:root {
		--bg: #0c0a09;
		--surface: #1c1917;
		--border: #292524;
		--text: #f5f5f4;
		--muted: #a8a29e;
		--code-bg: #1c1917;
		--user: #60a5fa;
		--assistant: #5eead4;
		--tool: #fbbf24;
		--system: #cbd5e1;
	}
}
`;

export function formatSessionAsHtml(session: Session): string {
	const parts: string[] = [];
	const title = session.title || 'Snow AI Chat Export';

	parts.push('<!DOCTYPE html>');
	parts.push('<html lang="en">');
	parts.push('<head>');
	parts.push('<meta charset="utf-8">');
	parts.push(
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
	);
	parts.push(`<title>${escapeHtml(title)}</title>`);
	parts.push('<style>');
	parts.push(HTML_STYLE);
	parts.push('</style>');
	parts.push('</head>');
	parts.push('<body>');
	parts.push('<div class="container">');

	parts.push('<header class="export-header">');
	parts.push(`<h1>${escapeHtml(title)}</h1>`);
	parts.push('<div class="meta-grid">');
	parts.push(
		`<div class="k">Session ID</div><div class="v"><code>${escapeHtml(
			session.id,
		)}</code></div>`,
	);
	parts.push(
		`<div class="k">Created at</div><div class="v">${escapeHtml(
			formatDisplayDate(session.createdAt),
		)}</div>`,
	);
	parts.push(
		`<div class="k">Updated at</div><div class="v">${escapeHtml(
			formatDisplayDate(session.updatedAt),
		)}</div>`,
	);
	parts.push(
		`<div class="k">Messages</div><div class="v">${escapeHtml(
			String(session.messageCount ?? session.messages.length),
		)}</div>`,
	);
	if (session.projectPath) {
		parts.push(
			`<div class="k">Project</div><div class="v"><code>${escapeHtml(
				session.projectPath,
			)}</code></div>`,
		);
	}
	parts.push('</div>');
	if (session.summary) {
		parts.push(`<div class="summary">${escapeHtml(session.summary)}</div>`);
	}
	parts.push('</header>');

	for (const message of session.messages) {
		if (shouldSkip(message)) continue;

		const cls = roleClass(message.role);
		const label = getRoleLabel(message.role);
		const stamp = message.timestamp
			? `<span class="stamp">${escapeHtml(
					formatDisplayDate(message.timestamp),
			  )}</span>`
			: '';

		parts.push(`<article class="message ${cls}">`);
		parts.push(
			`<div><span class="role">${escapeHtml(label)}</span>${stamp}</div>`,
		);
		parts.push('<div class="body">');

		const text = message.originalContent ?? message.content;
		if (text && text.length > 0) {
			parts.push(`<div class="content">${escapeHtml(text)}</div>`);
		}

		if (message.thinking?.thinking) {
			parts.push('<details><summary>Thinking</summary>');
			parts.push(
				`<pre><code>${escapeHtml(message.thinking.thinking)}</code></pre>`,
			);
			parts.push('</details>');
		}

		if (message.reasoning_content) {
			parts.push('<details><summary>Reasoning</summary>');
			parts.push(
				`<pre><code>${escapeHtml(message.reasoning_content)}</code></pre>`,
			);
			parts.push('</details>');
		}

		if (message.tool_calls && message.tool_calls.length > 0) {
			for (const tc of message.tool_calls) {
				parts.push('<div class="section">');
				parts.push(
					`<h4>Tool call &middot; <span class="tag">${escapeHtml(
						tc.function.name,
					)}</span></h4>`,
				);
				parts.push(
					`<pre><code>${escapeHtml(
						tryPrettyJson(tc.function.arguments),
					)}</code></pre>`,
				);
				parts.push('</div>');
			}
		}

		if (message.role === 'tool' && message.tool_call_id) {
			parts.push(
				`<div class="section"><h4>Tool result &middot; <span class="tag">${escapeHtml(
					message.tool_call_id,
				)}</span></h4></div>`,
			);
		}

		if (message.images && message.images.length > 0) {
			parts.push(
				`<div class="section"><h4>${message.images.length} image(s) attached</h4></div>`,
			);
		}

		parts.push('</div>'); // .body
		parts.push('</article>');
	}

	parts.push('<footer class="export-footer">End of chat export</footer>');
	parts.push('</div>');
	parts.push('</body>');
	parts.push('</html>');

	return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Dispatch + IO
// ---------------------------------------------------------------------------

export function renderSession(session: Session, format: ExportFormat): string {
	switch (format) {
		case 'md':
			return formatSessionAsMarkdown(session);
		case 'html':
			return formatSessionAsHtml(session);
		case 'json':
			// Raw session entity dump — same shape as the on-disk session file
			return JSON.stringify(session, null, 2);
		case 'txt':
		default:
			return formatSessionAsText(session);
	}
}

/**
 * Export a Session entity to a file using the given format.
 *
 * The Session is the persisted source of truth (read from disk via
 * sessionManager). This intentionally does NOT accept arbitrary in-memory UI
 * messages — callers should pass the on-disk Session entity.
 */
export async function exportSessionToFile(
	session: Session,
	filePath: string,
	format: ExportFormat = 'txt',
): Promise<void> {
	const content = renderSession(session, format);
	await fs.mkdir(path.dirname(filePath), {recursive: true});
	await fs.writeFile(filePath, content, 'utf-8');
}
