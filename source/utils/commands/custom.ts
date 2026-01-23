import {
	registerCommand,
	unregisterCommand,
	type CommandResult,
	getAvailableCommands,
} from '../execution/commandExecutor.js';
import {homedir} from 'os';
import {dirname, join} from 'path';
import {readdir, readFile, writeFile, mkdir, unlink} from 'fs/promises';
import {existsSync} from 'fs';

export type CommandLocation = 'global' | 'project';

export interface CustomCommand {
	name: string;
	command: string;
	type: 'execute' | 'prompt'; // execute: run in terminal, prompt: send to AI
	description?: string;
	location?: CommandLocation; // 新增，可选以兼容旧数据
}

type CommandFileEntry = {
	filePath: string;
	inferredCommandName: string;
};

function isValidSlashCommandName(name: string): boolean {
	const trimmed = name.trim();
	if (trimmed.length === 0) return false;
	if (trimmed === '.' || trimmed === '..') return false;
	// Do not allow whitespace or path separators in the command part
	return !/[\s\\/:]/.test(trimmed);
}

function parseNamespacedCommandName(name: string): {
	namespacePath: string | null;
	commandName: string;
} {
	const trimmed = name.trim();
	if (!trimmed.includes(':')) {
		return {namespacePath: null, commandName: trimmed};
	}

	const colonIndex = trimmed.indexOf(':');
	const namespacePath = trimmed.slice(0, colonIndex).trim();
	const commandName = trimmed.slice(colonIndex + 1).trim();

	return {
		namespacePath: namespacePath.length > 0 ? namespacePath : null,
		commandName,
	};
}

function assertValidNamespacePath(namespacePath: string): string[] {
	const segments = namespacePath
		.split('/')
		.map(s => s.trim())
		.filter(Boolean);

	for (const segment of segments) {
		if (segment === '.' || segment === '..') {
			throw new Error(`Invalid namespace path: "${namespacePath}"`);
		}

		// Prevent Windows path separator injection
		if (segment.includes('\\')) {
			throw new Error(`Invalid namespace path: "${namespacePath}"`);
		}

		// ':' is reserved for separator between folder and command
		if (segment.includes(':')) {
			throw new Error(`Invalid namespace path: "${namespacePath}"`);
		}
	}

	return segments;
}

function getCommandJsonFilePath(commandsDir: string, name: string): string {
	const {namespacePath, commandName} = parseNamespacedCommandName(name);

	if (!isValidSlashCommandName(commandName)) {
		throw new Error(`Invalid command name: "${name}"`);
	}

	if (!namespacePath) {
		return join(commandsDir, `${commandName}.json`);
	}

	const segments = assertValidNamespacePath(namespacePath);
	return join(commandsDir, ...segments, `${commandName}.json`);
}

async function listJsonCommandsRecursively(
	dir: string,
	prefixPath: string,
): Promise<CommandFileEntry[]> {
	if (!existsSync(dir)) {
		return [];
	}

	let entries: Array<import('fs').Dirent> = [];
	try {
		entries = await readdir(dir, {withFileTypes: true});
	} catch {
		return [];
	}

	// Stable ordering: directories first, then files
	entries.sort((a, b) => {
		if (a.isDirectory() && !b.isDirectory()) return -1;
		if (!a.isDirectory() && b.isDirectory()) return 1;
		return a.name.localeCompare(b.name);
	});

	const results: CommandFileEntry[] = [];

	for (const entry of entries) {
		const entryPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			const childPrefix = prefixPath
				? `${prefixPath}/${entry.name}`
				: entry.name;
			results.push(
				...(await listJsonCommandsRecursively(entryPath, childPrefix)),
			);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (!entry.name.toLowerCase().endsWith('.json')) {
			continue;
		}

		const baseName = entry.name.slice(0, -'.json'.length);
		const inferredCommandName = prefixPath
			? `${prefixPath}:${baseName}`
			: baseName;

		results.push({
			filePath: entryPath,
			inferredCommandName,
		});
	}

	return results;
}

async function loadCustomCommandFromFile(
	entry: CommandFileEntry,
	defaultLocation: CommandLocation,
): Promise<CustomCommand | null> {
	try {
		const content = await readFile(entry.filePath, 'utf-8');
		const cmd = JSON.parse(content) as CustomCommand;

		// Use file path to infer command name for stability and namespace support
		cmd.name = entry.inferredCommandName;
		cmd.description = cmd.description || cmd.command;

		// Fill default location for backward compatibility
		if (!cmd.location) {
			cmd.location = defaultLocation;
		}

		return cmd;
	} catch (error) {
		console.error(`Failed to load custom command: ${entry.filePath}`, error);
		return null;
	}
}

// Load commands from a specific directory (supports subfolders)
async function loadCommandsFromDir(
	dir: string,
	defaultLocation: CommandLocation,
): Promise<CustomCommand[]> {
	const commands: CustomCommand[] = [];
	const entries = await listJsonCommandsRecursively(dir, '');
	const seenNames = new Set<string>();

	for (const entry of entries) {
		const cmd = await loadCustomCommandFromFile(entry, defaultLocation);
		if (!cmd) {
			continue;
		}

		if (seenNames.has(cmd.name)) {
			// Keep first match for deterministic behavior
			continue;
		}

		seenNames.add(cmd.name);
		commands.push(cmd);
	}

	return commands;
}

