import {registerCommand, type CommandResult} from '../commandExecutor.js';

// Quit command handler - exits the application cleanly
registerCommand('quit', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'quit',
			message: 'Exiting application...',
		};
	},
});

export default {};
