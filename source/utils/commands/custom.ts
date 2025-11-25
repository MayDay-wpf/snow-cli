import {
	registerCommand,
	type CommandResult,
	getAvailableCommands,
} from '../execution/commandExecutor.js';
import {homedir} from 'os';
import {join} from 'path';
import {readdir, readFile, writeFile, mkdir} from 'fs/promises';
import {existsSync} from 'fs';

export interface CustomCommand {
	name: string;
	command: string;
	type: 'execute' | 'prompt'; // execute: run in terminal, prompt: send to AI
	description?: string;
}

const CUSTOM_COMMANDS_DIR = join(homedir(), '.snow', 'commands');

// Ensure custom commands directory exists
async function ensureCommandsDir(): Promise<void> {
	if (!existsSync(CUSTOM_COMMANDS_DIR)) {
		await mkdir(CUSTOM_COMMANDS_DIR, {recursive: true});
	}
}

// Load all custom commands
export async function loadCustomCommands(): Promise<CustomCommand[]> {
	try {
		await ensureCommandsDir();
		const files = await readdir(CUSTOM_COMMANDS_DIR);
		const jsonFiles = files.filter(f => f.endsWith('.json'));

		const commands: CustomCommand[] = [];
		for (const file of jsonFiles) {
			try {
				const content = await readFile(
					join(CUSTOM_COMMANDS_DIR, file),
					'utf-8',
				);
				const cmd = JSON.parse(content) as CustomCommand;
				commands.push(cmd);
			} catch (error) {
				// Skip invalid files
				console.error(`Failed to load custom command: ${file}`, error);
			}
		}
		return commands;
	} catch (error) {
		return [];
	}
}

// Check if command name conflicts with built-in or existing custom commands
export function isCommandNameConflict(name: string): boolean {
	const allCommands = getAvailableCommands();
	return allCommands.includes(name);
}

// Save a custom command
export async function saveCustomCommand(
	name: string,
	command: string,
	type: 'execute' | 'prompt',
	description?: string,
): Promise<void> {
	// Check for command name conflicts
	if (isCommandNameConflict(name)) {
		throw new Error(
			`Command name "${name}" conflicts with an existing built-in or custom command`,
		);
	}

	await ensureCommandsDir();
	const fileName = `${name}.json`;
	const filePath = join(CUSTOM_COMMANDS_DIR, fileName);
	const data: CustomCommand = {name, command, type, description};
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
export async function deleteCustomCommand(name: string): Promise<void> {
	const {unlink} = await import('fs/promises');
	const filePath = join(CUSTOM_COMMANDS_DIR, `${name}.json`);
	await unlink(filePath);
}

// Register dynamic custom commands
export async function registerCustomCommands(): Promise<void> {
	const customCommands = await loadCustomCommands();
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
						prompt: cmd.name, // Pass command name for deletion
					};
				}

				if (cmd.type === 'execute') {
					// Execute in terminal
					return {
						success: true,
						message: `Executing: ${cmd.command}`,
						action: 'executeTerminalCommand',
						prompt: cmd.command,
					};
				} else {
					// Send to AI
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
