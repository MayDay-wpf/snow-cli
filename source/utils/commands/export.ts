import { registerCommand, type CommandResult } from '../commandExecutor.js';

// Export command handler - exports chat conversation to text file
registerCommand('export', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'exportChat',
			message: 'Exporting conversation...'
		};
	}
});

export default {};
