import {homedir} from 'os';
import {join} from 'path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import type {ThemeType, ThemeColors} from '../../ui/themes/index.js';
import {configEvents} from './configEvents.js';

const CONFIG_DIR = join(homedir(), '.snow');
const THEME_CONFIG_FILE = join(CONFIG_DIR, 'theme.json');

/** Status keys for tool-call title prefixes. */
export type ToolStatusIconKey =
	| 'pending'
	| 'success'
	| 'error'
	| 'warning'
	| 'running';

/**
 * Compact default status symbols from ZGQ-inc/special-ascii.
 * Keep every symbol single-column and free of Unicode Emoji properties.
 */
export const DEFAULT_TOOL_STATUS_ICONS: Record<ToolStatusIconKey, string> = {
	pending: '◇',
	success: '✓',
	error: '✗',
	warning: '∆',
	running: '⋯',
};

/**
 * Tool type-symbol preferences (text category symbol next to tool name).
 * - boolean: enable/disable category symbols only (status still uses defaults)
 * - object:
 *   - enabled: category symbols on/off
 *   - status: boolean | { enabled?, icons? } for configurable status prefixes
 *   - tools: per-tool category symbol overrides
 */
export type ToolIconsConfig =
	| boolean
	| {
			enabled?: boolean;
			/**
			 * Status prefix before the tool title.
			 * true/omit = on (compact defaults); false = hide;
			 * object = enable + optional marker overrides.
			 */
			status?:
				| boolean
				| {
						enabled?: boolean;
						icons?: Partial<Record<ToolStatusIconKey, string>>;
				  };
			/** Per-tool category symbol overrides; keys are exact tool names. */
			tools?: Record<string, string>;
	  };

interface ThemeConfig {
	theme: ThemeType;
	customColors?: ThemeColors;
	simpleMode?: boolean;
	diffOpacity?: number;
	toolDisplayMode?: ToolDisplayMode;
	thinkDisplayMode?: ThinkDisplayMode;
	/** Sub-agent live panel density. Default slots (single focus overwrite). */
	subAgentDisplayMode?: SubAgentDisplayMode;
	/** Tool category symbols + optional status prefixes; default true. */
	toolIcons?: ToolIconsConfig;
	/**
	 * Pure user overrides for chat tool titles (no built-in i18n defaults).
	 * Unset tools keep their technical id (e.g. websearch-search).
	 */
	toolDisplayNames?: Record<string, string>;
}

export type ToolDisplayMode = 'full' | 'compact' | 'hidden';
export type ThinkDisplayMode = 'full' | 'compact';
/**
 * Sub-agent live panel modes:
 * - slots: agent container + single focus line overwrite (default)
 * - multi: agent container + recent focus history lines
 * - compact: agent header only
 * - hidden: disable live slots (legacy tool cards path)
 */
export type SubAgentDisplayMode = 'slots' | 'multi' | 'compact' | 'hidden';

const DEFAULT_CONFIG: ThemeConfig = {
	theme: 'tiffany',
	simpleMode: true,
	diffOpacity: 1,
	toolDisplayMode: 'full',
	thinkDisplayMode: 'compact',
	subAgentDisplayMode: 'slots',
	toolIcons: true,
};

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

/**
 * Load theme configuration from file system
 */
export function loadThemeConfig(): ThemeConfig {
	ensureConfigDirectory();

	if (!existsSync(THEME_CONFIG_FILE)) {
		saveThemeConfig(DEFAULT_CONFIG);
		return DEFAULT_CONFIG;
	}

	try {
		const configData = readFileSync(THEME_CONFIG_FILE, 'utf-8');
		const config = JSON.parse(configData);
		return {
			...DEFAULT_CONFIG,
			...config,
		};
	} catch (error) {
		// If config file is corrupted, return default config
		return DEFAULT_CONFIG;
	}
}

/**
 * Save theme configuration to file system
 */
export function saveThemeConfig(config: ThemeConfig): void {
	ensureConfigDirectory();

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(THEME_CONFIG_FILE, configData, 'utf-8');
	} catch (error) {
		console.error('Failed to save theme config:', error);
	}
}

/**
 * Get current theme setting
 */
export function getCurrentTheme(): ThemeType {
	const config = loadThemeConfig();
	return config.theme;
}

