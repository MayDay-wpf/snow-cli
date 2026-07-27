/**
 * Allowlist metadata for session/slash control plane (issue #190).
 */

import type {
	SessionCommandMeta,
	SessionCommandRisk,
} from './sessionCommandTypes.js';

function meta(
	id: string,
	command: string,
	risk: SessionCommandRisk,
	description: string,
	options?: {
		subcommand?: string;
		headlessSupported?: boolean;
		requiresConfirm?: boolean;
	},
): SessionCommandMeta {
	return {
		id,
		command,
		subcommand: options?.subcommand,
		risk,
		description,
		headlessSupported: options?.headlessSupported ?? true,
		requiresConfirm:
			options?.requiresConfirm ??
			(risk === 'medium_write' || risk === 'high_risk'),
	};
}

/**
 * Explicit allowlist. Commands not listed are rejected with UNKNOWN_COMMAND
 * from the control plane (even if a TUI slash handler exists).
 */
export const SESSION_COMMAND_ALLOWLIST: SessionCommandMeta[] = [
	// buddy
	meta('buddy.status', 'buddy', 'read', 'Show buddy companion status', {
		subcommand: 'status',
	}),
	meta('buddy.hatch', 'buddy', 'low_write', 'Hatch a new buddy companion', {
		subcommand: 'hatch',
	}),
	meta('buddy.pet', 'buddy', 'low_write', 'Pet the buddy companion', {
		subcommand: 'pet',
	}),
	meta('buddy.rename', 'buddy', 'low_write', 'Rename the buddy companion', {
		subcommand: 'rename',
	}),
	meta(
		'buddy.set',
		'buddy',
		'low_write',
		'Customize buddy appearance and personality',
		{
			subcommand: 'set',
		},
	),
	meta('buddy.mute', 'buddy', 'low_write', 'Mute buddy UI and prompt context', {
		subcommand: 'mute',
	}),
	meta('buddy.unmute', 'buddy', 'low_write', 'Unmute buddy', {
		subcommand: 'unmute',
	}),
	meta(
		'buddy.profile',
		'buddy',
		'low_write',
		'Buddy AI profile list/current/set',
		{
			subcommand: 'profile',
		},
	),
	meta('buddy.reset', 'buddy', 'high_risk', 'Reset/remove buddy companion', {
		subcommand: 'reset',
		requiresConfirm: true,
	}),
	meta('buddy.species', 'buddy', 'read', 'List available buddy species', {
		subcommand: 'species',
	}),
	meta(
		'buddy.say',
		'buddy',
		'low_write',
		'Send a message to the buddy companion',
		{
			subcommand: 'say',
		},
	),

	// display / theme
	meta('theme.status', 'theme', 'read', 'Show theme and display settings', {
		subcommand: 'status',
	}),
	meta('theme.set', 'theme', 'low_write', 'Set theme and display settings', {
		subcommand: 'set',
	}),
	meta(
		'theme.colors',
		'theme',
		'low_write',
		'Set custom theme colors (JSON) with hot-refresh, no restart',
		{
			subcommand: 'colors',
		},
	),
	meta(
		'statusline.status',
		'statusline',
		'read',
		'List statusline plugins and builtin ids',
		{subcommand: 'status'},
	),
	meta('simple', 'simple', 'low_write', 'Toggle or set simple mode'),
	meta(
		'agents-inject',
		'agents-inject',
		'low_write',
		'Toggle or set AGENTS.md context inject (contextInject.enabled)',
	),
	meta(
		'tool-display',
		'tool-display',
		'low_write',
		'Get or set tool display density',
	),
	meta(
		'think-display',
		'think-display',
		'low_write',
		'Get or set think display density',
	),
	meta(
		'subagent-display',
		'subagent-display',
		'low_write',
		'Get or set sub-agent live panel density',
	),
	meta(
		'display',
		'display',
		'low_write',
		'Unified display settings for tool/think/subagent',
	),
	meta(
		'image-compress',
		'image-compress',
		'low_write',
		'Toggle or set image compression',
	),

	// modes
	meta('yolo', 'yolo', 'medium_write', 'Get or set YOLO mode', {
		requiresConfirm: true,
	}),
	meta('plan', 'plan', 'medium_write', 'Get or set Plan mode', {
		requiresConfirm: true,
	}),
	meta(
		'tool-search',
		'tool-search',
		'medium_write',
		'Get or set tool-search mode',
		{requiresConfirm: true},
	),
	meta(
		'vulnerability-hunting',
		'vulnerability-hunting',
		'medium_write',
		'Get or set vulnerability hunting mode',
		{requiresConfirm: true},
	),
	meta('team', 'team', 'medium_write', 'Get or set team mode', {
		requiresConfirm: true,
	}),
	meta(
		'ultra-todo',
		'ultra-todo',
		'medium_write',
		'Get or set ultra-todo mode',
		{requiresConfirm: true},
	),

	// config / connectivity
	meta('mcp.status', 'mcp', 'read', 'List MCP services status', {
		subcommand: 'status',
	}),
	meta('mcp.reconnect', 'mcp', 'medium_write', 'Reconnect an MCP service', {
		subcommand: 'reconnect',
		requiresConfirm: true,
	}),
	meta('mcp.enable', 'mcp', 'medium_write', 'Enable an MCP service or tool', {
		subcommand: 'enable',
		requiresConfirm: true,
	}),
	meta('mcp.disable', 'mcp', 'medium_write', 'Disable an MCP service or tool', {
		subcommand: 'disable',
		requiresConfirm: true,
	}),
	meta('ide.status', 'ide', 'read', 'Show IDE connection status', {
		subcommand: 'status',
	}),
	meta('ide.connect', 'ide', 'medium_write', 'Connect to IDE extension', {
		subcommand: 'connect',
		requiresConfirm: true,
	}),
	meta(
		'ide.disconnect',
		'ide',
		'medium_write',
		'Disconnect from IDE extension',
		{
			subcommand: 'disconnect',
			requiresConfirm: true,
		},
	),
	meta(
		'connection-status',
		'connection-status',
		'read',
		'Alias for ide.status',
	),
	meta('profiles.list', 'profiles', 'read', 'List profiles', {
		subcommand: 'list',
	}),
	meta('profiles.current', 'profiles', 'read', 'Show current profile', {
		subcommand: 'current',
	}),
	meta('profiles.switch', 'profiles', 'medium_write', 'Switch active profile', {
		subcommand: 'switch',
		requiresConfirm: true,
	}),
	meta(
		'codebase',
		'codebase',
		'medium_write',
		'Codebase enable/status and agent-review/reranking toggles',
		{
			requiresConfirm: true,
		},
	),
	meta('reindex', 'reindex', 'medium_write', 'Trigger codebase reindex', {
		requiresConfirm: true,
	}),
	meta('auto-format', 'auto-format', 'low_write', 'Toggle or set auto-format'),
	meta(
		'hybrid-compress',
		'hybrid-compress',
		'low_write',
		'Toggle or set hybrid compress',
	),
	meta(
		'speedometer',
		'speedometer',
		'low_write',
		'Toggle or set token rate speedometer',
	),
	meta(
		'subagent-depth',
		'subagent-depth',
		'low_write',
		'Get or set sub-agent max spawn depth',
	),
	meta(
		'file-list-display',
		'file-list-display',
		'low_write',
		'Get or set file list display mode (list|tree)',
	),
	meta(
		'language',
		'language',
		'low_write',
		'Get or set UI language (en|zh|zh-TW)',
	),
	meta(
		'show-thinking',
		'show-thinking',
		'low_write',
		'Toggle or set show-thinking UI preference',
	),
	meta(
		'privacy',
		'privacy',
		'medium_write',
		'Get or set privacy enabled/mode (no secrets)',
		{requiresConfirm: true},
	),
	meta('telemetry', 'telemetry', 'medium_write', 'Telemetry status/toggle', {
		requiresConfirm: true,
	}),
	meta('usage', 'usage', 'read', 'Usage snapshot (headless summary)'),

	// session automation (P2)
	meta('compact', 'compact', 'medium_write', 'Compact conversation context', {
		requiresConfirm: true,
		headlessSupported: true,
	}),
	meta('export', 'export', 'low_write', 'Export session (headless path)', {
		requiresConfirm: false,
	}),
	meta(
		'permissions.status',
		'permissions',
		'read',
		'Permissions status query',
		{
			subcommand: 'status',
		},
	),
	meta(
		'permissions.allow',
		'permissions',
		'medium_write',
		'Always-approve a tool',
		{subcommand: 'allow', requiresConfirm: true},
	),
	meta(
		'permissions.revoke',
		'permissions',
		'medium_write',
		'Revoke always-approve for a tool',
		{subcommand: 'revoke', requiresConfirm: true},
	),
	meta(
		'permissions.clear',
		'permissions',
		'high_risk',
		'Clear all always-approved tools',
		{subcommand: 'clear', requiresConfirm: true},
	),

	// session lifecycle
	meta('session.list', 'session', 'read', 'List sessions', {
		subcommand: 'list',
	}),
	meta('session.current', 'session', 'read', 'Show current session', {
		subcommand: 'current',
	}),
	meta('session.resume', 'session', 'medium_write', 'Resume/load a session', {
		subcommand: 'resume',
		requiresConfirm: true,
	}),
	meta(
		'session.load',
		'session',
		'medium_write',
		'Load a session (alias of resume)',
		{
			subcommand: 'load',
			requiresConfirm: true,
		},
	),
	meta(
		'session.branch',
		'session',
		'medium_write',
		'Fork current session into a branch',
		{
			subcommand: 'branch',
			requiresConfirm: true,
		},
	),

	// goal / loop / skills
	meta('goal.status', 'goal', 'read', 'Show current goal status', {
		subcommand: 'status',
	}),
	meta('goal.create', 'goal', 'low_write', 'Create a goal objective', {
		subcommand: 'create',
	}),
	meta('goal.pause', 'goal', 'medium_write', 'Pause the current goal', {
		subcommand: 'pause',
		requiresConfirm: true,
	}),
	meta('goal.resume', 'goal', 'medium_write', 'Resume the current goal', {
		subcommand: 'resume',
		requiresConfirm: true,
	}),
	meta('goal.clear', 'goal', 'medium_write', 'Clear the current goal', {
		subcommand: 'clear',
		requiresConfirm: true,
	}),
	meta('loop.list', 'loop', 'read', 'List scheduled loops', {
		subcommand: 'list',
	}),
	meta('loop.create', 'loop', 'medium_write', 'Create a scheduled loop', {
		subcommand: 'create',
		requiresConfirm: true,
	}),
	meta('loop.cancel', 'loop', 'medium_write', 'Cancel a scheduled loop', {
		subcommand: 'cancel',
		requiresConfirm: true,
	}),
	meta('loop.tasks', 'loop', 'read', 'List loop-related tasks', {
		subcommand: 'tasks',
	}),
	meta('skills.list', 'skills', 'read', 'List available skills', {
		subcommand: 'list',
	}),
	meta('skills.status', 'skills', 'read', 'Show skill enablement status', {
		subcommand: 'status',
	}),
	meta('skills.enable', 'skills', 'medium_write', 'Enable a skill', {
		subcommand: 'enable',
		requiresConfirm: true,
	}),
	meta('skills.disable', 'skills', 'medium_write', 'Disable a skill', {
		subcommand: 'disable',
		requiresConfirm: true,
	}),

	// help / config / home
	meta('help', 'help', 'read', 'List top control-plane commands and examples'),
	meta('config.snapshot', 'config', 'read', 'Safe non-secret config snapshot', {
		subcommand: 'snapshot',
	}),
	meta(
		'config.status',
		'config',
		'read',
		'Show active API limits (maxContextTokens/maxTokens/models)',
		{subcommand: 'status'},
	),
	meta(
		'config.set',
		'config',
		'low_write',
		'Hot-set active API limits (maxContextTokens/maxTokens)',
		{subcommand: 'set'},
	),
	meta('home', 'home', 'read', 'TUI home navigation (headless unsupported)', {
		headlessSupported: false,
	}),
	meta(
		'session-command.list',
		'session-command',
		'read',
		'List allowlisted control-plane commands',
		{subcommand: 'list'},
	),
];

