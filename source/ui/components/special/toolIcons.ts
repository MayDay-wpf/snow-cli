/**
 * Shared Unicode icons for tool call / result lines in the TUI.
 * Terminal-safe glyphs only (no SVG). Prefer widely supported emoji.
 *
 * Theme config (`~/.snow/theme.json` → `toolIcons`):
 *   true | false
 *   { "enabled": true, "tools": { "websearch-search": "🔎" } }
 *
 * Sources of inspiration: sindresorhus/figures, common CLI emoji sets,
 * and Unicode status/tool symbols used by modern terminal UIs.
 */

import {
	getToolIconOverrides,
	getToolIconsEnabled,
} from '../../../utils/config/themeConfig.js';

export const TOOL_STATUS_ICONS = {
	pending: '⚡',
	success: '✅',
	error: '❌',
	warning: '⚠️',
	running: '⏳',
} as const;

/** Fallback when no category matches. */
export const TOOL_FALLBACK_ICON = '🛠';

/**
 * Exact tool-name icons (highest priority after user overrides).
 * Keep keys identical to tool function names.
 */
export const TOOL_NAME_ICONS: Record<string, string> = {
	// Web
	'websearch-search': '🔍',
	'websearch-fetch': '🌐',

	// Filesystem
	'filesystem-read': '📖',
	'filesystem-create': '📝',
	'filesystem-edit': '✏️',
	'filesystem-replaceedit': '✂️',

	// Shell
	'terminal-execute': '💻',

	// Code search (ACE)
	'ace-search': '🔎',

	// Tasks / memory
	'todo-manage': '📋',
	'notebook-manage': '📓',

	// IDE / docs / session
	'ide-get_diagnostics': '🩺',
	'snow-docs-list': '📚',
	'snow-docs-search': '📚',
	'snow-docs-get': '📚',
	'session-command-list': '🎛',
	'session-command-run': '🎛',

	// User / skill
	'askuser-ask_question': '❓',
	'skill-execute': '✨',
	'codebase-search': '🧭',
};

/** Prefix → icon (checked after exact name). */
export const TOOL_PREFIX_ICONS: Array<{prefix: string; icon: string}> = [
	{prefix: 'websearch-', icon: '🔍'},
	{prefix: 'filesystem-', icon: '📁'},
	{prefix: 'terminal-', icon: '💻'},
	{prefix: 'ace-', icon: '🔎'},
	{prefix: 'todo-', icon: '📋'},
	{prefix: 'notebook-', icon: '📓'},
	{prefix: 'subagent-', icon: '🤖'},
	{prefix: 'snow-docs-', icon: '📚'},
	{prefix: 'session-command-', icon: '🎛'},
	{prefix: 'ide-', icon: '🩺'},
	{prefix: 'skill-', icon: '✨'},
	{prefix: 'codebase-', icon: '🧭'},
];

function resolveBuiltinToolIcon(toolName: string): string {
	const exact = TOOL_NAME_ICONS[toolName];
	if (exact) {
		return exact;
	}
	for (const {prefix, icon} of TOOL_PREFIX_ICONS) {
		if (toolName.startsWith(prefix)) {
			return icon;
		}
	}
	return TOOL_FALLBACK_ICON;
}

/**
 * Resolve category icon for a tool name.
 * Returns empty string when tool icons are disabled in theme config.
 */
export function getToolIcon(toolName: string | undefined | null): string {
	if (!toolName) {
		return getToolIconsEnabled() ? TOOL_FALLBACK_ICON : '';
	}
	if (!getToolIconsEnabled()) {
		return '';
	}
	const overrides = getToolIconOverrides();
	const override = overrides[toolName];
	if (override) {
		return override;
	}
	return resolveBuiltinToolIcon(toolName);
}

export function getToolStatusIcon(
	status: 'pending' | 'success' | 'error' | 'warning' | 'running',
): string {
	return TOOL_STATUS_ICONS[status] ?? TOOL_STATUS_ICONS.running;
}

/**
 * Compose a short tool title line:
 *   enabled:  "✅ 🔍 websearch-search"
 *   disabled: "✅ websearch-search"
 */
export function formatToolTitleLine(
	toolName: string,
	status: 'pending' | 'success' | 'error' | 'warning' | 'running' = 'pending',
): string {
	const statusIcon = getToolStatusIcon(status);
	const toolIcon = getToolIcon(toolName);
	if (toolIcon) {
		return `${statusIcon} ${toolIcon} ${toolName}`;
	}
	return `${statusIcon} ${toolName}`;
}
