import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

// Permissions command handler - opens permissions panel to manage always-approved tools
registerCommand('permissions', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showPermissionsPanel',
			message: 'Opening permissions panel',
		};
	},
});

export default {};
