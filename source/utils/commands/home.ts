import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {resetAnthropicClient} from '../../api/anthropic.js';
import {resetGeminiClient} from '../../api/gemini.js';
import {resetApiClient as resetChatClient} from '../../api/chat.js';
import {resetApiClient as resetResponseClient} from '../../api/responses.js';
import {clearConfigCache} from '../config/apiConfig.js';
import {logger} from '../core/logger.js';

const homeLog = logger.child('commands:home');

// Home command handler - returns to welcome screen
registerCommand('home', {
	execute: async (): Promise<CommandResult> => {
		// Stop codebase indexing if running (to avoid database errors)
		if ((global as any).__stopCodebaseIndexing) {
			try {
				// Show stopping message
				homeLog.info('Pausing codebase indexing...');
				await (global as any).__stopCodebaseIndexing();
				homeLog.info('Indexing paused, progress saved');
			} catch (error) {
				// Record error during stop
				homeLog.error('Failed to stop codebase indexing:', {error});
			}
		}

		// Clear all API configuration caches
		resetAnthropicClient();
		resetGeminiClient();
		resetChatClient();
		resetResponseClient();
		// Clear config cache to ensure fresh config when re-entering chat
		clearConfigCache();

		return {
			success: true,
			action: 'home',
			message: 'Returning to welcome screen',
		};
	},
});

export default {};
