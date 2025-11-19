import {homedir} from 'os';
import {join} from 'path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import type {ThemeType} from '../ui/themes/index.js';

const CONFIG_DIR = join(homedir(), '.snow');
const THEME_CONFIG_FILE = join(CONFIG_DIR, 'theme.json');

interface ThemeConfig {
	theme: ThemeType;
}

const DEFAULT_CONFIG: ThemeConfig = {
	theme: 'dark',
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
	saveThemeConfig({theme});
}
