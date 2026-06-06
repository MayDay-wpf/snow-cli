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
	telemetry?: TelemetryConfig;
}

export interface TelemetryConfig {
	enabled?: boolean;
	serviceName?: string;
	tracesExporter?: 'otlp' | 'console' | 'none';
	metricsExporter?: 'otlp' | 'prometheus' | 'console' | 'none';
	logsExporter?: 'otlp' | 'console' | 'none';
	otlpProtocol?: 'grpc' | 'http/protobuf' | 'http/json';
	otlpEndpoint?: string;
	otlpHeaders?: string;
	injectSessionIdHeader?: boolean;
	captureContent?: boolean;
	contentMaxLength?: number;
}

export const DEFAULT_TELEMETRY_SERVICE_NAME = 'snow-cli';
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
		telemetry: pick('telemetry'),
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

export function getTelemetryConfig(): TelemetryConfig {
	const settings = loadSettings();
	return {
		enabled: settings.telemetry?.enabled ?? false,
		serviceName:
			settings.telemetry?.serviceName?.trim() || DEFAULT_TELEMETRY_SERVICE_NAME,
		tracesExporter: settings.telemetry?.tracesExporter ?? 'otlp',
		metricsExporter: settings.telemetry?.metricsExporter ?? 'otlp',
		logsExporter: settings.telemetry?.logsExporter ?? 'none',
		otlpProtocol: settings.telemetry?.otlpProtocol ?? 'grpc',
		otlpEndpoint: settings.telemetry?.otlpEndpoint ?? 'http://localhost:4317',
		otlpHeaders: settings.telemetry?.otlpHeaders ?? '',
		injectSessionIdHeader: settings.telemetry?.injectSessionIdHeader ?? false,
		captureContent: settings.telemetry?.captureContent ?? true,
		contentMaxLength: settings.telemetry?.contentMaxLength ?? 4096,
	};
}

export function setTelemetryConfig(config: TelemetryConfig): void {
	setField('telemetry', config);
}

export function isTelemetryEnabled(): boolean {
	return getTelemetryConfig().enabled === true;
}

export function getTelemetryEnabled(): boolean {
	return getTelemetryConfig().enabled === true;
}

export function setTelemetryEnabled(enabled: boolean): void {
	setTelemetryConfig({...getTelemetryConfig(), enabled});
}

export function getTelemetryTracesExporter(): string {
	return getTelemetryConfig().tracesExporter ?? 'otlp';
}

export function setTelemetryTracesExporter(value: string): void {
	setTelemetryConfig({
		...getTelemetryConfig(),
		tracesExporter: value as TelemetryConfig['tracesExporter'],
	});
}

export function getTelemetryMetricsExporter(): string {
	return getTelemetryConfig().metricsExporter ?? 'otlp';
}

export function setTelemetryMetricsExporter(value: string): void {
	setTelemetryConfig({
		...getTelemetryConfig(),
		metricsExporter: value as TelemetryConfig['metricsExporter'],
	});
}

export function getTelemetryLogsExporter(): string {
	return getTelemetryConfig().logsExporter ?? 'none';
}

export function setTelemetryLogsExporter(value: string): void {
	setTelemetryConfig({
		...getTelemetryConfig(),
		logsExporter: value as TelemetryConfig['logsExporter'],
	});
}

export function getTelemetryOtlpProtocol(): string {
	return getTelemetryConfig().otlpProtocol ?? 'grpc';
}

export function setTelemetryOtlpProtocol(value: string): void {
	setTelemetryConfig({
		...getTelemetryConfig(),
		otlpProtocol: value as TelemetryConfig['otlpProtocol'],
	});
}

export function getTelemetryOtlpEndpoint(): string {
	return getTelemetryConfig().otlpEndpoint ?? 'http://localhost:4317';
}

export function setTelemetryOtlpEndpoint(value: string): void {
	setTelemetryConfig({...getTelemetryConfig(), otlpEndpoint: value});
}

export function getTelemetryOtlpHeaders(): string {
	return getTelemetryConfig().otlpHeaders ?? '';
}

export function setTelemetryOtlpHeaders(value: string): void {
	setTelemetryConfig({...getTelemetryConfig(), otlpHeaders: value});
}

export function getTelemetryInjectSessionIdHeader(): boolean {
	return getTelemetryConfig().injectSessionIdHeader === true;
}

export function setTelemetryInjectSessionIdHeader(value: boolean): void {
	setTelemetryConfig({
		...getTelemetryConfig(),
		injectSessionIdHeader: value,
	});
}
