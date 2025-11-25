import { registerCommand, type CommandResult } from '../execution/commandExecutor.js';

// Resume command handler - shows session panel instead of navigating to new page
registerCommand('resume', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showSessionPanel',
			message: 'Opening session panel'
		};
	}
});

export default {};