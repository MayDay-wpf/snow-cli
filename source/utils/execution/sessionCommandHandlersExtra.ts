/**
 * Extra headless handlers for session control plane phases 2-4 (issue #190).
 */

import {
	getSimpleMode,
	setSimpleMode,
	getToolDisplayMode,
	setToolDisplayMode,
	getToolIconsEnabled,
	setToolIconsEnabled,
	setToolIconOverride,
	getToolIconOverrides,
	getToolStatusIconsEnabled,
	setToolStatusIconsEnabled,
	setToolStatusIconOverride,
	getToolDisplayNames,
	setToolDisplayName,
	getThinkDisplayMode,
	setThinkDisplayMode,
	getCurrentTheme,
	setCurrentTheme,
	getDiffOpacity,
	setDiffOpacity,
	getCustomColors,
	saveCustomColors,
	type ToolDisplayMode,
	type ThinkDisplayMode,
} from '../config/themeConfig.js';
import {configEvents} from '../config/configEvents.js';
import {defaultCustomColors, type ThemeColors} from '../../ui/themes/index.js';
import {
	getYoloMode,
	getPlanMode,
	getToolSearchEnabled,
	getTelemetryEnabled,
	getAutoFormatEnabled,
	getImageCompressEnabled,
	getHybridCompressEnabled,
	getSpeedometerEnabled,
	getSubAgentMaxSpawnDepth,
	getFileListDisplayMode,
	getTeamMode,
	getUltraTodoEnabled,
	getVulnerabilityHuntingMode,
} from '../config/projectSettings.js';
import {getActiveProfileName} from '../config/configManager.js';
import {
	isCodebaseEnabled,
	loadCodebaseConfig,
} from '../config/codebaseConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {getSnowConfig, updateSnowConfig} from '../config/apiConfig.js';
import {readSettings} from '../config/unifiedSettings.js';
import {
	loadPermissionsConfig,
	addToolToPermissions,
	removeToolFromPermissions,
	clearAllPermissions,
} from '../config/permissionsConfig.js';
import type {ThemeType} from '../../ui/themes/index.js';
import {themes} from '../../ui/themes/index.js';
import {
	failResult,
	okResult,
	type SessionCommandMeta,
	type SessionCommandResult,
} from './sessionCommandTypes.js';

function parseTokens(args?: string): string[] {
	return (args ?? '').trim().split(/\s+/).filter(Boolean);
}

const THEME_TYPES = Object.keys(themes) as ThemeType[];

function isThemeType(value: string): value is ThemeType {
	return THEME_TYPES.includes(value as ThemeType);
}

