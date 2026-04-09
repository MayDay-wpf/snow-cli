import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

registerCommand('btw', {
	execute: (args?: string): CommandResult => {
		if (!args?.trim()) {
			return {
				success: false,
				message: 'Usage: /btw <your question>',
			};
		}
		return {
			success: true,
			action: 'btw',
			prompt: args.trim(),
		};
	},
});

export default {};
