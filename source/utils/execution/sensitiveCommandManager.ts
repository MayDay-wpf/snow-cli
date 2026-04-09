import {homedir} from 'os';
import {join} from 'path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';

const GLOBAL_CONFIG_DIR = join(homedir(), '.snow');
const GLOBAL_SENSITIVE_FILE = join(GLOBAL_CONFIG_DIR, 'sensitive-commands.json');

export type SensitiveCommandScope = 'global' | 'project';

export interface SensitiveCommand {
	id: string;
	pattern: string;
	description: string;
	enabled: boolean;
	isPreset: boolean;
	scope: SensitiveCommandScope;
}

interface StoredSensitiveCommand {
	id: string;
	pattern: string;
	description: string;
	enabled: boolean;
	isPreset: boolean;
}

export interface SensitiveCommandsConfig {
	commands: StoredSensitiveCommand[];
}

/**
 * 预设的常见敏感指令
 */
export const PRESET_SENSITIVE_COMMANDS: StoredSensitiveCommand[] = [
	{
		id: 'rm',
		pattern: 'rm ',
		description: 'Delete files or directories (rm, rm -rf, etc.)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'rmdir',
		pattern: 'rmdir ',
		description: 'Remove directories',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'unlink',
		pattern: 'unlink ',
		description: 'Delete files using unlink command',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'mv-to-trash',
		pattern: 'mv * /tmp',
		description: 'Move files to trash/tmp (potential data loss)',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'chmod',
		pattern: 'chmod ',
		description: 'Change file permissions',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'chown',
		pattern: 'chown ',
		description: 'Change file ownership',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'dd',
		pattern: 'dd ',
		description: 'Low-level data copy (disk operations)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'mkfs',
		pattern: 'mkfs',
		description: 'Format filesystem',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'fdisk',
		pattern: 'fdisk ',
		description: 'Disk partition manipulation',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'killall',
		pattern: 'killall ',
		description: 'Kill all processes by name',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'pkill',
		pattern: 'pkill ',
		description: 'Kill processes by pattern',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'reboot',
		pattern: 'reboot',
		description: 'Reboot the system',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'shutdown',
		pattern: 'shutdown ',
		description: 'Shutdown the system',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'sudo',
		pattern: 'sudo ',
		description: 'Execute commands with superuser privileges',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'su',
		pattern: 'su ',
		description: 'Switch user',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'curl-post',
		pattern: 'curl*-X POST',
		description: 'HTTP POST requests (potential data transmission)',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'wget',
		pattern: 'wget ',
		description: 'Download files from internet',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'git-push',
		pattern: 'git push',
		description: 'Push code to remote repository',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'git-force-push',
		pattern: 'git push*--force',
		description: 'Force push to remote repository (destructive)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'git-force-push-short',
		pattern: 'git push*-f ',
		description: 'Force push to remote repository with -f flag (destructive)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'git-reset-hard',
		pattern: 'git reset*--hard',
		description: 'Hard reset git repository (destructive)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'git-clean',
		pattern: 'git clean*-f',
		description: 'Remove untracked files from git repository',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'git-revert',
		pattern: 'git revert',
		description: 'Revert git commits',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'git-reset',
		pattern: 'git reset ',
		description: 'Reset git repository state',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'npm-publish',
		pattern: 'npm publish',
		description: 'Publish package to npm registry',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'docker-rm',
		pattern: 'docker rm',
		description: 'Remove Docker containers',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'docker-rmi',
		pattern: 'docker rmi',
		description: 'Remove Docker images',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'powershell-remove-item',
		pattern: 'Remove-Item ',
		description: 'PowerShell delete files or directories',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'powershell-remove-item-recurse',
		pattern: 'Remove-Item*-Recurse',
		description: 'PowerShell recursive delete (destructive)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'format-volume',
		pattern: 'Format-Volume',
		description: 'Format disk volume (destructive)',
		enabled: true,
		isPreset: true,
	},
];

function getProjectConfigDir(): string {
	return join(process.cwd(), '.snow');
}