function applyCustomThemeColors(
	meta: SessionCommandMeta,
	rawJson: string,
): SessionCommandResult {
	const trimmed = rawJson.trim();
	if (!trimmed) {
		return failResult(
			meta.id,
			'INVALID_ARGS',
			'Usage: theme colors <json> | theme set colors=<json>',
			meta.risk,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return failResult(
			meta.id,
			'INVALID_ARGS',
			'customColors must be valid JSON object',
			meta.risk,
		);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return failResult(
			meta.id,
			'INVALID_ARGS',
			'customColors must be a JSON object of color keys',
			meta.risk,
		);
	}

	const colors: ThemeColors = {
		...defaultCustomColors,
		...(parsed as Partial<ThemeColors>),
	};
	if (!colors.logoGradient) {
		colors.logoGradient = defaultCustomColors.logoGradient;
	}

	saveCustomColors(colors);
	setCurrentTheme('custom');
	// saveCustomColors already emits customColors; also flip theme type for TUI.
	configEvents.emitConfigChange({type: 'theme', value: 'custom'});

	return okResult(
		meta.id,
		{
			changed: {theme: 'custom' as ThemeType, customColors: true},
			theme: getCurrentTheme(),
			hasCustomColors: true,
		},
		'Custom theme colors applied (hot-refresh, no restart).',
		meta.risk,
	);
}

function goalPublic(goal: {
	id: string;
	sessionId: string;
	objective: string;
	status: string;
	tokenBudget?: number;
	tokensUsed: number;
	runCount: number;
	createdAt: number;
	updatedAt: number;
	lastExplanation?: string;
	lastError?: string;
	pendingContinuation: boolean;
}) {
	return {
		id: goal.id,
		sessionId: goal.sessionId,
		objective: goal.objective,
		status: goal.status,
		tokenBudget: goal.tokenBudget ?? null,
		tokensUsed: goal.tokensUsed,
		runCount: goal.runCount,
		createdAt: goal.createdAt,
		updatedAt: goal.updatedAt,
		lastExplanation: goal.lastExplanation ?? null,
		lastError: goal.lastError ?? null,
		pendingContinuation: goal.pendingContinuation,
	};
}

export function handleTheme(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'status';

	if (sub === 'status' || sub === '') {
		const theme = getCurrentTheme();
		const simpleMode = getSimpleMode();
		const toolDisplay = getToolDisplayMode();
		const thinkDisplay = getThinkDisplayMode();
		const diffOpacity = getDiffOpacity();
		const toolIcons = getToolIconsEnabled();
		const toolIconOverrides = getToolIconOverrides();
		const toolStatusIcons = getToolStatusIconsEnabled();
		const toolDisplayNames = getToolDisplayNames();
		const hasCustomColors = Boolean(getCustomColors());
		return okResult(
			meta.id,
			{
				theme,
				simpleMode,
				toolDisplay,
				thinkDisplay,
				diffOpacity,
				toolIcons,
				toolIconOverrides,
				toolStatusIcons,
				toolDisplayNames,
				hasCustomColors,
				availableThemes: THEME_TYPES,
			},
			`Theme: ${theme}, simple=${simpleMode ? 'on' : 'off'}, toolIcons=${
				toolIcons ? 'on' : 'off'
			}, toolNames=${Object.keys(toolDisplayNames).length}`,
			meta.risk,
		);
	}

	// theme colors / customColors — apply custom palette with hot-refresh.
	// Accepts: theme colors <json> | theme set colors=<json> | theme set customColors=<json>
	if (sub === 'colors' || sub === 'customcolors') {
		const raw =
			meta.subcommand === 'colors' || meta.subcommand === 'customcolors'
				? (args ?? '').trim()
				: tokens.slice(1).join(' ').trim();
		return applyCustomThemeColors(meta, raw);
	}

	if (sub === 'set') {
		const changed: {
			theme?: ThemeType;
			simpleMode?: boolean;
			toolDisplay?: string;
			thinkDisplay?: string;
			diffOpacity?: number;
			toolIcons?: boolean | string;
			toolDisplayNames?: string;
			customColors?: boolean;
		} = {};
		const rawTokens =
			meta.subcommand === 'set'
				? tokens
				: tokens[0] === 'set'
				? tokens.slice(1)
				: tokens;

		if (rawTokens.length === 0) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: theme set <themeName>|theme=<name>|simpleMode=true|false|toolDisplay=...|toolIcons=on|off|toolDisplayNames=<tool>:<name>|thinkDisplay=...|diffOpacity=0..1|colors=<json>|customColors=<json>',
				meta.risk,
			);
		}

		// theme set colors=<json...>  (JSON may contain spaces / equals)
		const joined = rawTokens.join(' ');
		const colorsEq = joined.match(/^(?:colors|customcolors)=(.*)$/i);
		if (colorsEq) {
			return applyCustomThemeColors(meta, colorsEq[1] ?? '');
		}

		if (rawTokens.length === 1 && !rawTokens[0]!.includes('=')) {
			const name = rawTokens[0]!.toLowerCase();
			if (!isThemeType(name)) {
				return failResult(
					meta.id,
					'INVALID_ARGS',
					`Invalid theme "${name}". Available: ${THEME_TYPES.join(', ')}`,
					meta.risk,
				);
			}
			setCurrentTheme(name);
			configEvents.emitConfigChange({type: 'theme', value: name});
			changed.theme = name;
			return okResult(
				meta.id,
				{changed, theme: getCurrentTheme()},
				`Theme set to ${name}`,
				meta.risk,
			);
		}

		for (let i = 0; i < rawTokens.length; i++) {
			const token = rawTokens[i]!;
			const eq = token.indexOf('=');
			if (eq > 0) {
				const key = token.slice(0, eq).toLowerCase();
				const value = token.slice(eq + 1);
				if (key === 'theme') {
					if (!isThemeType(value)) {
						return failResult(
							meta.id,
							'INVALID_ARGS',
							`Invalid theme "${value}". Available: ${THEME_TYPES.join(', ')}`,
							meta.risk,
						);
					}
					setCurrentTheme(value);
					configEvents.emitConfigChange({type: 'theme', value});
					changed.theme = value;
					continue;
				}
				if (key === 'simplemode' || key === 'simple') {
					const lower = value.toLowerCase();
					if (!['true', 'false', 'on', 'off', '1', '0'].includes(lower)) {
						return failResult(
							meta.id,
							'INVALID_ARGS',
							'simpleMode must be true|false|on|off',
							meta.risk,
						);
					}
					const enabled = ['true', 'on', '1'].includes(lower);
					setSimpleMode(enabled);
					configEvents.emitConfigChange({type: 'simpleMode', value: enabled});
					changed.simpleMode = enabled;
					continue;
				}
				if (key === 'tooldisplay') {
					const mode = value.toLowerCase();
					if (mode !== 'full' && mode !== 'compact' && mode !== 'hidden') {
						return failResult(
							meta.id,
							'INVALID_ARGS',
							'toolDisplay must be full|compact|hidden',
							meta.risk,
						);
					}
					setToolDisplayMode(mode as ToolDisplayMode);
					configEvents.emitConfigChange({type: 'toolDisplayMode', value: mode});
					changed.toolDisplay = mode;
					continue;
				}
				if (key === 'toolicons' || key === 'toolicon' || key === 'tool-icons') {
					const lower = value.toLowerCase();
					if (['true', 'false', 'on', 'off', '1', '0'].includes(lower)) {
						const enabled = ['true', 'on', '1'].includes(lower);
						setToolIconsEnabled(enabled);
						changed.toolIcons = enabled;
						continue;
					}
					// toolIcons=status:on|off  or toolIcons=status:success:✓
					if (lower.startsWith('status:') || lower.startsWith('status=')) {
						const rest = value.slice(value.indexOf(':') + 1).trim();
						const restLower = rest.toLowerCase();
						if (['true', 'false', 'on', 'off', '1', '0'].includes(restLower)) {
							const enabled = ['true', 'on', '1'].includes(restLower);
							setToolStatusIconsEnabled(enabled);
							changed.toolIcons = `status=${enabled ? 'on' : 'off'}`;
							continue;
						}
						const sc = rest.indexOf(':');
						if (sc > 0) {
							const sk = rest.slice(0, sc).trim().toLowerCase();
							const glyph = rest.slice(sc + 1);
							if (
								['pending', 'success', 'error', 'warning', 'running'].includes(
									sk,
								)
							) {
								setToolStatusIconOverride(sk as any, glyph);
								changed.toolIcons = `status:${sk}=${glyph || '(default)'}`;
								continue;
							}
						}
						return failResult(
							meta.id,
							'INVALID_ARGS',
							'toolIcons status must be on|off or status:<key>:<glyph>',
							meta.risk,
						);
					}
					// toolIcons=websearch-search:🔎  or toolIcons=terminal-execute=
					const colon = value.indexOf(':');
					if (colon > 0) {
						const toolName = value.slice(0, colon).trim();
						const icon = value.slice(colon + 1);
						setToolIconOverride(toolName, icon);
						changed.toolIcons = `${toolName}=${icon || '(cleared)'}`;
						continue;
					}
					return failResult(
						meta.id,
						'INVALID_ARGS',
						'toolIcons must be on|off | status:on|off | status:<key>:<glyph> | <tool>:<emoji>',
						meta.risk,
					);
				}
				if (
					key === 'tooldisplaynames' ||
					key === 'tooldisplayname' ||
					key === 'tool-names' ||
					key === 'toolnames'
				) {
					// toolDisplayNames=websearch-search:网页搜索  or toolDisplayNames=websearch-search:
					const colon = value.indexOf(':');
					if (colon > 0) {
						const toolName = value.slice(0, colon).trim();
						const displayName = value.slice(colon + 1);
						if (!toolName) {
							return failResult(
								meta.id,
								'INVALID_ARGS',
								'toolDisplayNames requires <toolName>:<displayName>',
								meta.risk,
							);
						}
						setToolDisplayName(toolName, displayName);
						changed.toolDisplayNames = displayName.trim()
							? `${toolName}=${displayName.trim()}`
							: `${toolName}=(cleared)`;
						continue;
					}
					return failResult(
						meta.id,
						'INVALID_ARGS',
						'toolDisplayNames must be <toolName>:<displayName> (empty after : clears)',
						meta.risk,
					);
				}
				if (key === 'thinkdisplay') {
					const mode = value.toLowerCase();
					if (mode !== 'full' && mode !== 'compact') {
						return failResult(
							meta.id,
							'INVALID_ARGS',
							'thinkDisplay must be full|compact',
							meta.risk,
						);
					}
					setThinkDisplayMode(mode as ThinkDisplayMode);
					configEvents.emitConfigChange({
						type: 'thinkDisplayMode',
						value: mode,
					});
					changed.thinkDisplay = mode;
					continue;
				}
				if (key === 'diffopacity') {
					const num = Number(value);
					if (!Number.isFinite(num) || num < 0 || num > 1) {
						return failResult(
							meta.id,
							'INVALID_ARGS',
							'diffOpacity must be a number between 0 and 1',
							meta.risk,
						);
					}
					setDiffOpacity(num);
					configEvents.emitConfigChange({type: 'diffOpacity', value: num});
					changed.diffOpacity = num;
					continue;
				}
				return failResult(
					meta.id,
					'INVALID_ARGS',
					`Unknown theme setting "${key}"`,
					meta.risk,
				);
			}

			const lower = token.toLowerCase();
			if (lower === 'simple' && rawTokens[i + 1]) {
				const next = rawTokens[++i]!.toLowerCase();
				if (next !== 'on' && next !== 'off') {
					return failResult(
						meta.id,
						'INVALID_ARGS',
						'Usage: theme set simple on|off',
						meta.risk,
					);
				}
				const enabled = next === 'on';
				setSimpleMode(enabled);
				configEvents.emitConfigChange({type: 'simpleMode', value: enabled});
				changed.simpleMode = enabled;
				continue;
			}

			return failResult(
				meta.id,
				'INVALID_ARGS',
				`Invalid theme set argument "${token}"`,
				meta.risk,
			);
		}

		if (Object.keys(changed).length === 0) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'No theme settings changed.',
				meta.risk,
			);
		}

		return okResult(
			meta.id,
			{
				changed,
				theme: getCurrentTheme(),
				simpleMode: getSimpleMode(),
				toolDisplay: getToolDisplayMode(),
				thinkDisplay: getThinkDisplayMode(),
				diffOpacity: getDiffOpacity(),
			},
			'Theme settings updated.',
			meta.risk,
		);
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown theme subcommand "${sub}"`,
		meta.risk,
	);
}

export async function handleStatusline(
	meta: SessionCommandMeta,
): Promise<SessionCommandResult> {
	try {
		const {existsSync, readdirSync} = await import('node:fs');
		const {join} = await import('node:path');
		const {STATUSLINE_HOOKS_DIR} = await import('../config/apiConfig.js');
		const {BUILTIN_STATUSLINE_IDS} = await import(
			'../../ui/components/common/statusline/builtinIds.js'
		);

		const plugins: Array<{name: string; path: string}> = [];
		if (existsSync(STATUSLINE_HOOKS_DIR)) {
			const entries = readdirSync(STATUSLINE_HOOKS_DIR, {withFileTypes: true});
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				if (!/\.(js|mjs|cjs)$/i.test(entry.name)) continue;
				plugins.push({
					name: entry.name.replace(/\.(js|mjs|cjs)$/i, ''),
					path: join(STATUSLINE_HOOKS_DIR, entry.name),
				});
			}
		}

		const builtinIds = Object.values(BUILTIN_STATUSLINE_IDS);
		return okResult(
			meta.id,
			{
				pluginDir: STATUSLINE_HOOKS_DIR,
				plugins,
				builtinIds,
			},
			`Statusline plugins: ${plugins.length}, builtins: ${builtinIds.length}`,
			meta.risk,
		);
	} catch (error) {
		return failResult(
			meta.id,
			'EXECUTION_FAILED',
			error instanceof Error
				? error.message
				: 'Failed to scan statusline plugins',
			meta.risk,
		);
	}
}

export async function handleMcpManage(
	meta: SessionCommandMeta,
	args: string | undefined,
	handleMcpStatus: (meta: SessionCommandMeta) => Promise<SessionCommandResult>,
): Promise<SessionCommandResult> {
	const sub = meta.subcommand ?? 'status';
	if (sub === 'status' || sub === '') {
		return handleMcpStatus(meta);
	}

	const tokens = parseTokens(args);

	if (sub === 'reconnect') {
		const serviceName = tokens.join(' ').trim();
		if (!serviceName) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: mcp reconnect <service>',
				meta.risk,
			);
		}
		try {
			const {reconnectMCPService} = await import('./mcpToolsManager.js');
			const {getMCPConfig} = await import('../config/apiConfig.js');
			const config = getMCPConfig();
			if (!config.mcpServers?.[serviceName]) {
				return failResult(
					meta.id,
					'NOT_FOUND',
					`MCP service "${serviceName}" not found in configuration.`,
					meta.risk,
				);
			}
			await reconnectMCPService(serviceName);
			return okResult(
				meta.id,
				{service: serviceName, reconnected: true},
				`Reconnected MCP service ${serviceName}`,
				meta.risk,
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'MCP reconnect failed';
			if (/not found/i.test(message)) {
				return failResult(meta.id, 'NOT_FOUND', message, meta.risk);
			}
			return failResult(meta.id, 'EXECUTION_FAILED', message, meta.risk);
		}
	}

	if (sub === 'enable' || sub === 'disable') {
		const wantEnabled = sub === 'enable';
		if (tokens.length === 0) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				`Usage: mcp ${sub} <service> [toolName]`,
				meta.risk,
			);
		}

		const serviceName = tokens[0]!;
		const toolName = tokens[1];

		try {
			const {
				toggleBuiltInService,
				isBuiltInServiceEnabled,
				getDisabledBuiltInServices,
			} = await import('../config/disabledBuiltInTools.js');
			const {getMCPConfig} = await import('../config/apiConfig.js');
			const mcpConfig = getMCPConfig();
			const knownBuiltIns = new Set([
				'filesystem',
				'terminal',
				'todo',
				'ace',
				'websearch',
				'snow-docs',
				'codebase',
				'askuser',
				'scheduler',
				'subagent',
				'team',
				...getDisabledBuiltInServices(),
			]);
			const isKnownBuiltIn = knownBuiltIns.has(serviceName);
			const isKnownExternal = Boolean(mcpConfig.mcpServers?.[serviceName]);
			if (!isKnownBuiltIn && !isKnownExternal) {
				return failResult(
					meta.id,
					'NOT_FOUND',
					`MCP service "${serviceName}" not found.`,
					meta.risk,
				);
			}

			if (toolName) {
				const {toggleMCPTool, isMCPToolEnabled} = await import(
					'../config/disabledMCPTools.js'
				);
				const previous = isMCPToolEnabled(serviceName, toolName);
				if (previous !== wantEnabled) {
					toggleMCPTool(serviceName, toolName, 'project');
				}
				const enabled = isMCPToolEnabled(serviceName, toolName);
				return okResult(
					meta.id,
					{
						kind: 'tool',
						service: serviceName,
						tool: toolName,
						enabled,
						previous,
					},
					`MCP tool ${serviceName}:${toolName} ${
						enabled ? 'enabled' : 'disabled'
					}`,
					meta.risk,
				);
			}

			if (isKnownBuiltIn) {
				const previous = isBuiltInServiceEnabled(serviceName);
				if (previous !== wantEnabled) {
					toggleBuiltInService(serviceName);
				}
				const enabled = isBuiltInServiceEnabled(serviceName);
				return okResult(
					meta.id,
					{
						kind: 'builtin-service',
						service: serviceName,
						enabled,
						previous,
					},
					`Built-in MCP service ${serviceName} ${
						enabled ? 'enabled' : 'disabled'
					}`,
					meta.risk,
				);
			}

			return failResult(
				meta.id,
				'INVALID_ARGS',
				`External MCP service "${serviceName}" requires a tool name. Usage: mcp ${sub} <service> <toolName>`,
				meta.risk,
			);
		} catch (error) {
			return failResult(
				meta.id,
				'EXECUTION_FAILED',
				error instanceof Error ? error.message : 'MCP enable/disable failed',
				meta.risk,
			);
		}
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown mcp subcommand "${sub}"`,
		meta.risk,
	);
}

