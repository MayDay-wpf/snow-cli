import { registerCommand, type CommandResult } from '../commandExecutor.js';

// Home command handler - returns to welcome screen
registerCommand('home', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'home',
			message: 'Returning to welcome screen'
		};
	}
});

export default {};
