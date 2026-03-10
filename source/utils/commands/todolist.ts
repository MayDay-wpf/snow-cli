import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

registerCommand('todolist', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showTodoListPanel',
			message: 'Showing current session TODO list',
		};
	},
});

export default {};