export async function handleIde(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const {vscodeConnection} = await import('../ui/vscodeConnection.js');
	const sub =
		meta.command === 'connection-status'
			? 'status'
			: meta.subcommand ?? 'status';
	const tokens = parseTokens(args);

	if (sub === 'status' || sub === '') {
		const available = vscodeConnection.getAvailableIDEs();
		return okResult(
			meta.id,
			{
				connected: vscodeConnection.isConnected(),
				port: vscodeConnection.getPort(),
				available,
			},
			vscodeConnection.isConnected()
				? `IDE connected on port ${vscodeConnection.getPort()}`
				: 'IDE not connected',
			meta.risk,
		);
	}

	if (sub === 'connect') {
		try {
			const portToken = tokens[0];
			if (portToken && /^\d+$/.test(portToken)) {
				await vscodeConnection.connectToPort(Number(portToken));
			} else {
				await vscodeConnection.start();
			}
			return okResult(
				meta.id,
				{
					connected: vscodeConnection.isConnected(),
					port: vscodeConnection.getPort(),
				},
				`IDE connect ${
					vscodeConnection.isConnected() ? 'succeeded' : 'attempted'
				}`,
				meta.risk,
			);
		} catch (error) {
			return failResult(
				meta.id,
				'EXECUTION_FAILED',
				error instanceof Error ? error.message : 'IDE connect failed',
				meta.risk,
			);
		}
	}

	if (sub === 'disconnect') {
		vscodeConnection.setUserDisconnected(true);
		vscodeConnection.stop();
		return okResult(meta.id, {connected: false}, 'IDE disconnected', meta.risk);
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown ide subcommand "${sub}"`,
		meta.risk,
	);
}

export function handlePermissions(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'status';
	const cwd = process.cwd();

	if (sub === 'status' || sub === '') {
		const config = loadPermissionsConfig(cwd);
		return okResult(
			meta.id,
			{
				yolo: getYoloMode(),
				plan: getPlanMode(),
				toolSearch: getToolSearchEnabled(),
				alwaysApprovedTools: config.alwaysApprovedTools,
			},
			`YOLO=${getYoloMode() ? 'on' : 'off'}, Plan=${
				getPlanMode() ? 'on' : 'off'
			}, approved=${config.alwaysApprovedTools.length}`,
			meta.risk,
		);
	}

	if (sub === 'allow') {
		const toolName = (
			meta.subcommand === 'allow' ? tokens.join(' ') : tokens.slice(1).join(' ')
		).trim();
		if (!toolName) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: permissions allow <tool>',
				meta.risk,
			);
		}
		const before = loadPermissionsConfig(cwd).alwaysApprovedTools;
		addToolToPermissions(cwd, toolName);
		const after = loadPermissionsConfig(cwd).alwaysApprovedTools;
		return okResult(
			meta.id,
			{tool: toolName, alwaysApprovedTools: after, previous: before},
			`Always-approved tool: ${toolName}`,
			meta.risk,
		);
	}

	if (sub === 'revoke') {
		const toolName = (
			meta.subcommand === 'revoke'
				? tokens.join(' ')
				: tokens.slice(1).join(' ')
		).trim();
		if (!toolName) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: permissions revoke <tool>',
				meta.risk,
			);
		}
		const before = loadPermissionsConfig(cwd).alwaysApprovedTools;
		removeToolFromPermissions(cwd, toolName);
		const after = loadPermissionsConfig(cwd).alwaysApprovedTools;
		return okResult(
			meta.id,
			{tool: toolName, alwaysApprovedTools: after, previous: before},
			`Revoked always-approved tool: ${toolName}`,
			meta.risk,
		);
	}

	if (sub === 'clear') {
		const before = loadPermissionsConfig(cwd).alwaysApprovedTools;
		clearAllPermissions(cwd);
		return okResult(
			meta.id,
			{alwaysApprovedTools: [], previous: before, cleared: true},
			'Cleared all always-approved tools.',
			meta.risk,
		);
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown permissions subcommand "${sub}"`,
		meta.risk,
	);
}

