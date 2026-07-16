import type {HookType} from '../../../utils/config/hooksConfig.js';
import type {HookStatusPhase} from '../../../utils/execution/hookStatusEvents.js';

/**
 * Shared Unicode icon set for Hook TUI surfaces.
 * Terminal-safe glyphs only (no SVG). Prefer widely supported emoji
 * (inspired by figures + common CLI emoji packs).
 */

export const HOOK_FALLBACK_ICON = '🪝';

/** Per-hook-type icons — each type should be visually distinct. */
export const HOOK_TYPE_ICONS: Record<HookType, string> = {
	onUserMessage: '💬',
	beforeToolCall: '🔧',
	afterToolCall: '📤',
	toolConfirmation: '🛡',
	onSubAgentComplete: '🤖',
	beforeCompress: '🗜',
	onSessionStart: '🚀',
	onStop: '🛑',
};

/** Phase badges shown beside the type icon. */
export const HOOK_PHASE_ICONS: Record<
	HookStatusPhase,
	{icon: string; colorKey: 'info' | 'success' | 'error' | 'secondary'}
> = {
	idle: {icon: '○', colorKey: 'secondary'},
	start: {icon: '▶', colorKey: 'info'},
	action: {icon: '⏳', colorKey: 'info'},
	success: {icon: '✅', colorKey: 'success'},
	failed: {icon: '❌', colorKey: 'error'},
};

/** Action-type glyphs on the secondary status line. */
export const HOOK_ACTION_ICONS = {
	command: '⌘',
	prompt: '✨',
	default: '•',
} as const;

/** Decorative icons for error trees / labels. */
export const HOOK_DECOR_ICONS = {
	hook: '🪝',
	warning: '⚠️',
	error: '❌',
	gear: '⚙',
	output: '📄',
	treeBranch: '├─',
	treeEnd: '└─',
	done: '🏁',
	running: '⏳',
	bullet: '•',
	info: 'ℹ',
	star: '★',
	fire: '🔥',
	search: '🔍',
	globe: '🌐',
	package: '📦',
} as const;

export function getHookTypeIcon(hookType: HookType | string): string {
	return HOOK_TYPE_ICONS[hookType as HookType] ?? HOOK_FALLBACK_ICON;
}

export function getHookActionIcon(actionType?: 'command' | 'prompt'): string {
	if (actionType === 'prompt') {
		return HOOK_ACTION_ICONS.prompt;
	}
	if (actionType === 'command') {
		return HOOK_ACTION_ICONS.command;
	}
	return HOOK_ACTION_ICONS.default;
}
