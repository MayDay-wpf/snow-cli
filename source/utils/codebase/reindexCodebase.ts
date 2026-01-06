import {
	CodebaseIndexAgent,
	type ProgressCallback,
} from '../../agents/codebaseIndexAgent.js';
import {loadCodebaseConfig} from '../config/codebaseConfig.js';
import {validateGitignore} from './gitignoreValidator.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Reindex codebase - Rebuild index and skip unchanged files based on hash
 * @param workingDirectory - The root directory to index
 * @param currentAgent - Current running agent (optional, will be stopped if provided)
 * @param progressCallback - Callback to report progress
 * @param force - If true, delete existing database and rebuild from scratch
 * @returns New CodebaseIndexAgent instance
 */
export async function reindexCodebase(
	workingDirectory: string,
	currentAgent: CodebaseIndexAgent | null,
	progressCallback?: ProgressCallback,
	force?: boolean,
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

	// If force flag is set, delete existing database
	if (force) {
		const dbPath = path.join(
			workingDirectory,
			'.snow',
			'codebase',
			'embeddings.db',
		);
		if (fs.existsSync(dbPath)) {
			fs.unlinkSync(dbPath);
		}
	}

	// Create new agent - will reuse existing database and skip unchanged files
	// The agent automatically checks file hashes and skips unchanged files during indexing
	// If force was used, database was deleted so all files will be reindexed
	const agent = new CodebaseIndexAgent(workingDirectory);

	// Start indexing with progress callback
	// Files with unchanged hashes will be skipped automatically (unless force was used)
	await agent.start(progressCallback);

	return agent;
}
