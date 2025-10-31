import {homedir} from 'os';
import {join} from 'path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';

const CONFIG_DIR = join(homedir(), '.snow');
const SENSITIVE_COMMANDS_FILE = join(CONFIG_DIR, 'sensitive-commands.json');

export interface SensitiveCommand {
	id: string;
	pattern: string; // 支持通配符，如 "rm*" 匹配所有 rm 开头的命令
	description: string;
	enabled: boolean;
	isPreset: boolean; // 是否为预设命令
}

export interface SensitiveCommandsConfig {
	commands: SensitiveCommand[];
}

/**
 * 预设的常见敏感指令
 */
export const PRESET_SENSITIVE_COMMANDS: SensitiveCommand[] = [
	{
		id: 'rm',
		pattern: 'rm*',
		description: 'Delete files or directories (rm, rm -rf, etc.)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'rmdir',
		pattern: 'rmdir*',
		description: 'Remove directories',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'mv-to-trash',
		pattern: 'mv * /tmp*',
		description: 'Move files to trash/tmp (potential data loss)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'chmod',
		pattern: 'chmod*',
		description: 'Change file permissions',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'chown',
		pattern: 'chown*',
		description: 'Change file ownership',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'dd',
		pattern: 'dd*',
		description: 'Low-level data copy (disk operations)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'mkfs',
		pattern: 'mkfs*',
		description: 'Format filesystem',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'fdisk',
		pattern: 'fdisk*',
		description: 'Disk partition manipulation',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'killall',
		pattern: 'killall*',
		description: 'Kill all processes by name',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'pkill',
		pattern: 'pkill*',
		description: 'Kill processes by pattern',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'reboot',
		pattern: 'reboot*',
		description: 'Reboot the system',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'shutdown',
		pattern: 'shutdown*',
		description: 'Shutdown the system',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'sudo',
		pattern: 'sudo*',
		description: 'Execute commands with superuser privileges',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'su',
		pattern: 'su*',
		description: 'Switch user',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'curl-post',
		pattern: 'curl*-X POST*',
		description: 'HTTP POST requests (potential data transmission)',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'wget',
		pattern: 'wget*',
		description: 'Download files from internet',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'git-push',
		pattern: 'git push*',
		description: 'Push code to remote repository',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'git-force-push',
		pattern: 'git push*--force*',
		description: 'Force push to remote repository (destructive)',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'npm-publish',
		pattern: 'npm publish*',
		description: 'Publish package to npm registry',
		enabled: true,
		isPreset: true,
	},
	{
		id: 'docker-rm',
		pattern: 'docker rm*',
		description: 'Remove Docker containers',
		enabled: false,
		isPreset: true,
	},
	{
		id: 'docker-rmi',
		pattern: 'docker rmi*',
		description: 'Remove Docker images',
		enabled: false,
		isPreset: true,
	},
];

/**
 * Ensure config directory exists
 */
function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

/**
 * Load sensitive commands configuration
 */
export function loadSensitiveCommands(): SensitiveCommandsConfig {
	ensureConfigDirectory();

	if (!existsSync(SENSITIVE_COMMANDS_FILE)) {
		// 首次加载，使用预设配置
		const defaultConfig: SensitiveCommandsConfig = {
			commands: [...PRESET_SENSITIVE_COMMANDS],
		};
		saveSensitiveCommands(defaultConfig);
		return defaultConfig;
	}

	try {
		const configData = readFileSync(SENSITIVE_COMMANDS_FILE, 'utf8');
		const config = JSON.parse(configData) as SensitiveCommandsConfig;

		// 合并预设命令（处理新增的预设命令）
		const existingIds = new Set(config.commands.map(cmd => cmd.id));
		const newPresets = PRESET_SENSITIVE_COMMANDS.filter(
			preset => !existingIds.has(preset.id),
		);

		if (newPresets.length > 0) {
			config.commands = [...config.commands, ...newPresets];
			saveSensitiveCommands(config);
		}

		return config;
	} catch (error) {
		console.error('Failed to load sensitive commands config:', error);
		return {commands: [...PRESET_SENSITIVE_COMMANDS]};
	}
}

/**
 * Save sensitive commands configuration
 */
export function saveSensitiveCommands(config: SensitiveCommandsConfig): void {
	ensureConfigDirectory();

	try {
		const configData = JSON.stringify(config, null, 2);
		writeFileSync(SENSITIVE_COMMANDS_FILE, configData, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save sensitive commands config: ${error}`);
	}
}

/**
 * Add a custom sensitive command
 */
export function addSensitiveCommand(
	pattern: string,
	description: string,
): void {
	const config = loadSensitiveCommands();

	// 生成唯一ID
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

	saveSensitiveCommands(config);
}

/**
 * Remove a sensitive command
 */
export function removeSensitiveCommand(id: string): void {
	const config = loadSensitiveCommands();
	config.commands = config.commands.filter(cmd => cmd.id !== id);
	saveSensitiveCommands(config);
}

/**
 * Update a sensitive command
 */
export function updateSensitiveCommand(
	id: string,
	updates: Partial<Omit<SensitiveCommand, 'id' | 'isPreset'>>,
): void {
	const config = loadSensitiveCommands();
	const commandIndex = config.commands.findIndex(cmd => cmd.id === id);

	if (commandIndex === -1) {
		throw new Error(`Sensitive command with id "${id}" not found`);
	}

	const existingCommand = config.commands[commandIndex]!;
	config.commands[commandIndex] = {
		...existingCommand,
		...updates,
		id: existingCommand.id,
		isPreset: existingCommand.isPreset,
	};

	saveSensitiveCommands(config);
}

/**
 * Toggle a sensitive command enabled state
 */
export function toggleSensitiveCommand(id: string): void {
	const config = loadSensitiveCommands();
	const command = config.commands.find(cmd => cmd.id === id);

	if (!command) {
		throw new Error(`Sensitive command with id "${id}" not found`);
	}

	command.enabled = !command.enabled;
	saveSensitiveCommands(config);
}

/**
 * 将通配符模式转换为正则表达式
 * 支持 * 通配符
 */
function patternToRegex(pattern: string): RegExp {
	// 转义特殊字符，除了 * 和空格
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*');

	// 使用 ^ 和 $ 确保完整匹配，但允许参数
	return new RegExp(`^${escaped}`, 'i');
}

/**
 * Check if a command matches any enabled sensitive pattern
 */
export function isSensitiveCommand(command: string): {
	isSensitive: boolean;
	matchedCommand?: SensitiveCommand;
} {
	const config = loadSensitiveCommands();
	const enabledCommands = config.commands.filter(cmd => cmd.enabled);

	// 清理命令，移除多余的空格
	const cleanCommand = command.trim().replace(/\s+/g, ' ');

	for (const cmd of enabledCommands) {
		const regex = patternToRegex(cmd.pattern);
		if (regex.test(cleanCommand)) {
			return {isSensitive: true, matchedCommand: cmd};
		}
	}

	return {isSensitive: false};
}

/**
 * Get all sensitive commands
 */
export function getAllSensitiveCommands(): SensitiveCommand[] {
	const config = loadSensitiveCommands();
	return config.commands;
}

/**
 * Reset to default preset commands
 */
export function resetToDefaults(): void {
	const config: SensitiveCommandsConfig = {
		commands: [...PRESET_SENSITIVE_COMMANDS],
	};
	saveSensitiveCommands(config);
}
