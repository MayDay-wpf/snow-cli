import {getCurrentLanguage} from '../config/languageConfig.js';
import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';
import {translations} from '../../i18n/index.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.ultraTodo;
}

registerCommand('ultra-todo', {
	execute: (): CommandResult => {
		const messages = getMessages();

		return {
			success: true,
			action: 'toggleUltraTodo',
			message: messages.toggling,
		};
	},
});

export default {};
