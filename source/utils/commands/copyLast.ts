import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Copy last command handler - copies the last AI assistant message to clipboard
registerCommand('copy-last', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'copyLastMessage',
		};
	},
});

export default {};
