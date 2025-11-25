import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';
import {resetAnthropicClient} from '../../api/anthropic.js';
import {resetGeminiClient} from '../../api/gemini.js';
import {resetOpenAIClient as resetChatClient} from '../../api/chat.js';
import {resetOpenAIClient as resetResponseClient} from '../../api/responses.js';

// Home command handler - returns to welcome screen
registerCommand('home', {
	execute: async (): Promise<CommandResult> => {
		// Stop codebase indexing if running (to avoid database errors)
		if ((global as any).__stopCodebaseIndexing) {
			try {
				// Show stopping message
				console.log('\n⏸  Pausing codebase indexing...');
				await (global as any).__stopCodebaseIndexing();
				console.log('✓ Indexing paused, progress saved\n');
			} catch (error) {
				// Ignore errors during stop
				console.error('Failed to stop codebase indexing:', error);
			}
		}

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