/**
 * Set theme and persist to file system
 */
export function setCurrentTheme(theme: ThemeType): void {
	const config = loadThemeConfig();
	saveThemeConfig({...config, theme});
}

/**
 * Get custom theme colors
 */
export function getCustomColors(): ThemeColors | undefined {
	const config = loadThemeConfig();
	return config.customColors;
}

/**
 * Save custom theme colors
 */
export function saveCustomColors(colors: ThemeColors): void {
	const config = loadThemeConfig();
	saveThemeConfig({...config, customColors: colors});
	// Hot-refresh TUI without requiring process restart.
	configEvents.emitConfigChange({type: 'customColors', value: colors});
}

/**
 * Get simple mode setting
 */
export function getSimpleMode(): boolean {
	const config = loadThemeConfig();
	return config.simpleMode ?? true;
}

/**
 * Set simple mode and persist to file system
 */
export function setSimpleMode(simpleMode: boolean): void {
	const config = loadThemeConfig();
	saveThemeConfig({...config, simpleMode});
}

/**
 * Get diff opacity setting
 */
export function getDiffOpacity(): number {
	const config = loadThemeConfig();
	return config.diffOpacity ?? 1;
}

/**
 * Set diff opacity and persist to file system
 */
export function setDiffOpacity(diffOpacity: number): void {
	const config = loadThemeConfig();
	saveThemeConfig({...config, diffOpacity});
}

/**
 * Get tool display mode setting
 */
export function getToolDisplayMode(): ToolDisplayMode {
	const config = loadThemeConfig();
	return config.toolDisplayMode ?? 'full';
}

/**
 * Set tool display mode and persist to file system
 */
export function setToolDisplayMode(mode: ToolDisplayMode): void {
	const config = loadThemeConfig();
	saveThemeConfig({...config, toolDisplayMode: mode});
}

/**
 * Get think display mode setting
 */
export function getThinkDisplayMode(): ThinkDisplayMode {
	const config = loadThemeConfig();
	return config.thinkDisplayMode ?? 'compact';
}

/**
 * Set think display mode and persist to file system
 */
export function setThinkDisplayMode(mode: ThinkDisplayMode): void {
	const config = loadThemeConfig();
	saveThemeConfig({...config, thinkDisplayMode: mode});
}

/**
 * Get sub-agent live display mode setting
 */
export function getSubAgentDisplayMode(): SubAgentDisplayMode {
	const config = loadThemeConfig();
	return config.subAgentDisplayMode ?? 'slots';
}

/**
 * Set sub-agent live display mode and persist to file system
 */
export function setSubAgentDisplayMode(mode: SubAgentDisplayMode): void {
	const config = loadThemeConfig();
	saveThemeConfig({...config, subAgentDisplayMode: mode});
}

export type NormalizedToolStatusConfig = {
	enabled: boolean;
	icons: Record<ToolStatusIconKey, string>;
};

export type NormalizedToolIconsConfig = {
	enabled: boolean;
	tools: Record<string, string>;
	status: NormalizedToolStatusConfig;
};

const STATUS_KEYS: ToolStatusIconKey[] = [
	'pending',
	'success',
	'error',
	'warning',
	'running',
];

function normalizeStatusIcons(
	raw:
		| boolean
		| {enabled?: boolean; icons?: Partial<Record<ToolStatusIconKey, string>>}
		| undefined
		| null,
): NormalizedToolStatusConfig {
	// Default: status prefixes are on and use compact terminal markers.
	if (raw === undefined || raw === null || raw === true) {
		return {enabled: true, icons: {...DEFAULT_TOOL_STATUS_ICONS}};
	}
	if (raw === false) {
		return {enabled: false, icons: {...DEFAULT_TOOL_STATUS_ICONS}};
	}
	const icons = {...DEFAULT_TOOL_STATUS_ICONS};
	if (raw.icons && typeof raw.icons === 'object') {
		for (const key of STATUS_KEYS) {
			const v = raw.icons[key];
			if (typeof v === 'string' && v.trim()) {
				icons[key] = v.trim();
			}
		}
	}
	return {
		enabled: raw.enabled !== false,
		icons,
	};
}

