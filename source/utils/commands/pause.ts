import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';
import {pauseGate} from '../execution/pauseGate.js';

// Pause command handler
// /pause - Pause the AI loop. The AI finishes its current round, then blocks
// at the next loop iteration until the user runs /resume or presses ESC.
registerCommand('pause', {
	execute: async (): Promise<CommandResult> => {
		if (pauseGate.paused) {
			return {
				success: false,
				message: 'AI loop is already paused',
			};
		}
		pauseGate.pause();
		return {
			success: true,
			action: 'pause',
		};
	},
});

export default {};
