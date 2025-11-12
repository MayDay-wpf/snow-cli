import {registerCommand, type CommandResult} from '../commandExecutor.js';

// Agent picker command handler - shows agent selection panel
registerCommand('agent-', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showAgentPicker',
			message: 'Showing sub-agent selection panel',
		};
	},
});

export default {};
