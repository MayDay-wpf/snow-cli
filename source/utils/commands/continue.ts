import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';
import {pauseGate} from '../execution/pauseGate.js';

// Continue command handler
// /continue - Resume the AI loop after a /pause. The blocked loop iteration
// proceeds immediately.
registerCommand('continue', {
	execute: async (): Promise<CommandResult> => {
		if (!pauseGate.paused) {
			return {
				success: false,
				message: 'AI loop is not paused',
			};
		}
		pauseGate.resume();
		return {
			success: true,
			action: 'resume',
		};
	},
});

export default {};
