import {
	registerCommand,
	unregisterCommand,
	type CommandResult,
	getAvailableCommands,
} from '../execution/commandExecutor.js';
import {homedir} from 'os';
import {join} from 'path';
import {readdir, readFile, writeFile, mkdir} from 'fs/promises';
import {existsSync} from 'fs';

export type CommandLocation = 'global' | 'project';

export interface CustomCommand {
	name: string;
	command: string;
	type: 'execute' | 'prompt'; // execute: run in terminal, prompt: send to AI
	description?: string;
	location?: CommandLocation; // 新增，可选以兼容旧数据
}

// Get custom commands directory path
function getCustomCommandsDir(
	location: CommandLocation,
	projectRoot?: string,
): string {
	if (location === 'global') {
		return join(homedir(), '.snow', 'commands');
	} else {
		const root = projectRoot || process.cwd();
		return join(root, '.snow', 'commands');
	}
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

// Load commands from a specific directory
async function loadCommandsFromDir(
	dir: string,
	defaultLocation: CommandLocation,
): Promise<CustomCommand[]> {
	const commands: CustomCommand[] = [];
	if (!existsSync(dir)) {
		return commands;
	}

	try {
		const files = await readdir(dir);
		const jsonFiles = files.filter(f => f.endsWith('.json'));

		for (const file of jsonFiles) {
			try {
				const content = await readFile(join(dir, file), 'utf-8');
				const cmd = JSON.parse(content) as CustomCommand;
				// Fill default location for backward compatibility
				if (!cmd.location) {
					cmd.location = defaultLocation;
				}
				commands.push(cmd);
			} catch (error) {
				console.error(`Failed to load custom command: ${file}`, error);
			}
		}
	} catch (error) {
		// Directory read failed, return empty
	}

	return commands;
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
	const filePath = join(dir, `${name}.json`);
	return existsSync(filePath);
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
	const fileName = `${name}.json`;
	const filePath = join(dir, fileName);
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
	const {unlink} = await import('fs/promises');
	const dir = getCustomCommandsDir(location, projectRoot);
	const filePath = join(dir, `${name}.json`);
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
					return {
						success: true,
						message: `Executing: ${cmd.command}`,
						action: 'executeTerminalCommand',
						prompt: cmd.command,
					};
				} else {
					return {
						success: true,
						message: `Sending to AI: ${cmd.command}`,
						action: 'executeCustomCommand',
						prompt: cmd.command,
					};
				}
			},
		});
	}
}

export default {};
