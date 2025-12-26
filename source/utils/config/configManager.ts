import {homedir} from 'os';
import {join} from 'path';
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	unlinkSync,
} from 'fs';
import {
	loadConfig,
	saveConfig,
	DEFAULT_CONFIG,
	type AppConfig,
} from './apiConfig.js';
import {codebaseReviewAgent} from '../../agents/codebaseReviewAgent.js';
import {reviewAgent} from '../../agents/reviewAgent.js';
import {summaryAgent} from '../../agents/summaryAgent.js';
import {unifiedHooksExecutor} from '../execution/unifiedHooksExecutor.js';

const CONFIG_DIR = join(homedir(), '.snow');
const PROFILES_DIR = join(CONFIG_DIR, 'profiles');
const ACTIVE_PROFILE_FILE = join(CONFIG_DIR, 'active-profile.json');
const LEGACY_ACTIVE_PROFILE_FILE = join(CONFIG_DIR, 'active-profile.txt');
const LEGACY_CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Clear all agent configuration caches
 * Called when profile switches or config reloads
 */
export function clearAllAgentCaches(): void {
	codebaseReviewAgent.clearCache();
	reviewAgent.clearCache();
	summaryAgent.clearCache();
	unifiedHooksExecutor.clearCache();
}

export interface ConfigProfile {
	name: string;
	displayName: string;
	isActive: boolean;
	config: AppConfig;
}

/**
 * Ensure the profiles directory exists
 */
function ensureProfilesDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}

	if (!existsSync(PROFILES_DIR)) {
		mkdirSync(PROFILES_DIR, {recursive: true});
	}
}

/**
 * Get the current active profile name
 */
export function getActiveProfileName(): string {
	ensureProfilesDirectory();

	// Auto-migrate from legacy .txt format to new .json format
	if (
		!existsSync(ACTIVE_PROFILE_FILE) &&
		existsSync(LEGACY_ACTIVE_PROFILE_FILE)
	) {
		try {
			const legacyProfileName = readFileSync(
				LEGACY_ACTIVE_PROFILE_FILE,
				'utf8',
			).trim();
			const profileName = legacyProfileName || 'default';
			// Save in new JSON format
			setActiveProfileName(profileName);
			// Delete old .txt file
			unlinkSync(LEGACY_ACTIVE_PROFILE_FILE);
			return profileName;
		} catch {
			// If migration fails, continue with default
		}
	}

	if (!existsSync(ACTIVE_PROFILE_FILE)) {
		return 'default';
	}

	try {
		const fileContent = readFileSync(ACTIVE_PROFILE_FILE, 'utf8').trim();
		const data = JSON.parse(fileContent);
		return data.activeProfile || 'default';
	} catch {
		return 'default';
	}
}

/**
 * Set the active profile
 */
function setActiveProfileName(profileName: string): void {
	ensureProfilesDirectory();

	try {
		const data = {activeProfile: profileName};
		writeFileSync(ACTIVE_PROFILE_FILE, JSON.stringify(data, null, 2), 'utf8');
	} catch (error) {
		throw new Error(`Failed to set active profile: ${error}`);
	}
}

/**
 * Get the path to a profile file
 */
function getProfilePath(profileName: string): string {
	return join(PROFILES_DIR, `${profileName}.json`);
}

/**
 * Migrate legacy config.json to profiles/default.json
 * This ensures backward compatibility with existing installations
 */
function migrateLegacyConfig(): void {
	ensureProfilesDirectory();

	const defaultProfilePath = getProfilePath('default');

	// If default profile already exists, no migration needed
	if (existsSync(defaultProfilePath)) {
		return;
	}

	// If legacy config exists, migrate it
	if (existsSync(LEGACY_CONFIG_FILE)) {
		try {
			const legacyConfig = readFileSync(LEGACY_CONFIG_FILE, 'utf8');
			writeFileSync(defaultProfilePath, legacyConfig, 'utf8');

			// Set default as active profile
			setActiveProfileName('default');
		} catch (error) {
			// If migration fails, we'll create a default profile later
			console.error('Failed to migrate legacy config:', error);
		}
	}
}

