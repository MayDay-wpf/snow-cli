import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Worktree command handler - Open Git branch management panel
registerCommand('worktree', {
	execute: (): CommandResult => ({
		success: true,
		action: 'showBranchPanel',
	}),
});

export default {};
