import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.config;
}

registerCommand('config', {
	execute: (args?: string): CommandResult => {
		const normalizedArgs = (args ?? '').trim().toLowerCase();
		const messages = getMessages();

		if (normalizedArgs === 'export') {
			return {
				success: true,
				action: 'exportConfig',
				message: messages.exporting,
			};
		}

		if (normalizedArgs === 'import') {
			return {
				success: true,
				action: 'importConfig',
				message: messages.importing,
			};
		}

		return {
			success: false,
			message: messages.usage,
		};
	},
});

export default {};
