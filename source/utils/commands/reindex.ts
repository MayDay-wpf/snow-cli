import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {loadCodebaseConfig} from '../config/codebaseConfig.js';

// Reindex command handler - Rebuild codebase index
registerCommand('reindex', {
	execute: (): CommandResult => {
		// Check if codebase is enabled
		const config = loadCodebaseConfig();

		if (!config.enabled) {
			return {
				success: false,
				message:
					'Codebase indexing is disabled. Please enable it in settings first.',
			};
		}

		return {
			success: true,
			action: 'reindexCodebase',
		};
	},
});

export default {};
