import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

// Models command handler - opens model switching panel
registerCommand('models', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showModelsPanel',
			message: 'Opening model switching panel',
		};
	},
});

export default {};
