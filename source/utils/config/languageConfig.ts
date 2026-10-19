import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {getGlobalSnowDir} from '../core/snowContext.js';
import {logger} from '../core/logger.js';

const log = logger.child('config.language');

export type Language = 'en' | 'zh' | 'zh-TW';

function getLanguageConfigFile(): string {
	return join(getGlobalSnowDir().native, 'language.json');
}

interface LanguageConfig {
	language: Language;
}

const DEFAULT_CONFIG: LanguageConfig = {
	language: 'en',
};

function ensureConfigDirectory(): void {
	const dir = getGlobalSnowDir().native;
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
}

/**
 * Load language configuration from file system
 */
export function loadLanguageConfig(): LanguageConfig {
	ensureConfigDirectory();
	const configFile = getLanguageConfigFile();

	if (!existsSync(configFile)) {
		saveLanguageConfig(DEFAULT_CONFIG);
		return DEFAULT_CONFIG;
	}

	try {
		const configData = readFileSync(configFile, 'utf-8');
		const config = JSON.parse(configData);
		return {
			...DEFAULT_CONFIG,
			...config,
		};
	} catch (error) {
		// If config file is corrupted, return default config
		log.warn('Corrupted language config, falling back to default', error);
		return DEFAULT_CONFIG;
	}
}

/**
 * Save language configuration to file system
 */
export function saveLanguageConfig(config: LanguageConfig): void {
	ensureConfigDirectory();
	const configFile = getLanguageConfigFile();

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(configFile, configData, 'utf-8');
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
