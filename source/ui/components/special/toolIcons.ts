/**
 * Shared text symbols for tool call / result lines in the TUI.
 * Terminal-safe text only (no SVG or emoji).
 *
 * Theme config (`~/.snow/theme.json` -> `toolIcons`):
 *   true | false
 *   { "enabled": true, "tools": { "websearch-search": "⌕" } }
 *
 * The built-in symbols come from ZGQ-inc/special-ascii and are restricted
 * to single-column Unicode characters without the Unicode Emoji property.
 */

import {
	DEFAULT_TOOL_STATUS_ICONS,
	getToolDisplayName,
	getToolIconOverrides,
	getToolIconsEnabled,
	getToolStatusIconMap,
	getToolStatusIconsEnabled,
	type ToolStatusIconKey,
} from '../../../utils/config/themeConfig.js';

/** @deprecated Use DEFAULT_TOOL_STATUS_ICONS / getToolStatusIconMap. */
export const TOOL_STATUS_ICONS = DEFAULT_TOOL_STATUS_ICONS;

/** Fallback when no category matches. */
export const TOOL_FALLBACK_ICON = '∗';

/**
 * Exact tool-name symbols (highest priority after user overrides).
 * Keep keys identical to tool function names.
 */
export const TOOL_NAME_ICONS: Record<string, string> = {
	// Web
	'websearch-search': '⌕',
	'websearch-fetch': '⇄',

	// Filesystem
	'filesystem-read': '▤',
	'filesystem-create': '⊕',
	'filesystem-edit': '⎙',
	'filesystem-replaceedit': '≋',

	// Shell
	'terminal-execute': '⌘',

	// Code search (ACE)
	'ace-search': '⌕',

	// Tasks / memory
	'todo-manage': '≣',
	'notebook-manage': '▧',

	// IDE / docs / session
	'ide-get_diagnostics': '⁇',
	'snow-docs-list': '▤',
	'snow-docs-search': '⌕',
	'snow-docs-get': '⇄',
	'session-command-list': '≣',
	'session-command-run': '⌘',

	// User / skill
	'askuser-ask_question': '¿',
	'skill-execute': '✦',
	'codebase-search': '⧆',
};

/** Prefix -> symbol (checked after exact name). */
export const TOOL_PREFIX_ICONS: Array<{prefix: string; icon: string}> = [
	{prefix: 'websearch-', icon: '⌕'},
	{prefix: 'filesystem-', icon: '▤'},
	{prefix: 'terminal-', icon: '⌘'},
	{prefix: 'ace-', icon: '⌕'},
	{prefix: 'todo-', icon: '≣'},
	{prefix: 'notebook-', icon: '▧'},
	{prefix: 'subagent-', icon: '◈'},
	{prefix: 'snow-docs-', icon: '▤'},
	{prefix: 'session-command-', icon: '⌘'},
	{prefix: 'ide-', icon: '⁇'},
	{prefix: 'skill-', icon: '✦'},
	{prefix: 'codebase-', icon: '⧆'},
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

export function getToolStatusIcon(status: ToolStatusIconKey): string {
	if (!getToolStatusIconsEnabled()) {
		return '';
	}
	const map = getToolStatusIconMap();
	return map[status] ?? map.running ?? DEFAULT_TOOL_STATUS_ICONS.success;
}

/**
 * Compose a short tool title line (classic CLI style by default):
 *   status + category + label:
 *     "✓ ⌘ 终端命令"   or   "✓ terminal-execute"
 *   status off, category on:
 *     "⌘ 终端命令"
 *   both off:
 *     "终端命令" / technical id
 *
 * Status markers are configured through theme toolIcons.status.
 * Display names are pure user overrides from toolDisplayNames.
 */
export function formatToolTitleLine(
	toolName: string,
	status: ToolStatusIconKey = 'pending',
): string {
	const statusIcon = getToolStatusIcon(status);
	const toolIcon = getToolIcon(toolName);
	const label = getToolDisplayName(toolName) || toolName;
	return [statusIcon, toolIcon, label].filter(Boolean).join(' ');
}
