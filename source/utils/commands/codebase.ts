import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	loadCodebaseConfig,
	isCodebaseEnabled,
} from '../config/codebaseConfig.js';
import {CodebaseIndexAgent} from '../../agents/codebaseIndexAgent.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.codebase;
}

// Codebase command handler - Toggle codebase indexing for current project
// Usage:
//   /codebase        - Toggle codebase on/off
//   /codebase on     - Enable codebase
//   /codebase off    - Disable codebase
//   /codebase status - Show current status
registerCommand('codebase', {
	execute: async (args?: string): Promise<CommandResult> => {
		const trimmedArgs = args?.trim().toLowerCase();
		const messages = getMessages();

		// Check if embedding is configured
		const config = loadCodebaseConfig();
		const hasEmbeddingConfig =
			config.embedding.baseUrl && config.embedding.apiKey;

		if (trimmedArgs === 'status') {
			const enabled = isCodebaseEnabled();
			if (!hasEmbeddingConfig) {
				return {
					success: true,
					message: messages.notConfigured,
				};
			}
			const statusLabel = enabled
				? messages.enabledLabel
				: messages.disabledLabel;
			try {
				const agent = new CodebaseIndexAgent(process.cwd());
				const fileCount = await agent.countFiles();
				const fileWord =
					fileCount === 1 ? messages.fileSingular : messages.filePlural;
				return {
					success: true,
					message: messages.statusWithFiles
						.replace('{status}', statusLabel)
						.replace('{count}', String(fileCount))
						.replace('{fileWord}', fileWord),
				};
			} catch {
				return {
					success: true,
					message: messages.status.replace('{status}', statusLabel),
				};
			}
		}

		if (trimmedArgs === 'on') {
			if (!hasEmbeddingConfig) {
				return {
					success: false,
					message: messages.cannotEnable,
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
				message: messages.cannotEnable,
			};
		}

		return {
			success: true,
			action: 'toggleCodebase',
		};
	},
});

export default {};
