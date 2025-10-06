import { registerCommand, type CommandResult } from '../commandExecutor.js';

// YOLO command handler - toggles unattended mode
registerCommand('yolo', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'toggleYolo',
			message: 'Toggling YOLO mode'
		};
	}
});

export default {};
