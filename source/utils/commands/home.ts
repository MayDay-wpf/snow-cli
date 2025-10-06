import { registerCommand, type CommandResult } from '../commandExecutor.js';

// Home command handler - navigates back to welcome screen
registerCommand('home', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'goHome',
			message: 'Returning to welcome screen'
		};
	}
});

export default {};
