import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {loadCodebaseConfig} from '../config/codebaseConfig.js';

// Reindex command handler - Rebuild codebase index
// Supports -force flag to delete existing database and rebuild from scratch
registerCommand('reindex', {
	execute: (args?: string): CommandResult => {
		// Check if codebase is enabled
		const config = loadCodebaseConfig();

		if (!config.enabled) {
			return {
				success: false,
				message:
					'Codebase indexing is disabled. Please enable it in settings first.',
			};
		}

		// Parse -force flag
		const forceReindex = args?.includes('-force') ?? false;

		return {
			success: true,
			action: 'reindexCodebase',
			forceReindex,
		};
	},
});

export default {};
