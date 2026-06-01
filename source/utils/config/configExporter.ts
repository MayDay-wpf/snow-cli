import {readFile, writeFile} from 'fs/promises';
import matter from 'gray-matter';
import {
	getActiveProfileName,
	getAllProfiles,
	saveProfile,
	setActiveProfileFromImport,
	type ConfigProfile,
} from './configManager.js';
import {
	getCustomHeadersConfig,
	getGlobalMCPConfig,
	getMCPConfig,
	getProjectMCPConfig,
	getSystemPromptConfig,
	saveCustomHeadersConfig,
	saveSystemPromptConfig,
	updateMCPConfig,
	type AppConfig,
	type CustomHeadersConfig,
	type MCPConfig,
	type SystemPromptConfig,
} from './apiConfig.js';
import {loadCodebaseConfig, saveCodebaseConfig, type CodebaseConfig} from './codebaseConfig.js';
import {
	getAllHookTypes,
	loadHookConfig,
	saveHookConfig,
	type HookRule,
	type HookScope,
	type HookType,
} from './hooksConfig.js';
import {loadLanguageConfig, saveLanguageConfig} from './languageConfig.js';
import {getProxyConfig, saveProxyConfig, type ProxyConfig} from './proxyConfig.js';
import {getSubAgents, getUserSubAgents, saveUserSubAgents, type SubAgent} from './subAgentConfig.js';
import {loadThemeConfig, saveThemeConfig} from './themeConfig.js';
import {
	getAllSensitiveCommands,
	saveSensitiveCommands,
	saveSensitiveCommandsForScope,
	type SensitiveCommand,
	type SensitiveCommandsConfig,
} from '../execution/sensitiveCommandManager.js';
import {
	importCustomCommandsForLocation,
	loadCustomCommandsForLocation,
	registerCustomCommands,
	type CommandLocation,
	type CustomCommand,
} from '../commands/custom.js';


type YamlScalar = string | number | boolean | null;
type YamlValue = YamlScalar | YamlValue[] | {[key: string]: YamlValue};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value)
	);
}

function toYamlValue(value: unknown): YamlValue {
	if (value === undefined || value === null) {
		return null;
	}

	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map(item => toYamlValue(item));
	}

	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, nestedValue]) => [
				key,
				toYamlValue(nestedValue),
			]),
		) as {[key: string]: YamlValue};
	}

	return String(value);
}

function isYamlScalar(value: YamlValue): value is YamlScalar {
	return value === null || typeof value !== 'object';
}

function formatKey(key: string): string {
	return /^[A-Za-z_][\w-]*$/.test(key) ? key : JSON.stringify(key);
}

function formatScalar(value: YamlScalar): string {
	if (value === null) {
		return 'null';
	}

	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
	}

	if (typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}

function serializeYamlValue(value: YamlValue, indent = 0): string {
	const padding = '  '.repeat(indent);

	if (isYamlScalar(value)) {
		return `${padding}${formatScalar(value)}`;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return `${padding}[]`;
		}

		return value
			.map(item => {
				if (isYamlScalar(item)) {
					return `${padding}- ${formatScalar(item)}`;
				}

				return `${padding}-\n${serializeYamlValue(item, indent + 1)}`;
			})
			.join('\n');
	}

	const entries = Object.entries(value);
	if (entries.length === 0) {
		return `${padding}{}`;
	}

	return entries
		.map(([key, nestedValue]) => {
			if (isYamlScalar(nestedValue)) {
				return `${padding}${formatKey(key)}: ${formatScalar(nestedValue)}`;
			}

			return `${padding}${formatKey(key)}:\n${serializeYamlValue(
				nestedValue,
				indent + 1,
			)}`;
		})
		.join('\n');
}

function getHooksExportData(): YamlValue {
	const result: {[key: string]: YamlValue} = {};
	const scopes: HookScope[] = ['global', 'project'];
	const hookTypes = getAllHookTypes();

	for (const scope of scopes) {
		const scopedHooks: {[key: string]: YamlValue} = {};

		for (const hookType of hookTypes) {
			scopedHooks[hookType] = toYamlValue(loadHookConfig(hookType, scope));
		}

		result[scope] = scopedHooks;
	}

	return result;
}

function toCustomCommandsExportValue(commands: CustomCommand[]): YamlValue {
	return toYamlValue(
		commands.map(command => ({
			name: command.name,
			command: command.command,
			type: command.type,
			...(command.description ? {description: command.description} : {}),
			location: command.location,
		})),
	);
}