function getProjectConfigPath(): string {
	return join(getProjectConfigDir(), 'sensitive-commands.json');
}

function ensureDirectory(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
}

function loadScopedConfig(scope: SensitiveCommandScope): SensitiveCommandsConfig {
	const dir = scope === 'project' ? getProjectConfigDir() : GLOBAL_CONFIG_DIR;
	const file = scope === 'project' ? getProjectConfigPath() : GLOBAL_SENSITIVE_FILE;

	ensureDirectory(dir);

	if (!existsSync(file)) {
		if (scope === 'global') {
			const defaultConfig: SensitiveCommandsConfig = {
				commands: [...PRESET_SENSITIVE_COMMANDS],
			};
			saveScopedConfig('global', defaultConfig);
			return defaultConfig;
		}
		return {commands: []};
	}

	try {
		const configData = readFileSync(file, 'utf8');
		const config = JSON.parse(configData) as SensitiveCommandsConfig;

		if (scope === 'global') {
			const existingIds = new Set(config.commands.map(cmd => cmd.id));
			const newPresets = PRESET_SENSITIVE_COMMANDS.filter(
				preset => !existingIds.has(preset.id),
			);

			if (newPresets.length > 0) {
				config.commands = [...config.commands, ...newPresets];
				saveScopedConfig('global', config);
			}
		}

		return config;
	} catch {
		if (scope === 'global') {
			return {commands: [...PRESET_SENSITIVE_COMMANDS]};
		}
		return {commands: []};
	}
}