// Get custom commands directory path
function getCustomCommandsDir(
	location: CommandLocation,
	projectRoot?: string,
): string {
	if (location === 'global') {
		return join(homedir(), '.snow', 'commands');
	}

	const root = projectRoot || process.cwd();
	return join(root, '.snow', 'commands');
}

// Ensure custom commands directory exists
async function ensureCommandsDir(
	location: CommandLocation = 'global',
	projectRoot?: string,
): Promise<void> {
	const dir = getCustomCommandsDir(location, projectRoot);
	if (!existsSync(dir)) {
		await mkdir(dir, {recursive: true});
	}
}

// Load all custom commands (project commands override global ones with same name)
export async function loadCustomCommands(
	projectRoot?: string,
): Promise<CustomCommand[]> {
	const commands: CustomCommand[] = [];
	const seen = new Set<string>();

	// Load project commands first (if projectRoot provided)
	if (projectRoot) {
		const projectDir = getCustomCommandsDir('project', projectRoot);
		const projectCmds = await loadCommandsFromDir(projectDir, 'project');
		for (const cmd of projectCmds) {
			commands.push(cmd);
			seen.add(cmd.name);
		}
	}

	// Load global commands (skip if same name already loaded from project)
	const globalDir = getCustomCommandsDir('global');
	const globalCmds = await loadCommandsFromDir(globalDir, 'global');
	for (const cmd of globalCmds) {
		if (!seen.has(cmd.name)) {
			commands.push(cmd);
		}
	}

	return commands;
}

// Check if command name conflicts with built-in or existing custom commands
export function isCommandNameConflict(name: string): boolean {
	const allCommands = getAvailableCommands();
	return allCommands.includes(name);
}

// Check if command exists in specified location
export function checkCommandExists(
	name: string,
	location: CommandLocation,
	projectRoot?: string,
): boolean {
	const dir = getCustomCommandsDir(location, projectRoot);
	try {
		const filePath = getCommandJsonFilePath(dir, name);
		return existsSync(filePath);
	} catch {
		return false;
	}
}

// Save a custom command
export async function saveCustomCommand(
	name: string,
	command: string,
	type: 'execute' | 'prompt',
	description?: string,
	location: CommandLocation = 'global',
	projectRoot?: string,
): Promise<void> {
	// Check for command name conflicts with built-in commands
	if (isCommandNameConflict(name)) {
		throw new Error(
			`Command name "${name}" conflicts with an existing built-in or custom command`,
		);
	}

	await ensureCommandsDir(location, projectRoot);
	const dir = getCustomCommandsDir(location, projectRoot);
	const filePath = getCommandJsonFilePath(dir, name);

	// Ensure parent directory exists (for namespaced commands)
	await mkdir(dirname(filePath), {recursive: true});

	const data: CustomCommand = {name, command, type, description, location};
	await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Register custom command handler
registerCommand('custom', {
	execute: async (): Promise<CommandResult> => {
		return {
			success: true,
			action: 'showCustomCommandConfig',
		};
	},
});

// Get all custom commands (for display in command panel)
export function getCustomCommands(): CustomCommand[] {
	// This will be populated by registerCustomCommands
	return customCommandsCache;
}

// Cache for custom commands
let customCommandsCache: CustomCommand[] = [];

// Delete a custom command
export async function deleteCustomCommand(
	name: string,
	location: CommandLocation = 'global',
	projectRoot?: string,
): Promise<void> {
	const dir = getCustomCommandsDir(location, projectRoot);
	const filePath = getCommandJsonFilePath(dir, name);

	await unlink(filePath);

	// Unregister the command from command executor
	unregisterCommand(name);

	// Update cache
	customCommandsCache = customCommandsCache.filter(cmd => cmd.name !== name);
}

// Register dynamic custom commands
export async function registerCustomCommands(
	projectRoot?: string,
): Promise<void> {
	const customCommands = await loadCustomCommands(projectRoot);
	customCommandsCache = customCommands;

	for (const cmd of customCommands) {
		registerCommand(cmd.name, {
			execute: async (args?: string): Promise<CommandResult> => {
				// Check for -d flag to delete command
				if (args?.trim() === '-d') {
					return {
						success: true,
						action: 'deleteCustomCommand',
						message: `Delete custom command: ${cmd.name}`,
						prompt: cmd.name,
						location: cmd.location,
					};
				}

				if (cmd.type === 'execute') {
					// 支持补充输入：将args叠加到命令后面
					const finalCommand = args ? `${cmd.command} ${args}` : cmd.command;
					return {
						success: true,
						message: `Executing: ${finalCommand}`,
						action: 'executeTerminalCommand',
						prompt: finalCommand,
					};
				}

				// 支持补充输入：将args叠加到prompt后面
				const finalPrompt = args ? `${cmd.command} ${args}` : cmd.command;
				return {
					success: true,
					message: `Sending to AI: ${finalPrompt}`,
					action: 'executeCustomCommand',
					prompt: finalPrompt,
				};
			},
		});
	}
}

export default {};