async function getCustomCommandsExportData(
	workingDirectory: string,
): Promise<YamlValue> {
	const [globalCommands, projectCommands] = await Promise.all([
		loadCustomCommandsForLocation('global'),
		loadCustomCommandsForLocation('project', workingDirectory),
	]);

	return {
		global: toCustomCommandsExportValue(globalCommands),
		project: toCustomCommandsExportValue(projectCommands),
	};
}


export async function getConfigManagerExportData(): Promise<YamlValue> {
	const workingDirectory = process.cwd();

	return {
		formatVersion: 1,
		exportedAt: new Date().toISOString(),
		workingDirectory,
		activeProfile: getActiveProfileName(),
		profiles: getAllProfiles().map(profile => ({
			name: profile.name,
			displayName: profile.displayName,
			isActive: profile.isActive,
			config: toYamlValue(profile.config),
		})),
		systemPrompt: toYamlValue(getSystemPromptConfig() ?? null),
		customHeaders: toYamlValue(getCustomHeadersConfig() ?? null),
		mcp: {
			global: toYamlValue(getGlobalMCPConfig()),
			project: toYamlValue(getProjectMCPConfig()),
			merged: toYamlValue(getMCPConfig()),
		},
		proxy: toYamlValue(getProxyConfig()),
		codebase: {
			workingDirectory,
			config: toYamlValue(loadCodebaseConfig(workingDirectory)),
		},
		subAgents: {
			userConfigured: toYamlValue(getUserSubAgents()),
			effective: toYamlValue(getSubAgents()),
		},
		sensitiveCommands: {
			all: toYamlValue(getAllSensitiveCommands()),
		},
		customCommands: await getCustomCommandsExportData(workingDirectory),
		hooks: getHooksExportData(),
		language: toYamlValue(loadLanguageConfig()),
		theme: toYamlValue(loadThemeConfig()),
	};
}

export async function serializeConfigManagerExportToYaml(): Promise<string> {
	return `${serializeYamlValue(await getConfigManagerExportData())}\n`;
}

export async function exportConfigManagerToYamlFile(
	filePath: string,
): Promise<void> {
	await writeFile(filePath, await serializeConfigManagerExportToYaml(), 'utf8');
}

export interface ConfigImportResult {
	importedKeys: string[];
	skippedKeys: string[];
}

const IMPORTABLE_KEYS = [
	'profiles',
	'activeProfile',
	'systemPrompt',
	'customHeaders',
	'mcp',
	'proxy',
	'codebase',
	'subAgents',
	'sensitiveCommands',
	'customCommands',
	'hooks',
	'language',
	'theme',
] as const;

function hasOwn(data: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(data, key);
}