export async function handleSession(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const {sessionManager} = await import('../session/sessionManager.js');
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'list';

	if (sub === 'list' || sub === '') {
		const sessions = await sessionManager.listSessions();
		return okResult(
			meta.id,
			{
				sessions,
				total: sessions.length,
				currentSessionId: sessionManager.getCurrentSession()?.id ?? null,
			},
			`Sessions: ${sessions.length}`,
			meta.risk,
		);
	}

	if (sub === 'current') {
		const session = sessionManager.getCurrentSession();
		if (!session) {
			return okResult(
				meta.id,
				{exists: false, session: null},
				'No active session.',
				meta.risk,
			);
		}
		return okResult(
			meta.id,
			{
				exists: true,
				session: {
					id: session.id,
					title: session.title,
					messageCount: session.messageCount ?? session.messages?.length ?? 0,
					updatedAt: session.updatedAt,
					hasGoal: session.hasGoal ?? false,
				},
			},
			`Current session ${session.id}`,
			meta.risk,
		);
	}

	if (sub === 'resume' || sub === 'load') {
		const sessionId = (
			meta.subcommand === sub ? tokens.join(' ') : tokens.slice(1).join(' ')
		).trim();
		if (!sessionId) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				`Usage: session ${sub} <sessionId>`,
				meta.risk,
			);
		}
		const session = await sessionManager.loadSession(sessionId);
		if (!session) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				`Session "${sessionId}" not found.`,
				meta.risk,
			);
		}
		// loadSession already setCurrentSession on success
		return okResult(
			meta.id,
			{
				sessionId: session.id,
				title: session.title,
				messageCount: session.messageCount ?? session.messages?.length ?? 0,
			},
			`Loaded session ${session.id}`,
			meta.risk,
		);
	}

	if (sub === 'branch') {
		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) {
			return failResult(
				meta.id,
				'SESSION_REQUIRED',
				'No active session to branch.',
				meta.risk,
			);
		}

		const branchName =
			(meta.subcommand === 'branch'
				? tokens.join(' ')
				: tokens.slice(1).join(' ')
			).trim() || undefined;

		try {
			await sessionManager.saveSession(currentSession);
			const forkedSession = await sessionManager.createNewSession(false, true);
			forkedSession.messages = currentSession.messages.map(msg => ({...msg}));
			forkedSession.messageCount = currentSession.messageCount;
			forkedSession.title = branchName
				? `${currentSession.title} [${branchName}]`
				: currentSession.title;
			forkedSession.summary = currentSession.summary;
			forkedSession.branchedFrom = currentSession.id;
			forkedSession.branchName = branchName;
			forkedSession.updatedAt = Date.now();
			await sessionManager.saveSession(forkedSession);

			try {
				const {getTodoService} = await import('./mcpToolsManager.js');
				await getTodoService().copyTodoList(
					currentSession.id,
					forkedSession.id,
				);
			} catch {
				// non-fatal
			}

			sessionManager.setCurrentSession(forkedSession);
			return okResult(
				meta.id,
				{
					sourceSessionId: currentSession.id,
					sessionId: forkedSession.id,
					branchName: branchName ?? null,
					title: forkedSession.title,
				},
				`Branched session ${forkedSession.id} from ${currentSession.id}`,
				meta.risk,
			);
		} catch (error) {
			return failResult(
				meta.id,
				'EXECUTION_FAILED',
				error instanceof Error ? error.message : 'Session branch failed',
				meta.risk,
			);
		}
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown session subcommand "${sub}"`,
		meta.risk,
	);
}

export async function handleGoal(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const {goalManager} = await import('../task/goalManager.js');
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'status';

	if (sub === 'status' || sub === '') {
		const goal = await goalManager.loadCurrentGoal();
		if (!goal) {
			return okResult(
				meta.id,
				{exists: false, goal: null},
				'No active goal.',
				meta.risk,
			);
		}
		return okResult(
			meta.id,
			{exists: true, goal: goalPublic(goal)},
			`Goal ${goal.id}: ${goal.status}`,
			meta.risk,
		);
	}

	if (sub === 'create') {
		const objective = (
			meta.subcommand === 'create'
				? tokens.join(' ')
				: tokens.slice(1).join(' ')
		).trim();
		if (!objective) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: goal create <objective>',
				meta.risk,
			);
		}
		try {
			const goal = await goalManager.createGoal(objective);
			return okResult(
				meta.id,
				{
					goal: goalPublic(goal),
					note: 'Goal created with pendingContinuation. Full Ralph loop is not auto-started from headless plane.',
				},
				`Goal ${goal.id} created.`,
				meta.risk,
			);
		} catch (error) {
			return failResult(
				meta.id,
				'EXECUTION_FAILED',
				error instanceof Error ? error.message : 'Goal create failed',
				meta.risk,
			);
		}
	}

	if (sub === 'pause') {
		const goal = await goalManager.pauseGoal();
		if (!goal) {
			return failResult(meta.id, 'NOT_FOUND', 'No goal to pause.', meta.risk);
		}
		return okResult(
			meta.id,
			{goal: goalPublic(goal)},
			`Goal ${goal.id} paused.`,
			meta.risk,
		);
	}

	if (sub === 'resume') {
		const goal = await goalManager.resumeGoal();
		if (!goal) {
			return failResult(meta.id, 'NOT_FOUND', 'No goal to resume.', meta.risk);
		}
		return okResult(
			meta.id,
			{goal: goalPublic(goal)},
			`Goal ${goal.id} resumed.`,
			meta.risk,
		);
	}

	if (sub === 'clear') {
		const goal = await goalManager.clearGoal();
		if (!goal) {
			return failResult(meta.id, 'NOT_FOUND', 'No goal to clear.', meta.risk);
		}
		return okResult(
			meta.id,
			{cleared: true, goal: goalPublic(goal)},
			`Goal ${goal.id} cleared.`,
			meta.risk,
		);
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown goal subcommand "${sub}"`,
		meta.risk,
	);
}

