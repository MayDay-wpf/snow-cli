import { registerCommand, type CommandResult } from '../execution/commandExecutor.js';

registerCommand('tool-search', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'toggleToolSearch',
			message: 'Toggling Tool Search mode'
		};
	}
});

export default {};
