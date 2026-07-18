import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

registerCommand('branch', {
	execute: (args?: string): CommandResult => {
		const branchName = args?.trim() || undefined;
		return {
			success: true,
			action: 'forkSession',
			prompt: branchName,
		};
	},
});

export default {};
