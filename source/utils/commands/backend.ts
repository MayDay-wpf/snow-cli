import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Backend command handler - shows backend processes panel
registerCommand('backend', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showBackgroundPanel',
			message: 'Showing backend processes',
		};
	},
});

export default {};