export async function handleLoop(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const {loopManager, parseLoopSchedule} = await import(
		'../task/loopManager.js'
	);
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'list';

	if (sub === 'list' || sub === '') {
		const loops = await loopManager.listLoops();
		return okResult(
			meta.id,
			{loops, total: loops.length},
			`Loops: ${loops.length}`,
			meta.risk,
		);
	}

	if (sub === 'tasks') {
		const tasks = await loopManager.listTaskSummaries();
		return okResult(
			meta.id,
			{tasks, total: tasks.length},
			`Loop tasks: ${tasks.length}`,
			meta.risk,
		);
	}

	if (sub === 'create') {
		const raw =
			meta.subcommand === 'create'
				? (args ?? '').trim()
				: tokens[0] === 'create'
				? tokens.slice(1).join(' ')
				: (args ?? '').trim();
		if (!raw) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: loop create <interval> <prompt> | loop create daily HH:mm <prompt>',
				meta.risk,
			);
		}
		try {
			const schedule = parseLoopSchedule(raw);
			const loop = loopManager.createLoop(schedule);
			return okResult(meta.id, {loop}, `Loop ${loop.id} created.`, meta.risk);
		} catch (error) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				error instanceof Error ? error.message : 'Loop create failed',
				meta.risk,
			);
		}
	}

	if (sub === 'cancel') {
		const loopId = (
			meta.subcommand === 'cancel'
				? tokens.join(' ')
				: tokens.slice(1).join(' ')
		).trim();
		if (!loopId) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: loop cancel <id>',
				meta.risk,
			);
		}
		const loop = await loopManager.cancelLoop(loopId);
		if (!loop) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				`Loop "${loopId}" not found.`,
				meta.risk,
			);
		}
		return okResult(
			meta.id,
			{loop, cancelled: true},
			`Loop ${loop.id} cancelled.`,
			meta.risk,
		);
	}

	// Allow bare loop create-style args when meta is loop.create only.
	if (meta.id === 'loop.create') {
		try {
			const schedule = parseLoopSchedule((args ?? '').trim());
			const loop = loopManager.createLoop(schedule);
			return okResult(meta.id, {loop}, `Loop ${loop.id} created.`, meta.risk);
		} catch (error) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				error instanceof Error ? error.message : 'Loop create failed',
				meta.risk,
			);
		}
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown loop subcommand "${sub}"`,
		meta.risk,
	);
}

export async function handleSkills(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'list';
	const {listAvailableSkills} = await import('../../mcp/skills.js');
	const {getDisabledSkills, isSkillEnabled, toggleSkill} = await import(
		'../config/disabledSkills.js'
	);

	if (sub === 'list' || sub === '') {
		const skills = await listAvailableSkills(process.cwd());
		const disabled = new Set(getDisabledSkills());
		const items = skills.map(skill => ({
			id: skill.id,
			name: skill.name,
			description: skill.description,
			location: skill.location,
			source: skill.source,
			enabled: !disabled.has(skill.id),
		}));
		return okResult(
			meta.id,
			{
				skills: items,
				total: items.length,
				disabled: [...disabled],
			},
			`Skills: ${items.length}`,
			meta.risk,
		);
	}

	if (sub === 'status') {
		const skillId = (
			meta.subcommand === 'status'
				? tokens.join(' ')
				: tokens.slice(1).join(' ')
		).trim();
		if (!skillId) {
			const disabled = getDisabledSkills();
			return okResult(
				meta.id,
				{disabled, disabledCount: disabled.length},
				`Disabled skills: ${disabled.length}`,
				meta.risk,
			);
		}
		const skills = await listAvailableSkills(process.cwd());
		const skill = skills.find(s => s.id === skillId || s.name === skillId);
		if (!skill) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				`Skill "${skillId}" not found.`,
				meta.risk,
			);
		}
		return okResult(
			meta.id,
			{
				id: skill.id,
				name: skill.name,
				enabled: isSkillEnabled(skill.id),
				location: skill.location,
				source: skill.source,
			},
			`Skill ${skill.id}: ${isSkillEnabled(skill.id) ? 'enabled' : 'disabled'}`,
			meta.risk,
		);
	}

	if (sub === 'enable' || sub === 'disable') {
		const wantEnabled = sub === 'enable';
		const skillId = (
			meta.subcommand === sub ? tokens.join(' ') : tokens.slice(1).join(' ')
		).trim();
		if (!skillId) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				`Usage: skills ${sub} <skillId>`,
				meta.risk,
			);
		}

		const skills = await listAvailableSkills(process.cwd());
		const skill = skills.find(s => s.id === skillId || s.name === skillId);
		const id = skill?.id ?? skillId;
		const previous = isSkillEnabled(id);
		if (previous !== wantEnabled) {
			toggleSkill(id);
		}
		const enabled = isSkillEnabled(id);
		return okResult(
			meta.id,
			{id, enabled, previous, found: Boolean(skill)},
			`Skill ${id} ${enabled ? 'enabled' : 'disabled'}`,
			meta.risk,
		);
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown skills subcommand "${sub}"`,
		meta.risk,
	);
}

