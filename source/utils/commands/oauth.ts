import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// OAuth command handler - opens the OAuth sign-in panel (4 subscription login methods)
registerCommand('oauth', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showOAuthPanel',
			message: 'Opening OAuth sign-in panel',
		};
	},
});

export default {};
