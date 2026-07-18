import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Context breakdown panel — system / ROLE / AGENTS / hooks / tools / messages
registerCommand('context', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showContextPanel',
			message: 'Showing context breakdown',
		};
	},
});

export default {};
