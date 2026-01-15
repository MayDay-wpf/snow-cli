import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Help command handler - show keyboard shortcuts and help information
registerCommand('help', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'help',
		};
	},
});

export default {};
