import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Delete current session command handler
registerCommand('del-session', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'deleteCurrentSession',
			message: 'Deleting current session',
		};
	},
});

export default {};
