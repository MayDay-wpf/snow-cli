import {homedir} from 'os';
import {join} from 'path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';

export type Language = 'en' | 'zh' | 'zh-TW';

const CONFIG_DIR = join(homedir(), '.snow');
const LANGUAGE_CONFIG_FILE = join(CONFIG_DIR, 'language.json');

interface LanguageConfig {
	language: Language;
}

const DEFAULT_CONFIG: LanguageConfig = {
	language: 'en',
};

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

/**
 * Load language configuration from file system
 */
export function loadLanguageConfig(): LanguageConfig {
	ensureConfigDirectory();

	if (!existsSync(LANGUAGE_CONFIG_FILE)) {
		saveLanguageConfig(DEFAULT_CONFIG);
		return DEFAULT_CONFIG;
	}

	try {
		const configData = readFileSync(LANGUAGE_CONFIG_FILE, 'utf-8');
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
 * Save language configuration to file system
 */
export function saveLanguageConfig(config: LanguageConfig): void {
	ensureConfigDirectory();

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(LANGUAGE_CONFIG_FILE, configData, 'utf-8');
	} catch (error) {
		console.error('Failed to save language config:', error);
	}
}

/**
 * Get current language setting
 */
export function getCurrentLanguage(): Language {
	const config = loadLanguageConfig();
	return config.language;
}

/**
 * Set language and persist to file system
 */
export function setCurrentLanguage(language: Language): void {
	saveLanguageConfig({language});
}