function parseYamlConfig(content: string): Record<string, unknown> {
	try {
		const yamlEngine = (matter as typeof matter & {
			engines: {yaml: {parse: (input: string) => unknown}};
		}).engines.yaml;
		const parsed = yamlEngine.parse(content);
		if (!isPlainObject(parsed)) {
			throw new TypeError('Configuration YAML root must be an object');
		}

		return parsed;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse YAML configuration: ${message}`);
	}
}

function importProfiles(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new TypeError('profiles must be an array');
	}

	for (const item of value) {
		if (!isPlainObject(item)) {
			continue;
		}

		const profile = item as Partial<ConfigProfile>;
		if (typeof profile.name === 'string' && isPlainObject(profile.config)) {
			saveProfile(profile.name, profile.config as AppConfig);
		}
	}
}

function importMcp(value: unknown): void {
	if (!isPlainObject(value)) {
		throw new TypeError('mcp must be an object');
	}

	if (hasOwn(value, 'global')) {
		updateMCPConfig(value['global'] as MCPConfig, 'global');
	}

	if (hasOwn(value, 'project')) {
		updateMCPConfig(value['project'] as MCPConfig, 'project');
	}
}

function importCodebase(value: unknown): void {
	if (isPlainObject(value) && hasOwn(value, 'config')) {
		saveCodebaseConfig(value['config'] as CodebaseConfig, process.cwd());
		return;
	}

	saveCodebaseConfig(value as CodebaseConfig, process.cwd());
}

function importSubAgents(value: unknown): void {
	if (Array.isArray(value)) {
		saveUserSubAgents(value as SubAgent[]);
		return;
	}

	if (isPlainObject(value) && hasOwn(value, 'userConfigured')) {
		saveUserSubAgents((value['userConfigured'] ?? []) as SubAgent[]);
	}
}

function stripSensitiveScope(commands: SensitiveCommand[]): SensitiveCommandsConfig {
	return {
		commands: commands.map(command => {
			const {id, pattern, description, enabled, isPreset} = command;
			return {id, pattern, description, enabled, isPreset};
		}),
	};
}

function importSensitiveCommands(value: unknown): void {
	if (Array.isArray(value)) {
		saveSensitiveCommands(stripSensitiveScope(value as SensitiveCommand[]));
		return;
	}

	if (!isPlainObject(value)) {
		throw new TypeError('sensitiveCommands must be an object or array');
	}

	if (hasOwn(value, 'global')) {
		saveSensitiveCommandsForScope(
			'global',
			{commands: value['global'] as SensitiveCommandsConfig['commands']},
		);
	}

	if (hasOwn(value, 'project')) {
		saveSensitiveCommandsForScope(
			'project',
			{commands: value['project'] as SensitiveCommandsConfig['commands']},
		);
	}

	if (hasOwn(value, 'all') && Array.isArray(value['all'])) {
		saveSensitiveCommands(stripSensitiveScope(value['all'] as SensitiveCommand[]));
	}
}

async function importCustomCommandsConfig(value: unknown): Promise<void> {
	if (Array.isArray(value)) {
		await importCustomCommandsForLocation(value, 'global');
		await registerCustomCommands(process.cwd());
		return;
	}

	if (!isPlainObject(value)) {
		throw new TypeError('customCommands must be an object or array');
	}

	const scopes: CommandLocation[] = ['global', 'project'];
	for (const scope of scopes) {
		if (!hasOwn(value, scope)) {
			continue;
		}

		await importCustomCommandsForLocation(
			value[scope],
			scope,
			scope === 'project' ? process.cwd() : undefined,
		);
	}

	await registerCustomCommands(process.cwd());
}


function importHooks(value: unknown): void {
	if (!isPlainObject(value)) {
		throw new TypeError('hooks must be an object');
	}

	const scopes: HookScope[] = ['global', 'project'];
	for (const scope of scopes) {
		const scopedHooks = value[scope];
		if (!isPlainObject(scopedHooks)) {
			continue;
		}

		for (const [hookType, rules] of Object.entries(scopedHooks)) {
			if (Array.isArray(rules)) {
				saveHookConfig(hookType as HookType, scope, rules as HookRule[]);
			}
		}
	}
}

export async function importConfigManagerFromYamlFile(
	filePath: string,
): Promise<ConfigImportResult> {
	const content = await readFile(filePath, 'utf8');
	const data = parseYamlConfig(content);
	const importedKeys: string[] = [];
	const skippedKeys = IMPORTABLE_KEYS.filter(key => !hasOwn(data, key));

	if (hasOwn(data, 'profiles')) {
		importProfiles(data['profiles']);
		importedKeys.push('profiles');
	}

	if (
		hasOwn(data, 'activeProfile') &&
		typeof data['activeProfile'] === 'string'
	) {
		setActiveProfileFromImport(data['activeProfile']);
		importedKeys.push('activeProfile');
	}

	if (hasOwn(data, 'systemPrompt')) {
		saveSystemPromptConfig(data['systemPrompt'] as SystemPromptConfig);
		importedKeys.push('systemPrompt');
	}

	if (hasOwn(data, 'customHeaders')) {
		saveCustomHeadersConfig(data['customHeaders'] as CustomHeadersConfig);
		importedKeys.push('customHeaders');
	}

	if (hasOwn(data, 'mcp')) {
		importMcp(data['mcp']);
		importedKeys.push('mcp');
	}

	if (hasOwn(data, 'proxy')) {
		saveProxyConfig(data['proxy'] as ProxyConfig);
		importedKeys.push('proxy');
	}

	if (hasOwn(data, 'codebase')) {
		importCodebase(data['codebase']);
		importedKeys.push('codebase');
	}

	if (hasOwn(data, 'subAgents')) {
		importSubAgents(data['subAgents']);
		importedKeys.push('subAgents');
	}

	if (hasOwn(data, 'sensitiveCommands')) {
		importSensitiveCommands(data['sensitiveCommands']);
		importedKeys.push('sensitiveCommands');
	}

	if (hasOwn(data, 'customCommands')) {
		await importCustomCommandsConfig(data['customCommands']);
		importedKeys.push('customCommands');
	}


	if (hasOwn(data, 'hooks')) {
		importHooks(data['hooks']);
		importedKeys.push('hooks');
	}

	if (hasOwn(data, 'language')) {
		saveLanguageConfig(data['language'] as ReturnType<typeof loadLanguageConfig>);
		importedKeys.push('language');
	}

	if (hasOwn(data, 'theme')) {
		saveThemeConfig(data['theme'] as ReturnType<typeof loadThemeConfig>);
		importedKeys.push('theme');
	}

	return {importedKeys, skippedKeys};
}
