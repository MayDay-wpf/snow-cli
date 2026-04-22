import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

registerCommand('ide', {
	execute: async (): Promise<CommandResult> => {
		return {
			success: true,
			action: 'showIdeSelectPanel',
		};
	},
});

export default {};
