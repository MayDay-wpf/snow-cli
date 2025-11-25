import { registerCommand, type CommandResult } from '../execution/commandExecutor.js';

// Usage command handler - shows usage statistics panel
registerCommand('usage', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showUsagePanel',
			message: 'Showing usage statistics'
		};
	}
});

export default {};
