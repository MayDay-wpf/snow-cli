import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

// Todo picker command handler - shows todo selection panel
registerCommand('todo-', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showTodoPicker',
			message: 'Showing TODO comment selection panel',
		};
	},
});

export default {};