export async function handleHelp(
	meta: SessionCommandMeta,
): Promise<SessionCommandResult> {
	const {listSessionCommands} = await import('./sessionCommandRegistry.js');
	const commands = listSessionCommands();
	const top = commands.slice(0, 40).map(c => ({
		id: c.id,
		risk: c.risk,
		description: c.description,
		requiresConfirm: c.requiresConfirm,
	}));
	return okResult(
		meta.id,
		{
			commands: top,
			total: commands.length,
			examples: [
				'snow cmd buddy status --json',
				'snow cmd theme status --json',
				'snow cmd session list --json',
				'snow cmd goal status --json',
				'snow cmd skills list --json',
				'snow cmd permissions status --json',
				'snow cmd yolo on --yes --json',
			],
		},
		`Control-plane commands: ${commands.length}`,
		meta.risk,
	);
}

export function handleConfigSnapshot(
	meta: SessionCommandMeta,
): SessionCommandResult {
	// Safe non-secret snapshot only — never dump API keys.
	const snow = getSnowConfig();
	return okResult(
		meta.id,
		{
			profile: getActiveProfileName(),
			theme: getCurrentTheme(),
			simpleMode: getSimpleMode(),
			toolDisplay: getToolDisplayMode(),
			thinkDisplay: getThinkDisplayMode(),
			diffOpacity: getDiffOpacity(),
			api: {
				advancedModel: snow.advancedModel ?? null,
				basicModel: snow.basicModel ?? null,
				requestMethod: snow.requestMethod ?? null,
				maxContextTokens: snow.maxContextTokens ?? null,
				maxTokens: snow.maxTokens ?? null,
			},
			modes: {
				yolo: getYoloMode(),
				plan: getPlanMode(),
				toolSearch: getToolSearchEnabled(),
				team: getTeamMode(),
				ultraTodo: getUltraTodoEnabled(),
				vulnerabilityHunting: getVulnerabilityHuntingMode(),
			},
			codebaseEnabled: isCodebaseEnabled(),
			telemetryEnabled: getTelemetryEnabled(),
			autoFormatEnabled: getAutoFormatEnabled(),
			imageCompressEnabled: getImageCompressEnabled(),
			hybridCompressEnabled: getHybridCompressEnabled(),
			speedometerEnabled: getSpeedometerEnabled(),
			subAgentMaxSpawnDepth: getSubAgentMaxSpawnDepth(),
			fileListDisplayMode: getFileListDisplayMode(),
			language: getCurrentLanguage(),
			showThinking: snow.showThinking !== false,
			privacy: (() => {
				const settings = readSettings('project');
				return {
					enabled: settings.privacy?.enabled === true,
					mode: settings.privacy?.mode === 'local' ? 'local' : 'api',
				};
			})(),
			codebaseFlags: (() => {
				const config = loadCodebaseConfig();
				return {
					enableAgentReview: config.enableAgentReview,
					enableReranking: config.enableReranking,
				};
			})(),
			cwd: process.cwd(),
		},
		'Safe config snapshot',
		meta.risk,
	);
}

