import { registerCommand, type CommandResult } from '../commandExecutor.js';

// Compact command handler - compress conversation history
registerCommand('compact', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'compact',
			message: 'Compressing conversation history...'
		};
	}
});

export default {};
