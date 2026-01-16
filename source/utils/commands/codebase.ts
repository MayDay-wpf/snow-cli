import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	loadCodebaseConfig,
	isCodebaseEnabled,
} from '../config/codebaseConfig.js';

// Codebase command handler - Toggle codebase indexing for current project
// Usage:
//   /codebase        - Toggle codebase on/off
//   /codebase on     - Enable codebase
//   /codebase off    - Disable codebase
//   /codebase status - Show current status
registerCommand('codebase', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();

		// Check if embedding is configured
		const config = loadCodebaseConfig();
		const hasEmbeddingConfig =
			config.embedding.baseUrl && config.embedding.apiKey;

		if (trimmedArgs === 'status') {
			const enabled = isCodebaseEnabled();
			if (!hasEmbeddingConfig) {
				return {
					success: true,
					message:
						'Codebase: Not configured. Please configure embedding settings in /home first.',
				};
			}
			return {
				success: true,
				message: `Codebase: ${
					enabled ? 'Enabled' : 'Disabled'
				} for this project`,
			};
		}

		if (trimmedArgs === 'on') {
			if (!hasEmbeddingConfig) {
				return {
					success: false,
					message:
						'Cannot enable codebase: Embedding settings not configured. Please configure in /home first.',
				};
			}
			return {
				success: true,
				action: 'toggleCodebase',
				prompt: 'on',
			};
		}

		if (trimmedArgs === 'off') {
			return {
				success: true,
				action: 'toggleCodebase',
				prompt: 'off',
			};
		}

		// Default: toggle
		if (!hasEmbeddingConfig) {
			return {
				success: false,
				message:
					'Cannot enable codebase: Embedding settings not configured. Please configure in /home first.',
			};
		}

		return {
			success: true,
			action: 'toggleCodebase',
		};
	},
});

export default {};
