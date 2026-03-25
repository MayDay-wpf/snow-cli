import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

registerCommand('team', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'toggleTeam',
			message: 'Toggling Team mode',
		};
	},
});

export default {};