function normalizeToolIconsConfig(
	raw: ToolIconsConfig | undefined | null,
): NormalizedToolIconsConfig {
	if (raw === undefined || raw === null) {
		return {
			enabled: true,
			tools: {},
			status: normalizeStatusIcons(undefined),
		};
	}
	if (typeof raw === 'boolean') {
		// Boolean only toggles *category* icons; status stays default-on.
		return {
			enabled: raw,
			tools: {},
			status: normalizeStatusIcons(undefined),
		};
	}
	const tools: Record<string, string> = {};
	if (raw.tools && typeof raw.tools === 'object') {
		for (const [k, v] of Object.entries(raw.tools)) {
			if (typeof v === 'string' && v.trim()) {
				tools[k] = v.trim();
			}
		}
	}
	return {
		enabled: raw.enabled !== false,
		tools,
		status: normalizeStatusIcons(raw.status),
	};
}

/** Persist a normalized shape back to theme.json-friendly ToolIconsConfig. */
function toPersistedToolIconsConfig(
	normalized: NormalizedToolIconsConfig,
): ToolIconsConfig {
	const hasTools = Object.keys(normalized.tools).length > 0;
	const statusDefault =
		normalized.status.enabled &&
		STATUS_KEYS.every(
			k => normalized.status.icons[k] === DEFAULT_TOOL_STATUS_ICONS[k],
		);
	const statusOff = !normalized.status.enabled;
	const statusCustom =
		normalized.status.enabled &&
		STATUS_KEYS.some(
			k => normalized.status.icons[k] !== DEFAULT_TOOL_STATUS_ICONS[k],
		);

	if (!hasTools && statusDefault && normalized.enabled) {
		return true;
	}
	if (!hasTools && statusDefault && !normalized.enabled) {
		return false;
	}

	const out: Exclude<ToolIconsConfig, boolean> = {
		enabled: normalized.enabled,
	};
	if (hasTools) {
		out.tools = normalized.tools;
	}
	if (statusOff) {
		out.status = false;
	} else if (statusCustom) {
		const icons: Partial<Record<ToolStatusIconKey, string>> = {};
		for (const k of STATUS_KEYS) {
			if (normalized.status.icons[k] !== DEFAULT_TOOL_STATUS_ICONS[k]) {
				icons[k] = normalized.status.icons[k];
			}
		}
		out.status = {enabled: true, icons};
	}
	return out;
}

/**
 * Whether tool category markers are shown next to tool names.
 * Independent of toolDisplayMode full|compact|hidden.
 */
export function getToolIconsEnabled(): boolean {
	const config = loadThemeConfig();
	return normalizeToolIconsConfig(config.toolIcons).enabled;
}

/**
 * Per-tool marker overrides from theme.json.
 */
export function getToolIconOverrides(): Record<string, string> {
	const config = loadThemeConfig();
	return normalizeToolIconsConfig(config.toolIcons).tools;
}

/** Whether configured status prefixes are shown on tool titles. */
export function getToolStatusIconsEnabled(): boolean {
	const config = loadThemeConfig();
	return normalizeToolIconsConfig(config.toolIcons).status.enabled;
}

/** Resolved status markers (defaults + user overrides). */
export function getToolStatusIconMap(): Record<ToolStatusIconKey, string> {
	const config = loadThemeConfig();
	return normalizeToolIconsConfig(config.toolIcons).status.icons;
}

function persistToolIcons(
	normalized: NormalizedToolIconsConfig,
	emitType: 'toolIcons' | 'toolStatusIcons' = 'toolIcons',
): ToolIconsConfig {
	const next = toPersistedToolIconsConfig(normalized);
	const config = loadThemeConfig();
	saveThemeConfig({...config, toolIcons: next});
	configEvents.emitConfigChange({type: emitType, value: next});
	if (emitType === 'toolStatusIcons') {
		// Keep category subscribers in sync when only status changed.
		configEvents.emitConfigChange({type: 'toolIcons', value: next});
	}
	return next;
}

/**
 * Enable/disable tool category markers (preserves overrides + status).
 */
export function setToolIconsEnabled(enabled: boolean): void {
	const config = loadThemeConfig();
	const current = normalizeToolIconsConfig(config.toolIcons);
	persistToolIcons({...current, enabled});
}

/**
 * Replace the tool marker config wholesale (boolean or full object).
 */
export function setToolIconsConfig(value: ToolIconsConfig): void {
	persistToolIcons(normalizeToolIconsConfig(value));
}