/**
 * Load a specific profile with deep merge of default config
 * This ensures new config fields (like browserPath) are preserved
 */
export function loadProfile(profileName: string): AppConfig | undefined {
	ensureProfilesDirectory();
	migrateLegacyConfig();

	const profilePath = getProfilePath(profileName);

	if (!existsSync(profilePath)) {
		return undefined;
	}

	try {
		const configData = readFileSync(profilePath, 'utf8');
		const parsedConfig = JSON.parse(configData) as Partial<AppConfig>;

		const mergedConfig: AppConfig = {
			...DEFAULT_CONFIG,
			...parsedConfig,
			snowcfg: {
				...DEFAULT_CONFIG.snowcfg,
				...(parsedConfig.snowcfg || {}),
			},
		};

		return mergedConfig;
	} catch {
		return undefined;
	}
}

/**
 * Save a profile
 */
export function saveProfile(profileName: string, config: AppConfig): void {
	ensureProfilesDirectory();

	const profilePath = getProfilePath(profileName);

	try {
		// Remove openai field for backward compatibility
		const {openai, ...configWithoutOpenai} = config;
		const configData = JSON.stringify(configWithoutOpenai, null, 2);
		writeFileSync(profilePath, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save profile: ${error}`);
	}
}

/**
 * Get all available profiles
 */
export function getAllProfiles(): ConfigProfile[] {
	ensureProfilesDirectory();
	migrateLegacyConfig();

	const activeProfile = getActiveProfileName();
	const profiles: ConfigProfile[] = [];

	try {
		const files = readdirSync(PROFILES_DIR);

		for (const file of files) {
			if (file.endsWith('.json')) {
				const profileName = file.replace('.json', '');
				const config = loadProfile(profileName);

				if (config) {
					profiles.push({
						name: profileName,
						displayName: getProfileDisplayName(profileName),
						isActive: profileName === activeProfile,
						config,
					});
				}
			}
		}
	} catch {
		// If reading fails, return empty array
	}

	// Ensure at least a default profile exists
	if (profiles.length === 0) {
		const defaultConfig = loadConfig();
		saveProfile('default', defaultConfig);
		profiles.push({
			name: 'default',
			displayName: 'Default',
			isActive: true,
			config: defaultConfig,
		});
		setActiveProfileName('default');
	}

	return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get a user-friendly display name for a profile
 */
function getProfileDisplayName(profileName: string): string {
	// Capitalize first letter
	return profileName.charAt(0).toUpperCase() + profileName.slice(1);
}

/**
 * Switch to a different profile
 * This copies the profile config to config.json and updates the active profile
 */
export function switchProfile(profileName: string): void {
	ensureProfilesDirectory();

	const profileConfig = loadProfile(profileName);

	if (!profileConfig) {
		throw new Error(`Profile \"${profileName}\" not found`);
	}

	// Check if profile has legacy proxy config and migrate it
	const profileConfigAny = profileConfig as any;
	if (profileConfigAny.proxy !== undefined) {
		try {
			// Migrate proxy config to independent file by writing directly
			const proxyConfigPath = join(CONFIG_DIR, 'proxy-config.json');
			const proxyConfig = {
				enabled: profileConfigAny.proxy.enabled ?? false,
				port: profileConfigAny.proxy.port ?? 7890,
				browserPath: profileConfigAny.proxy.browserPath,
			};
			writeFileSync(
				proxyConfigPath,
				JSON.stringify(proxyConfig, null, 2),
				'utf8',
			);
			// Remove proxy from profile config
			delete profileConfigAny.proxy;
			// Also resave the profile without proxy
			saveProfile(profileName, profileConfig);
		} catch (error) {
			console.error(
				'Failed to migrate proxy config during profile switch:',
				error,
			);
		}
	}

	// Save the profile config to the main config.json (for backward compatibility)
	saveConfig(profileConfig);

	// Update the active profile marker
	setActiveProfileName(profileName);

	// Clear all agent caches when switching profiles
	clearAllAgentCaches();
}

/**
 * Get the next profile name for cycling through profiles
 * Returns the next profile in alphabetical order, or wraps to the first one
 */
export function getNextProfileName(): string {
	const profiles = getAllProfiles();
	if (profiles.length <= 1) {
		return getActiveProfileName();
	}

	const currentProfile = getActiveProfileName();
	const currentIndex = profiles.findIndex(p => p.name === currentProfile);
	const nextIndex = (currentIndex + 1) % profiles.length;
	return profiles[nextIndex]?.name || profiles[0]?.name || 'default';
}

/**
 * Create a new profile
 */
export function createProfile(profileName: string, config?: AppConfig): void {
	ensureProfilesDirectory();

	// Validate profile name
	if (
		!profileName.trim() ||
		profileName.includes('/') ||
		profileName.includes('\\')
	) {
		throw new Error('Invalid profile name');
	}

	const profilePath = getProfilePath(profileName);

	if (existsSync(profilePath)) {
		throw new Error(`Profile "${profileName}" already exists`);
	}

	// If no config provided, use the current config
	const profileConfig = config || loadConfig();
	saveProfile(profileName, profileConfig);
}

/**
 * Delete a profile
 */
export function deleteProfile(profileName: string): void {
	ensureProfilesDirectory();

	// Don't allow deleting the default profile
	if (profileName === 'default') {
		throw new Error('Cannot delete the default profile');
	}

	const profilePath = getProfilePath(profileName);

	if (!existsSync(profilePath)) {
		throw new Error(`Profile "${profileName}" not found`);
	}

	// If this is the active profile, switch to default first
	if (getActiveProfileName() === profileName) {
		switchProfile('default');
	}

	try {
		unlinkSync(profilePath);
	} catch (error) {
		throw new Error(`Failed to delete profile: ${error}`);
	}
}

/**
 * Rename a profile
 */
export function renameProfile(oldName: string, newName: string): void {
	ensureProfilesDirectory();

	// Validate new name
	if (!newName.trim() || newName.includes('/') || newName.includes('\\')) {
		throw new Error('Invalid profile name');
	}

	if (oldName === newName) {
		return;
	}

	const oldPath = getProfilePath(oldName);
	const newPath = getProfilePath(newName);

	if (!existsSync(oldPath)) {
		throw new Error(`Profile "${oldName}" not found`);
	}

	if (existsSync(newPath)) {
		throw new Error(`Profile "${newName}" already exists`);
	}

	try {
		const config = loadProfile(oldName);
		if (!config) {
			throw new Error(`Failed to load profile "${oldName}"`);
		}

		// Save with new name
		saveProfile(newName, config);

		// Update active profile if necessary
		if (getActiveProfileName() === oldName) {
			setActiveProfileName(newName);
		}

		// Delete old profile
		unlinkSync(oldPath);
	} catch (error) {
		throw new Error(`Failed to rename profile: ${error}`);
	}
}

/**
 * Initialize profiles system
 * This should be called on app startup to ensure profiles are set up
 */
export function initializeProfiles(): void {
	ensureProfilesDirectory();
	migrateLegacyConfig();

	// Ensure the active profile exists and is loaded to config.json
	const activeProfile = getActiveProfileName();
	let profileConfig = loadProfile(activeProfile);

	if (profileConfig) {
		// Sync the active profile to config.json
		saveConfig(profileConfig);
	} else {
		// If active profile doesn't exist, create it first
		// This is especially important for first-time installations
		const defaultConfig = loadConfig();
		saveProfile(activeProfile, defaultConfig);
		setActiveProfileName(activeProfile);

		// Now load and sync the newly created profile
		profileConfig = loadProfile(activeProfile);
		if (profileConfig) {
			saveConfig(profileConfig);
		}
	}
}
