import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

// Interrupt command handler
// /cut <message> - Interrupt the AI mid-response and immediately send the user's message.
// The AI's incomplete response is saved with a hardcoded "user interrupted" marker,
// then the user message is queued as a pending message to be sent after the interrupt cleanup.
registerCommand('cut', {
	execute: async (args?: string): Promise<CommandResult> => {
		const userMessage = args?.trim();
		if (!userMessage) {
			const lang = getCurrentLanguage();
			const usage =
				translations[lang]?.commandPanel?.commandOutput?.cut?.usage ||
				'Usage: /cut <message>';
			return {
				success: false,
				message: usage,
			};
		}
		return {
			success: true,
			action: 'interruptAndSend',
			prompt: userMessage,
		};
	},
});

export default {};
