import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ProjectSettings {
	toolSearchEnabled?: boolean;
	autoFormatEnabled?: boolean;
	subAgentMaxSpawnDepth?: number;
	fileListDisplayMode?: 'list' | 'tree';
	yoloMode?: boolean;
	planMode?: boolean;
	vulnerabilityHuntingMode?: boolean;
	hybridCompressEnabled?: boolean;
	teamMode?: boolean;
}

const PROJECT_SNOW_DIR = path.join(process.cwd(), '.snow');
const GLOBAL_SNOW_DIR = path.join(os.homedir(), '.snow');
const PROJECT_SETTINGS_FILE = path.join(PROJECT_SNOW_DIR, 'settings.json');
const GLOBAL_SETTINGS_FILE = path.join(GLOBAL_SNOW_DIR, 'settings.json');

export const DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH = 1;

function ensureSnowDir(): void {
	if (!fs.existsSync(PROJECT_SNOW_DIR)) {
		fs.mkdirSync(PROJECT_SNOW_DIR, {recursive: true});
	}
}

function loadSettings(): ProjectSettings {
	try {
		// 优先读取项目配置
		if (fs.existsSync(PROJECT_SETTINGS_FILE)) {
			const content = fs.readFileSync(PROJECT_SETTINGS_FILE, 'utf-8');
			return JSON.parse(content) as ProjectSettings;
		}

		// 如果项目配置不存在，读取全局配置
		if (fs.existsSync(GLOBAL_SETTINGS_FILE)) {
			const content = fs.readFileSync(GLOBAL_SETTINGS_FILE, 'utf-8');
			return JSON.parse(content) as ProjectSettings;
		}

		return {};
	} catch {
		return {};
	}
}

function saveSettings(settings: ProjectSettings): void {
	try {
		ensureSnowDir();
		fs.writeFileSync(
			PROJECT_SETTINGS_FILE,
			JSON.stringify(settings, null, 2),
			'utf-8',
		);
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

export function getFileListDisplayMode(): 'list' | 'tree' {
	const settings = loadSettings();
	return settings.fileListDisplayMode ?? 'list';
}

export function setFileListDisplayMode(mode: 'list' | 'tree'): void {
	const settings = loadSettings();
	settings.fileListDisplayMode = mode;
	saveSettings(settings);
}

export function getYoloMode(): boolean {
	const settings = loadSettings();
	return settings.yoloMode ?? false;
}

export function setYoloMode(enabled: boolean): void {
	const settings = loadSettings();
	settings.yoloMode = enabled;
	saveSettings(settings);
}

export function getPlanMode(): boolean {
	const settings = loadSettings();
	return settings.planMode ?? false;
}

export function setPlanMode(enabled: boolean): void {
	const settings = loadSettings();
	settings.planMode = enabled;
	saveSettings(settings);
}

export function getVulnerabilityHuntingMode(): boolean {
	const settings = loadSettings();
	return settings.vulnerabilityHuntingMode ?? false;
}

export function setVulnerabilityHuntingMode(enabled: boolean): void {
	const settings = loadSettings();
	settings.vulnerabilityHuntingMode = enabled;
	saveSettings(settings);
}

export function getHybridCompressEnabled(): boolean {
	const settings = loadSettings();
	return settings.hybridCompressEnabled ?? false;
}

export function setHybridCompressEnabled(enabled: boolean): void {
	const settings = loadSettings();
	settings.hybridCompressEnabled = enabled;
	saveSettings(settings);
}

export function getTeamMode(): boolean {
	const settings = loadSettings();
	return settings.teamMode ?? false;
}

export function setTeamMode(enabled: boolean): void {
	const settings = loadSettings();
	settings.teamMode = enabled;
	saveSettings(settings);
}
