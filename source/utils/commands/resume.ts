import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Resume command handler
// - /resume           => open session panel
// - /resume <id>      => load session directly by ID
registerCommand('resume', {
	execute: (args?: string): CommandResult => {
		const sessionId = args?.trim();

		if (sessionId) {
			return {
				success: true,
				action: 'resume',
				sessionId,
				message: `Resuming session ${sessionId}`,
			};
		}

		return {
			success: true,
			action: 'showSessionPanel',
			message: 'Opening session panel',
		};
	},
});

export default {};
