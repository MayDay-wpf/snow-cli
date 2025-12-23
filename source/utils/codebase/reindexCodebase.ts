import {
	CodebaseIndexAgent,
	type ProgressCallback,
} from '../../agents/codebaseIndexAgent.js';
import {loadCodebaseConfig} from '../config/codebaseConfig.js';
import {validateGitignore} from './gitignoreValidator.js';

/**
 * Reindex codebase - Rebuild index and skip unchanged files based on hash
 * @param workingDirectory - The root directory to index
 * @param currentAgent - Current running agent (optional, will be stopped if provided)
 * @param progressCallback - Callback to report progress
 * @returns New CodebaseIndexAgent instance
 */
export async function reindexCodebase(
	workingDirectory: string,
	currentAgent: CodebaseIndexAgent | null,
	progressCallback?: ProgressCallback,
): Promise<CodebaseIndexAgent> {
	const config = loadCodebaseConfig();

	if (!config.enabled) {
		throw new Error('Codebase indexing is not enabled');
	}

	// Check if .gitignore exists
	const validation = validateGitignore(workingDirectory);
	if (!validation.isValid) {
		// Notify via progress callback if provided
		if (progressCallback) {
			progressCallback({
				totalFiles: 0,
				processedFiles: 0,
				totalChunks: 0,
				currentFile: '',
				status: 'error',
				error: validation.error,
			});
		}

		throw new Error(validation.error);
	}

	// Stop current agent if running
	if (currentAgent) {
		await currentAgent.stop();
		currentAgent.stopWatching();
		currentAgent.close();
	}

	// Create new agent - will reuse existing database and skip unchanged files
	// The agent automatically checks file hashes and skips unchanged files during indexing
	const agent = new CodebaseIndexAgent(workingDirectory);

	// Start indexing with progress callback
	// Files with unchanged hashes will be skipped automatically
	await agent.start(progressCallback);

	return agent;
}
