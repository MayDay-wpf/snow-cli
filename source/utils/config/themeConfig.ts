import {homedir} from 'os';
import {join} from 'path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import type {ThemeType, ThemeColors} from '../../ui/themes/index.js';
import {configEvents} from './configEvents.js';

const CONFIG_DIR = join(homedir(), '.snow');
const THEME_CONFIG_FILE = join(CONFIG_DIR, 'theme.json');

/**
 * Tool type-icon preferences (category emoji next to tool name).
 * - boolean: enable/disable only
 * - object: enable + optional per-tool overrides (e.g. "websearch-search": "🔎")
 */
export type ToolIconsConfig =
	| boolean
	| {
			enabled?: boolean;
			/** Per-tool icon overrides; keys are exact tool names. */
			tools?: Record<string, string>;
	  };

interface ThemeConfig {
	theme: ThemeType;
	customColors?: ThemeColors;
	simpleMode?: boolean;
	diffOpacity?: number;
	toolDisplayMode?: ToolDisplayMode;
	thinkDisplayMode?: ThinkDisplayMode;
	/** Tool category icons (🔍/💻/…); default true. */
	toolIcons?: ToolIconsConfig;
}

export type ToolDisplayMode = 'full' | 'compact' | 'hidden';
export type ThinkDisplayMode = 'full' | 'compact';

const DEFAULT_CONFIG: ThemeConfig = {
	theme: 'tiffany',
	simpleMode: true,
	diffOpacity: 1,
	toolDisplayMode: 'full',
	thinkDisplayMode: 'compact',
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

function normalizeToolIconsConfig(raw: ToolIconsConfig | undefined): {
	enabled: boolean;
	tools: Record<string, string>;
} {
	if (raw === undefined || raw === null) {
		return {enabled: true, tools: {}};
	}
	if (typeof raw === 'boolean') {
		return {enabled: raw, tools: {}};
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
	};
}

/**
 * Whether tool category icons (🔍/💻/…) are shown next to tool names.
 * Independent of toolDisplayMode full|compact|hidden.
 */
export function getToolIconsEnabled(): boolean {
	const config = loadThemeConfig();
	return normalizeToolIconsConfig(config.toolIcons).enabled;
}

/**
 * Per-tool icon overrides from theme.json.
 */
export function getToolIconOverrides(): Record<string, string> {
	const config = loadThemeConfig();
	return normalizeToolIconsConfig(config.toolIcons).tools;
}

/**
 * Enable/disable tool category icons (preserves existing overrides).
 */
export function setToolIconsEnabled(enabled: boolean): void {
	const config = loadThemeConfig();
	const current = normalizeToolIconsConfig(config.toolIcons);
	const next: ToolIconsConfig =
		Object.keys(current.tools).length > 0
			? {enabled, tools: current.tools}
			: enabled;
	saveThemeConfig({...config, toolIcons: next});
	configEvents.emitConfigChange({type: 'toolIcons', value: next});
}

/**
 * Replace tool icon config wholesale (boolean or {enabled, tools}).
 */
export function setToolIconsConfig(value: ToolIconsConfig): void {
	const config = loadThemeConfig();
	const normalized = normalizeToolIconsConfig(value);
	const next: ToolIconsConfig =
		Object.keys(normalized.tools).length > 0
			? {enabled: normalized.enabled, tools: normalized.tools}
			: normalized.enabled;
	saveThemeConfig({...config, toolIcons: next});
	configEvents.emitConfigChange({type: 'toolIcons', value: next});
}

/**
 * Set/override a single tool icon. Pass empty string to clear override.
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
	const next: ToolIconsConfig =
		Object.keys(tools).length > 0
			? {enabled: current.enabled, tools}
			: current.enabled;
	saveThemeConfig({...config, toolIcons: next});
	configEvents.emitConfigChange({type: 'toolIcons', value: next});
}
