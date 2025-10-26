import {registerCommand, type CommandResult} from '../commandExecutor.js';
import {resetAnthropicClient} from '../../api/anthropic.js';
import {resetGeminiClient} from '../../api/gemini.js';
import {resetOpenAIClient as resetChatClient} from '../../api/chat.js';
import {resetOpenAIClient as resetResponseClient} from '../../api/responses.js';

// Home command handler - returns to welcome screen
registerCommand('home', {
	execute: (): CommandResult => {
		// Clear all API configuration caches
		resetAnthropicClient();
		resetGeminiClient();
		resetChatClient();
		resetResponseClient();

		return {
			success: true,
			action: 'home',
			message: 'Returning to welcome screen',
		};
	},
});

export default {};
