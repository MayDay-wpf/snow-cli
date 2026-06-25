import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Games command handler - open the games panel
registerCommand('games', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showGamesPanel',
		};
	},
});

export default {};
