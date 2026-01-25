import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

// Skills picker command handler - shows skills selection panel
registerCommand('skills-', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showSkillsPicker',
			message: 'Showing skills selection panel',
		};
	},
});

export default {};
