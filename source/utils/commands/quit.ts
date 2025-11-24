import { registerCommand, type CommandResult } from '../commandExecutor.js';

// Quit command handler
registerCommand('quit', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'quit',
			message: 'Exiting Snow AI...',
		};
	},
});

// Also register 'exit' as an alias
registerCommand('exit', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'quit',
			message: 'Exiting Snow AI...',
		};
	},
});

export default {};
