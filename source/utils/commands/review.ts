import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
// Review command handler - pick commits and review
registerCommand('review', {
	execute: async (): Promise<CommandResult> => {
		return {
			success: true,
			action: 'showReviewCommitPanel',
			message: 'Select commits to review',
		};
	},
});

export default {};
