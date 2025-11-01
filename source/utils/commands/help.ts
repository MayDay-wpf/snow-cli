import {registerCommand, type CommandResult} from '../commandExecutor.js';

// Help command handler - show keyboard shortcuts and help information
registerCommand('help', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showHelpPanel',
		};
	},
});

export default {};