/**
 * Set/override a single tool category marker. Pass empty string to clear.
 */
export function setToolIconOverride(
	toolName: string,
	icon: string | null | undefined,
): void {
	const config = loadThemeConfig();
	const current = normalizeToolIconsConfig(config.toolIcons);
	const tools = {...current.tools};
	const name = toolName.trim();
	if (!name) {
		return;
	}
	if (!icon || !String(icon).trim()) {
		delete tools[name];
	} else {
		tools[name] = String(icon).trim();
	}
	persistToolIcons({...current, tools});
}

/** Enable or disable configured status prefixes. */
export function setToolStatusIconsEnabled(enabled: boolean): void {
	const config = loadThemeConfig();
	const current = normalizeToolIconsConfig(config.toolIcons);
	persistToolIcons(
		{
			...current,
			status: {...current.status, enabled},
		},
		'toolStatusIcons',
	);
}

/**
 * Override one status marker. Empty clears to the default marker.
 * Keys: pending | success | error | warning | running
 */
export function setToolStatusIconOverride(
	statusKey: ToolStatusIconKey,
	icon: string | null | undefined,
): void {
	if (!STATUS_KEYS.includes(statusKey)) {
		return;
	}
	const config = loadThemeConfig();
	const current = normalizeToolIconsConfig(config.toolIcons);
	const icons = {...current.status.icons};
	if (!icon || !String(icon).trim()) {
		icons[statusKey] = DEFAULT_TOOL_STATUS_ICONS[statusKey];
	} else {
		icons[statusKey] = String(icon).trim();
	}
	persistToolIcons(
		{
			...current,
			status: {enabled: current.status.enabled, icons},
		},
		'toolStatusIcons',
	);
}

function normalizeToolDisplayNames(
	raw: Record<string, string> | undefined | null,
): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw || typeof raw !== 'object') {
		return out;
	}
	for (const [k, v] of Object.entries(raw)) {
		if (
			typeof k === 'string' &&
			k.trim() &&
			typeof v === 'string' &&
			v.trim()
		) {
			out[k.trim()] = v.trim();
		}
	}
	return out;
}

/**
 * All user-defined tool display-name overrides (no built-in defaults).
 */
export function getToolDisplayNames(): Record<string, string> {
	const config = loadThemeConfig();
	return normalizeToolDisplayNames(config.toolDisplayNames);
}

/**
 * Resolve display label for a tool title.
 * Returns the user override when set; otherwise the technical tool id.
 */
export function getToolDisplayName(
	toolName: string | undefined | null,
): string {
	if (!toolName) {
		return '';
	}
	const overrides = getToolDisplayNames();
	const override = overrides[toolName];
	return override && override.trim() ? override.trim() : toolName;
}

/**
 * Set or clear one tool display-name override.
 * Pass empty / null / undefined to clear (show technical id again).
 */
export function setToolDisplayName(
	toolName: string,
	displayName: string | null | undefined,
): void {
	const config = loadThemeConfig();
	const names = {...normalizeToolDisplayNames(config.toolDisplayNames)};
	const key = toolName.trim();
	if (!key) {
		return;
	}
	if (!displayName || !String(displayName).trim()) {
		delete names[key];
	} else {
		names[key] = String(displayName).trim();
	}
	const next = Object.keys(names).length > 0 ? names : undefined;
	const nextConfig = {...config};
	if (next) {
		nextConfig.toolDisplayNames = next;
	} else {
		delete nextConfig.toolDisplayNames;
	}
	saveThemeConfig(nextConfig);
	configEvents.emitConfigChange({
		type: 'toolDisplayNames',
		value: next ?? {},
	});
}

/**
 * Replace the entire display-name map.
 */
export function setToolDisplayNames(
	names: Record<string, string> | undefined,
): void {
	const config = loadThemeConfig();
	const normalized = normalizeToolDisplayNames(names);
	const nextConfig = {...config};
	if (Object.keys(normalized).length > 0) {
		nextConfig.toolDisplayNames = normalized;
	} else {
		delete nextConfig.toolDisplayNames;
	}
	saveThemeConfig(nextConfig);
	configEvents.emitConfigChange({
		type: 'toolDisplayNames',
		value: normalized,
	});
}
