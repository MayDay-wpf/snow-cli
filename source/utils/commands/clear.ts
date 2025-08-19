import { registerCommand, type CommandResult } from '../commandExecutor.js';

// Clear command handler
registerCommand('clear', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'clear',
			message: 'Chat context cleared'
		};
	}
});

export default {};