function saveScopedConfig(
	scope: SensitiveCommandScope,
	config: SensitiveCommandsConfig,
): void {
	const dir = scope === 'project' ? getProjectConfigDir() : GLOBAL_CONFIG_DIR;
	const file = scope === 'project' ? getProjectConfigPath() : GLOBAL_SENSITIVE_FILE;

	ensureDirectory(dir);

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(file, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save sensitive commands config: ${error}`);
	}
}

/**
 * Load sensitive commands configuration (global scope, backward compatible)
 */
export function loadSensitiveCommands(): SensitiveCommandsConfig {
	return loadScopedConfig('global');
}

/**
 * Save sensitive commands configuration (global scope, backward compatible)
 */
export function saveSensitiveCommands(config: SensitiveCommandsConfig): void {
	saveScopedConfig('global', config);
}

/**
 * Check if a pattern already exists in any scope
 */
export function isDuplicatePattern(
	pattern: string,
): {isDuplicate: boolean; existingScope?: SensitiveCommandScope} {
	const allCommands = getAllSensitiveCommands();
	const duplicate = allCommands.find(
		cmd => cmd.pattern.trim() === pattern.trim(),
	);
	if (duplicate) {
		return {isDuplicate: true, existingScope: duplicate.scope};
	}
	return {isDuplicate: false};
}

/**
 * Add a custom sensitive command
 */
export function addSensitiveCommand(
	pattern: string,
	description: string,
	scope: SensitiveCommandScope = 'global',
): void {
	const {isDuplicate, existingScope} = isDuplicatePattern(pattern);
	if (isDuplicate) {
		throw new Error(`DUPLICATE:${existingScope}`);
	}

	const config = loadScopedConfig(scope);

	const id = `custom-${Date.now()}-${Math.random()
		.toString(36)
		.substring(2, 9)}`;

	config.commands.push({
		id,
		pattern,
		description,
		enabled: true,
		isPreset: false,
	});

	saveScopedConfig(scope, config);
}

/**
 * Remove a sensitive command
 */
export function removeSensitiveCommand(
	id: string,
	scope?: SensitiveCommandScope,
): void {
	if (scope) {
		const config = loadScopedConfig(scope);
		config.commands = config.commands.filter(cmd => cmd.id !== id);
		saveScopedConfig(scope, config);
	} else {
		for (const s of ['global', 'project'] as const) {
			const config = loadScopedConfig(s);
			const before = config.commands.length;
			config.commands = config.commands.filter(cmd => cmd.id !== id);
			if (config.commands.length < before) {
				saveScopedConfig(s, config);
				return;
			}
		}
	}
}

/**
 * Update a sensitive command
 */
export function updateSensitiveCommand(
	id: string,
	updates: Partial<Omit<SensitiveCommand, 'id' | 'isPreset' | 'scope'>>,
	scope?: SensitiveCommandScope,
): void {
	const scopesToSearch: SensitiveCommandScope[] = scope
		? [scope]
		: ['global', 'project'];

	for (const s of scopesToSearch) {
		const config = loadScopedConfig(s);
		const commandIndex = config.commands.findIndex(cmd => cmd.id === id);

		if (commandIndex !== -1) {
			const existingCommand = config.commands[commandIndex]!;
			config.commands[commandIndex] = {
				...existingCommand,
				...updates,
				id: existingCommand.id,
				isPreset: existingCommand.isPreset,
			};
			saveScopedConfig(s, config);
			return;
		}
	}

	throw new Error(`Sensitive command with id "${id}" not found`);
}

/**
 * Toggle a sensitive command enabled state
 */
export function toggleSensitiveCommand(
	id: string,
	scope?: SensitiveCommandScope,
): void {
	const scopesToSearch: SensitiveCommandScope[] = scope
		? [scope]
		: ['global', 'project'];

	for (const s of scopesToSearch) {
		const config = loadScopedConfig(s);
		const command = config.commands.find(cmd => cmd.id === id);

		if (command) {
			command.enabled = !command.enabled;
			saveScopedConfig(s, config);
			return;
		}
	}

	throw new Error(`Sensitive command with id "${id}" not found`);
}

/**
 * 将通配符模式转换为正则表达式
 * 支持 * 通配符
 */
function patternToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*');

	return new RegExp(`(^|[;&|\\n])\\s*${escaped}`, 'i');
}

/**
 * 分割组合命令为单个命令
 * 支持 ; && || | 等分隔符
 */
function splitCommand(command: string): string[] {
	const cleanCommand = command.trim().replace(/\s+/g, ' ');
	const parts = cleanCommand.split(/\s*(?:;|&&|\|\||\||\n)\s*/);
	return parts.filter(part => part.trim().length > 0);
}

/**
 * Check if a command matches any enabled sensitive pattern
 */
export function isSensitiveCommand(command: string): {
	isSensitive: boolean;
	matchedCommand?: SensitiveCommand;
} {
	const allCommands = getAllSensitiveCommands();
	const enabledCommands = allCommands.filter(cmd => cmd.enabled);

	const commandParts = splitCommand(command);

	for (const part of commandParts) {
		const trimmedPart = part.trim();

		for (const cmd of enabledCommands) {
			const regex = patternToRegex(cmd.pattern);
			if (regex.test(`\n${trimmedPart}`) || regex.test(trimmedPart)) {
				return {isSensitive: true, matchedCommand: cmd};
			}
		}
	}

	return {isSensitive: false};
}

/**
 * Get all sensitive commands (merged from global + project, no priority)
 */
export function getAllSensitiveCommands(): SensitiveCommand[] {
	const globalConfig = loadScopedConfig('global');
	const projectConfig = loadScopedConfig('project');

	const globalCommands: SensitiveCommand[] = globalConfig.commands.map(
		cmd => ({
			...cmd,
			scope: 'global' as const,
		}),
	);
	const projectCommands: SensitiveCommand[] = projectConfig.commands.map(
		cmd => ({
			...cmd,
			scope: 'project' as const,
		}),
	);

	return [...globalCommands, ...projectCommands];
}

/**
 * Reset to default preset commands
 * If scope is provided, only reset that scope;
 * otherwise reset both.
 */
export function resetToDefaults(scope?: SensitiveCommandScope): void {
	if (!scope || scope === 'global') {
		saveScopedConfig('global', {commands: [...PRESET_SENSITIVE_COMMANDS]});
	}
	if (!scope || scope === 'project') {
		saveScopedConfig('project', {commands: []});
	}
}
