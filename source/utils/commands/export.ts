import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.export;
}

// Export command handler - exports chat conversation to text file
registerCommand('export', {
	execute: (): CommandResult => {
		const messages = getMessages();
		return {
			success: true,
			action: 'exportChat',
			message: messages.exporting,
		};
	},
});

export default {};
