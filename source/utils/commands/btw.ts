import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.btw;
}

registerCommand('btw', {
	execute: (args?: string): CommandResult => {
		const messages = getMessages();
		if (!args?.trim()) {
			return {
				success: false,
				message: messages.usage,
			};
		}
		return {
			success: true,
			action: 'btw',
			prompt: args.trim(),
		};
	},
});

export default {};
