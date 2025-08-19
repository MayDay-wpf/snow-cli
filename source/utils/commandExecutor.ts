export interface CommandResult {
	success: boolean;
	message?: string;
	action?: 'clear' | 'info';
}

export interface CommandHandler {
	execute: () => Promise<CommandResult> | CommandResult;
}

const commandHandlers: Record<string, CommandHandler> = {};

export function registerCommand(name: string, handler: CommandHandler): void {
	commandHandlers[name] = handler;
}

export async function executeCommand(commandName: string): Promise<CommandResult> {
	const handler = commandHandlers[commandName];
	
	if (!handler) {
		return {
			success: false,
			message: `Unknown command: ${commandName}`
		};
	}

	try {
		const result = await handler.execute();
		return result;
	} catch (error) {
		return {
			success: false,
			message: error instanceof Error ? error.message : 'Command execution failed'
		};
	}
}

export function getAvailableCommands(): string[] {
	return Object.keys(commandHandlers);
}