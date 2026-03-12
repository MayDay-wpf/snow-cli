import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

// Git line command handler - shows git commit selection panel
registerCommand('gitline', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showGitLinePicker',
			message: 'Showing git commit selection panel',
		};
	},
});

export default {};
