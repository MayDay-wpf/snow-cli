import { registerCommand, type CommandResult } from '../execution/commandExecutor.js';

registerCommand('diff', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showDiffReviewPanel',
			message: 'Opening diff review panel'
		};
	}
});

export default {};
