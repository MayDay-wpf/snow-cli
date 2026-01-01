import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

// Profiles command handler - opens profile switching panel (same as shortcut)
registerCommand('profiles', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showProfilePanel',
			message: 'Opening profile switching panel',
		};
	},
});

export default {};