/**
 * Read active API limits (maxContextTokens / maxTokens / models).
 * Prefer this over force-writing ~/.snow/config.json.
 */
export function handleConfigStatus(
	meta: SessionCommandMeta,
): SessionCommandResult {
	const snow = getSnowConfig();
	const data = {
		profile: getActiveProfileName(),
		advancedModel: snow.advancedModel ?? null,
		basicModel: snow.basicModel ?? null,
		requestMethod: snow.requestMethod ?? null,
		maxContextTokens: snow.maxContextTokens ?? null,
		maxTokens: snow.maxTokens ?? null,
	};
	return okResult(
		meta.id,
		data,
		`Context=${data.maxContextTokens ?? '?'} maxTokens=${
			data.maxTokens ?? '?'
		} model=${data.advancedModel ?? '?'}`,
		meta.risk,
	);
}

function parsePositiveInt(raw: string): number | null {
	const n = Number(raw.trim().replace(/[,_]/g, ''));
	if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
	return n;
}

const CONFIG_SET_KEYS =
	'maxContextTokens, maxTokens, advancedModel, basicModel, requestMethod';

/**
 * Hot-set active snowcfg via updateSnowConfig (writes config.json +
 * active profile, emits apiConfig, no process restart).
 *
 * Usage:
 *   config set maxContextTokens=450000 maxTokens=128000
 *   config set advancedModel=grok-4.5 basicModel=grok-4.5
 *   config set requestMethod=chat
 *
 * Does NOT set apiKey (by design — no silent key mutation on the plane).
 */
