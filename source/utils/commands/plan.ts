import { registerCommand, type CommandResult } from '../execution/commandExecutor.js';

// Plan command handler - toggles plan mode
registerCommand('plan', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'togglePlan',
			message: 'Toggling Plan mode'
		};
	}
});

export default {};
