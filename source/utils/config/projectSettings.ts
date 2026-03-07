import * as fs from 'fs';
import * as path from 'path';

export interface ProjectSettings {
	toolSearchEnabled?: boolean;
}

const SNOW_DIR = path.join(process.cwd(), '.snow');
const SETTINGS_FILE = path.join(SNOW_DIR, 'settings.json');

function ensureSnowDir(): void {
	if (!fs.existsSync(SNOW_DIR)) {
		fs.mkdirSync(SNOW_DIR, {recursive: true});
	}
}

function loadSettings(): ProjectSettings {
	try {
		if (!fs.existsSync(SETTINGS_FILE)) {
			return {};
		}
		const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
		return JSON.parse(content) as ProjectSettings;
	} catch {
		return {};
	}
}

function saveSettings(settings: ProjectSettings): void {
	try {
		ensureSnowDir();
		fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
	} catch {
		// Ignore write errors
	}
}

export function getToolSearchEnabled(): boolean {
	const settings = loadSettings();
	return settings.toolSearchEnabled ?? false;
}

export function setToolSearchEnabled(enabled: boolean): void {
	const settings = loadSettings();
	settings.toolSearchEnabled = enabled;
	saveSettings(settings);
}