const byId = new Map(SESSION_COMMAND_ALLOWLIST.map(item => [item.id, item]));

export function listSessionCommands(): SessionCommandMeta[] {
	return [...SESSION_COMMAND_ALLOWLIST];
}

export function getSessionCommandMetaById(
	id: string,
): SessionCommandMeta | undefined {
	return byId.get(id);
}

/**
 * Resolve allowlist entry from raw command + args.
 * Supports dotted form: "buddy.hatch" as command with empty args.
 */
export function resolveSessionCommandMeta(
	command: string,
	args?: string,
): SessionCommandMeta | undefined {
	const raw = command.trim().replace(/^\//, '');
	if (!raw) {
		return undefined;
	}

	// Dotted form: buddy.hatch
	if (raw.includes('.')) {
		const exact = byId.get(raw);
		if (exact) {
			return exact;
		}
	}

	const parts = `${raw}${args ? ` ${args}` : ''}`
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const top = parts[0] ?? '';
	const sub = parts[1];

	// Prefer exact command+subcommand match
	if (sub) {
		const withSub = SESSION_COMMAND_ALLOWLIST.find(
			item => item.command === top && item.subcommand === sub,
		);
		if (withSub) {
			return withSub;
		}
	}

	// Bare command default (e.g. buddy -> buddy.status, mcp -> mcp.status)
	const bareDefaults: Record<string, string> = {
		buddy: 'buddy.status',
		theme: 'theme.status',
		statusline: 'statusline.status',
		mcp: 'mcp.status',
		ide: 'ide.status',
		profiles: 'profiles.list',
		permissions: 'permissions.status',
		session: 'session.list',
		goal: 'goal.status',
		loop: 'loop.list',
		skills: 'skills.list',
		config: 'config.snapshot',
		'session-command': 'session-command.list',
	};
	if (!sub && bareDefaults[top]) {
		return byId.get(bareDefaults[top]!);
	}

	// Commands without subcommand metadata
	const plain = SESSION_COMMAND_ALLOWLIST.find(
		item => item.command === top && !item.subcommand,
	);
	if (plain) {
		return plain;
	}
	// profiles create|delete|rename|switch <name>
	if (top === 'profiles' && sub === 'create') {
		return byId.get('profiles.create');
	}
	if (
		top === 'profiles' &&
		(sub === 'delete' || sub === 'remove' || sub === 'rm')
	) {
		return byId.get('profiles.delete');
	}
	if (top === 'profiles' && sub === 'rename') {
		return byId.get('profiles.rename');
	}
	if (top === 'profiles' && sub && sub !== 'list' && sub !== 'current') {
		return byId.get('profiles.switch');
	}

	// config set maxContextTokens=... | config status
	if (top === 'config' && sub === 'set') {
		return byId.get('config.set');
	}
	if (top === 'config' && (sub === 'status' || sub === 'get')) {
		return byId.get('config.status');
	}

	return undefined;
}

/** Whether risk tier requires confirmation for a given mode. */
export function needsConfirmation(
	meta: SessionCommandMeta,
	mode: 'cli' | 'agent' | 'sse',
	confirm?: boolean,
): boolean {
	if (confirm) {
		return false;
	}

	if (meta.risk === 'read' || meta.risk === 'low_write') {
		// Agent/SSE low_write allowed; CLI also allowed without --yes
		return false;
	}

	if (meta.risk === 'medium_write') {
		// All modes need confirm for medium writes by default
		return meta.requiresConfirm !== false;
	}

	// high_risk always requires confirm
	if (meta.risk === 'high_risk') {
		return true;
	}

	// mode currently unused but reserved for future per-mode policy
	void mode;
	return Boolean(meta.requiresConfirm);
}