export async function handleConfigSet(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const tokens = parseTokens(args);
	// Drop leading "set" if present (when resolved as bare config set ...)
	const body = tokens[0]?.toLowerCase() === 'set' ? tokens.slice(1) : tokens;

	if (body.length === 0) {
		return failResult(
			meta.id,
			'INVALID_ARGS',
			`Usage: config set key=value [...]. Supported: ${CONFIG_SET_KEYS}`,
			meta.risk,
		);
	}

	const patch: {
		maxContextTokens?: number;
		maxTokens?: number;
		advancedModel?: string;
		basicModel?: string;
		requestMethod?: 'chat' | 'responses' | 'gemini' | 'anthropic';
	} = {};
	for (const token of body) {
		const eq = token.indexOf('=');
		if (eq <= 0) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				`Expected key=value, got "${token}". Supported: ${CONFIG_SET_KEYS}`,
				meta.risk,
			);
		}
		const key = token.slice(0, eq).toLowerCase();
		const value = token.slice(eq + 1);
		if (key === 'maxcontexttokens' || key === 'context' || key === 'ctx') {
			const n = parsePositiveInt(value);
			if (n === null) {
				return failResult(
					meta.id,
					'INVALID_ARGS',
					`maxContextTokens must be a positive integer, got "${value}"`,
					meta.risk,
				);
			}
			patch.maxContextTokens = n;
			continue;
		}
		if (
			key === 'maxtokens' ||
			key === 'max_tokens' ||
			key === 'output' ||
			key === 'maxoutput'
		) {
			const n = parsePositiveInt(value);
			if (n === null) {
				return failResult(
					meta.id,
					'INVALID_ARGS',
					`maxTokens must be a positive integer, got "${value}"`,
					meta.risk,
				);
			}
			patch.maxTokens = n;
			continue;
		}
		if (
			key === 'advancedmodel' ||
			key === 'advanced' ||
			key === 'model' ||
			key === 'mainmodel'
		) {
			if (!value.trim()) {
				return failResult(
					meta.id,
					'INVALID_ARGS',
					'advancedModel must be a non-empty string',
					meta.risk,
				);
			}
			patch.advancedModel = value.trim();
			continue;
		}
		if (key === 'basicmodel' || key === 'basic' || key === 'fastmodel') {
			if (!value.trim()) {
				return failResult(
					meta.id,
					'INVALID_ARGS',
					'basicModel must be a non-empty string',
					meta.risk,
				);
			}
			patch.basicModel = value.trim();
			continue;
		}
		if (
			key === 'requestmethod' ||
			key === 'method' ||
			key === 'apimethod' ||
			key === 'protocol'
		) {
			const method = value.trim().toLowerCase();
			if (
				method !== 'chat' &&
				method !== 'responses' &&
				method !== 'gemini' &&
				method !== 'anthropic'
			) {
				return failResult(
					meta.id,
					'INVALID_ARGS',
					`requestMethod must be chat|responses|gemini|anthropic, got "${value}"`,
					meta.risk,
				);
			}
			patch.requestMethod = method;
			continue;
		}
		if (key === 'apikey' || key === 'api_key' || key === 'key') {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'apiKey cannot be set via session-command (no silent key mutation). Use the Config UI.',
				meta.risk,
			);
		}
		return failResult(
			meta.id,
			'INVALID_ARGS',
			`Unknown config key "${key}". Supported: ${CONFIG_SET_KEYS}`,
			meta.risk,
		);
	}

	if (Object.keys(patch).length === 0) {
		return failResult(
			meta.id,
			'INVALID_ARGS',
			`Nothing to set. Supported: ${CONFIG_SET_KEYS}`,
			meta.risk,
		);
	}

	const previous = getSnowConfig();
	await updateSnowConfig(patch);
	// updateSnowConfig -> saveConfig already emits apiConfig for hot UI refresh.
	const next = getSnowConfig();

	return okResult(
		meta.id,
		{
			changed: patch,
			previous: {
				maxContextTokens: previous.maxContextTokens ?? null,
				maxTokens: previous.maxTokens ?? null,
				advancedModel: previous.advancedModel ?? null,
				basicModel: previous.basicModel ?? null,
				requestMethod: previous.requestMethod ?? null,
			},
			current: {
				maxContextTokens: next.maxContextTokens ?? null,
				maxTokens: next.maxTokens ?? null,
				advancedModel: next.advancedModel ?? null,
				basicModel: next.basicModel ?? null,
				requestMethod: next.requestMethod ?? null,
			},
			profile: getActiveProfileName(),
		},
		`Config updated (hot-refresh): context=${
			next.maxContextTokens ?? '?'
		} maxTokens=${next.maxTokens ?? '?'} model=${next.advancedModel ?? '?'}`,
		meta.risk,
	);
}

export function handleHome(meta: SessionCommandMeta): SessionCommandResult {
	return failResult(
		meta.id,
		'HEADLESS_UNSUPPORTED',
		'home is a TUI navigation command and is not supported headless.',
		meta.risk,
	);
}
