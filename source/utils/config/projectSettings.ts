import * as fs from 'fs';
import * as path from 'path';

export interface ProjectSettings {
	toolSearchEnabled?: boolean;
	autoFormatEnabled?: boolean;
	subAgentMaxSpawnDepth?: number;
}

const SNOW_DIR = path.join(process.cwd(), '.snow');
const SETTINGS_FILE = path.join(SNOW_DIR, 'settings.json');

export const DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH = 1;

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

function normalizeSubAgentMaxSpawnDepth(depth: unknown): number {
	if (typeof depth !== 'number' || !Number.isFinite(depth)) {
		return DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH;
	}

	const normalizedDepth = Math.floor(depth);
	return normalizedDepth < 0 ? 0 : normalizedDepth;
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

export function getAutoFormatEnabled(): boolean {
	const settings = loadSettings();
	return settings.autoFormatEnabled ?? true;
}

export function setAutoFormatEnabled(enabled: boolean): void {
	const settings = loadSettings();
	settings.autoFormatEnabled = enabled;
	saveSettings(settings);
}

export function getSubAgentMaxSpawnDepth(): number {
	const settings = loadSettings();
	return normalizeSubAgentMaxSpawnDepth(settings.subAgentMaxSpawnDepth);
}

export function setSubAgentMaxSpawnDepth(depth: number): number {
	const settings = loadSettings();
	const normalizedDepth = normalizeSubAgentMaxSpawnDepth(depth);
	settings.subAgentMaxSpawnDepth = normalizedDepth;
	saveSettings(settings);
	return normalizedDepth;
}
