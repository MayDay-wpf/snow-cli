import {
	readSettings,
	updateSettings,
	type SettingsScope,
	type UnifiedSettings,
} from './unifiedSettings.js';

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
	ultraTodoEnabled?: boolean;
}

export const DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH = 1;

/**
 * Backwards-compatible loader: prefer project scope, fall back to global, then
 * default. The new storage backend is `unifiedSettings`, so this just reads the
 * relevant top-level fields from `settings.json`.
 */
function loadSettings(): ProjectSettings {
	const project = readSettings('project');
	const global = readSettings('global');

	const pick = <K extends keyof ProjectSettings>(
		key: K,
	): ProjectSettings[K] | undefined => {
		const fromProject = (project as ProjectSettings)[key];
		if (fromProject !== undefined) return fromProject;
		return (global as ProjectSettings)[key];
	};

	return {
		toolSearchEnabled: pick('toolSearchEnabled'),
		autoFormatEnabled: pick('autoFormatEnabled'),
		subAgentMaxSpawnDepth: pick('subAgentMaxSpawnDepth'),
		fileListDisplayMode: pick('fileListDisplayMode'),
		yoloMode: pick('yoloMode'),
		planMode: pick('planMode'),
		vulnerabilityHuntingMode: pick('vulnerabilityHuntingMode'),
		hybridCompressEnabled: pick('hybridCompressEnabled'),
		teamMode: pick('teamMode'),
		ultraTodoEnabled: pick('ultraTodoEnabled'),
	};
}

function setField<K extends keyof ProjectSettings>(
	key: K,
	value: ProjectSettings[K],
	scope: SettingsScope = 'project',
): void {
	updateSettings(scope, settings => {
		(settings as UnifiedSettings)[key] = value as UnifiedSettings[K];
	});
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
	setField('toolSearchEnabled', enabled);
}

export function getAutoFormatEnabled(): boolean {
	const settings = loadSettings();
	return settings.autoFormatEnabled ?? true;
}

export function setAutoFormatEnabled(enabled: boolean): void {
	setField('autoFormatEnabled', enabled);
}

export function getSubAgentMaxSpawnDepth(): number {
	const settings = loadSettings();
	return normalizeSubAgentMaxSpawnDepth(settings.subAgentMaxSpawnDepth);
}

export function setSubAgentMaxSpawnDepth(depth: number): number {
	const normalizedDepth = normalizeSubAgentMaxSpawnDepth(depth);
	setField('subAgentMaxSpawnDepth', normalizedDepth);
	return normalizedDepth;
}

export function getFileListDisplayMode(): 'list' | 'tree' {
	const settings = loadSettings();
	return settings.fileListDisplayMode ?? 'list';
}

export function setFileListDisplayMode(mode: 'list' | 'tree'): void {
	setField('fileListDisplayMode', mode);
}

export function getYoloMode(): boolean {
	const settings = loadSettings();
	return settings.yoloMode ?? false;
}

export function setYoloMode(enabled: boolean): void {
	setField('yoloMode', enabled);
}

export function getPlanMode(): boolean {
	const settings = loadSettings();
	return settings.planMode ?? false;
}

export function setPlanMode(enabled: boolean): void {
	setField('planMode', enabled);
}

export function getVulnerabilityHuntingMode(): boolean {
	const settings = loadSettings();
	return settings.vulnerabilityHuntingMode ?? false;
}

export function setVulnerabilityHuntingMode(enabled: boolean): void {
	setField('vulnerabilityHuntingMode', enabled);
}

export function getHybridCompressEnabled(): boolean {
	const settings = loadSettings();
	return settings.hybridCompressEnabled ?? false;
}

export function setHybridCompressEnabled(enabled: boolean): void {
	setField('hybridCompressEnabled', enabled);
}

export function getTeamMode(): boolean {
	const settings = loadSettings();
	return settings.teamMode ?? false;
}

export function setTeamMode(enabled: boolean): void {
	setField('teamMode', enabled);
}


export function getUltraTodoEnabled(): boolean {
	const settings = loadSettings();
	return settings.ultraTodoEnabled ?? false;
}

export function setUltraTodoEnabled(enabled: boolean): void {
	setField('ultraTodoEnabled', enabled);
}
