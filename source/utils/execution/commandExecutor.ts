export interface CommandResult {
	success: boolean;
	message?: string;
	action?:
		| 'clear'
		| 'resume'
		| 'info'
		| 'showMcpInfo'
		| 'toggleYolo'
		| 'togglePlan'
		| 'initProject'
		| 'compact'
		| 'showSessionPanel'
		| 'showMcpPanel'
		| 'showUsagePanel'
		| 'showWorkingDirPanel'
		| 'home'
		| 'review'
		| 'exportChat'
		| 'showAgentPicker'
		| 'showTodoPicker'
		| 'showHelpPanel'
		| 'showCustomCommandConfig'
		| 'executeCustomCommand'
		| 'executeTerminalCommand'
		| 'deleteCustomCommand'
		| 'showSkillsCreation'
		| 'reindexCodebase'
		| 'quit';
	prompt?: string;
	alreadyConnected?: boolean; // For /ide command to indicate if VSCode is already connected
}

export interface CommandHandler {
	execute: (args?: string) => Promise<CommandResult> | CommandResult;
}

const commandHandlers: Record<string, CommandHandler> = {};

export function registerCommand(name: string, handler: CommandHandler): void {
	commandHandlers[name] = handler;
}

export async function executeCommand(
	commandName: string,
	args?: string,
): Promise<CommandResult> {
	const handler = commandHandlers[commandName];

	if (!handler) {
		return {
			success: false,
			message: `Unknown command: ${commandName}`,
		};
	}

	try {
		const result = await handler.execute(args);
		return result;
	} catch (error) {
		return {
			success: false,
			message:
				error instanceof Error ? error.message : 'Command execution failed',
		};
	}
}
export function unregisterCommand(name: string): void {
	delete commandHandlers[name];
}

export function getAvailableCommands(): string[] {
	return Object.keys(commandHandlers);
}
