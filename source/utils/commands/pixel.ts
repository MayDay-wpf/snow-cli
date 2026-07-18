import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Pixel editor command handler - open the terminal pixel editor
registerCommand('pixel', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'pixel',
		};
	},
});

export default {};
