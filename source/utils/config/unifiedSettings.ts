/**
 * Unified settings storage for snow-cli.
 *
 * 历史上，snow-cli 在 `.snow/` 目录下放了多份 JSON 配置：
 *   - settings.json
 *   - codebase.json
 *   - connection.json
 *   - working-dirs.json
 *   - disabled-builtin-tools.json
 *   - disabled-mcp-tools.json
 *   - disabled-skills.json
 *   - mcp-config.json
 *   - opt-in-mcp-tools.json
 *   - role.json
 *   - sensitive-commands.json
 *
 * 现在统一收敛到 `.snow/settings.json` 一个文件（项目级、全局级各自一份）。
 * 各模块通过本文件读写所需字段，老的独立 JSON 文件由 `legacyConfigMigration.ts`
 * 在启动期一次性扫描、迁移并删除；运行期不再兼容读取旧独立 JSON。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Top-level shape of the unified settings file.
 *
 * 字段全部 optional，便于增量演进；每个使用方在读取时给出默认值即可。
 */
export interface UnifiedSettings {
	// === 来自旧 settings.json ===
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
	telemetry?: {
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
	};

	// === 来自旧 codebase.json ===
	codebase?: {
		enabled?: boolean;
		enableAgentReview?: boolean;
		enableReranking?: boolean;
		batch?: {
			maxLines?: number;
			concurrency?: number;
		};
		chunking?: {
			maxLinesPerChunk?: number;
			minLinesPerChunk?: number;
			minCharsPerChunk?: number;
			overlapLines?: number;
		};
		// 仅全局存放
		embedding?: {
			type?: 'jina' | 'ollama' | 'gemini' | 'mistral';
			modelName?: string;
			baseUrl?: string;
			apiKey?: string;
			dimensions?: number;
		};
		// 仅全局存放
		reranking?: {
			modelName?: string;
			baseUrl?: string;
			apiKey?: string;
			contextLength?: number;
			topN?: number;
		};
	};

	// === 来自旧 connection.json (仅项目级有效) ===
	connection?: {
		apiUrl: string;
		username: string;
		password: string;
		instanceId: string;
		instanceName: string;
	};

	// === 来自旧 working-dirs.json ===
	workingDirectories?: Array<{
		path: string;
		isDefault: boolean;
		addedAt: number;
		isRemote?: boolean;
		sshConfig?: {
			host: string;
			port: number;
			username: string;
			authMethod: 'password' | 'privateKey' | 'agent';
			password?: string;
			privateKeyPath?: string;
			passphrase?: string;
		};
		displayName?: string;
	}>;

	// === 来自旧 disabled-builtin-tools.json ===
	disabledBuiltInServices?: string[];

	// === 来自旧 disabled-mcp-tools.json ===
	disabledMCPTools?: string[];

	// === 来自旧 opt-in-mcp-tools.json ===
	optInMCPTools?: string[];

	// === 来自旧 disabled-skills.json ===
	disabledSkills?: string[];

	// === 来自旧 mcp-config.json ===
	mcpServers?: Record<string, unknown>;

	// === 来自旧 role.json ===
	role?: {
		activeRoleId?: string;
		overrideRoleIds?: string[];
	};

	// === 来自旧 sensitive-commands.json ===
	sensitiveCommands?: Array<{
		id: string;
		pattern: string;
		description: string;
		enabled: boolean;
		isPreset: boolean;
	}>;
}

export type SettingsScope = 'project' | 'global';

const SETTINGS_FILE_NAME = 'settings.json';

function getSnowDir(scope: SettingsScope, workingDirectory?: string): string {
	if (scope === 'global') {
		return path.join(os.homedir(), '.snow');
	}
	return path.join(workingDirectory || process.cwd(), '.snow');
}

export function getSettingsPath(
	scope: SettingsScope,
	workingDirectory?: string,
): string {
	return path.join(getSnowDir(scope, workingDirectory), SETTINGS_FILE_NAME);
}

function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
}

/**
 * Read raw settings object from disk. Missing file / parse errors -> `{}`.
 */
export function readSettings(
	scope: SettingsScope,
	workingDirectory?: string,
): UnifiedSettings {
	const filePath = getSettingsPath(scope, workingDirectory);
	try {
		if (!fs.existsSync(filePath)) {
			return {};
		}
		const content = fs.readFileSync(filePath, 'utf-8');
		if (!content.trim()) return {};
		const parsed = JSON.parse(content) as UnifiedSettings;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Persist the full settings object atomically. Silently ignores write errors
 * (consistent with the previous per-file behavior).
 */
export function writeSettings(
	scope: SettingsScope,
	settings: UnifiedSettings,
	workingDirectory?: string,
): void {
	try {
		const dir = getSnowDir(scope, workingDirectory);
		ensureDir(dir);
		const filePath = getSettingsPath(scope, workingDirectory);
		fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
	} catch {
		// ignore
	}
}

/**
 * Convenience helper: load, mutate, save.
 */
export function updateSettings(
	scope: SettingsScope,
	mutator: (settings: UnifiedSettings) => void,
	workingDirectory?: string,
): UnifiedSettings {
	const current = readSettings(scope, workingDirectory);
	mutator(current);
	writeSettings(scope, current, workingDirectory);
	return current;
}

/**
 * Merge settings from both scopes — project values win over global ones for
 * primitive fields, while arrays/objects are returned as-is from project when
 * present (callers that need fine-grained merging should fetch each scope
 * separately).
 */
export function readMergedSettings(workingDirectory?: string): UnifiedSettings {
	const globalSettings = readSettings('global');
	const projectSettings = readSettings('project', workingDirectory);
	return {...globalSettings, ...projectSettings};
}
