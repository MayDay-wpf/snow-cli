import { registerCommand, type CommandResult } from '../commandExecutor.js';

// Resume command handler
registerCommand('resume', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'resume',
			message: 'Opening session selection'
		};
	}
});

export default {};