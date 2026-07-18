import { registerCommand, type CommandResult } from '../execution/commandExecutor.js';

registerCommand('image-compress', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'toggleImageCompress',
			message: 'Toggling Image Compress mode'
		};
	}
});

export default {};
