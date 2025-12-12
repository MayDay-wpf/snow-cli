import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';
import {addWorkingDirectory} from '../config/workingDirConfig.js';

// Add directory command handler
registerCommand('add-dir', {
	execute: async (args?: string): Promise<CommandResult> => {
		// If no args provided, show the panel
		if (!args || args.trim() === '') {
			return {
				success: true,
				action: 'showWorkingDirPanel',
			};
		}

		// If args provided, try to add the directory
		const dirPath = args.trim();
		const added = await addWorkingDirectory(dirPath);

		if (added) {
			return {
				success: true,
				message: `Working directory added: ${dirPath}`,
			};
		} else {
			return {
				success: false,
				message: `Failed to add directory: ${dirPath} (already exists or invalid path)`,
			};
		}
	},
});

export default {};
