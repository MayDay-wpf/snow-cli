import {getOpenAiConfig, getCustomSystemPrompt} from '../utils/config/apiConfig.js';
import {logger} from '../utils/core/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {RequestMethod} from '../utils/config/apiConfig.js';
import {execSync} from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class ReviewAgent {
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private initialized: boolean = false;

	/**
	 * Initialize the review agent with current configuration
	 * Uses advanced model (same as main flow)
	 */
	private async initialize(): Promise<boolean> {
		try {
			const config = getOpenAiConfig();

			if (!config.advancedModel) {
				return false;
			}

			this.modelName = config.advancedModel;
			this.requestMethod = config.requestMethod;
			this.initialized = true;

			return true;
		} catch (error) {
			logger.warn('Failed to initialize review agent:', error);
			return false;
		}
	}

	/**
	 * Check if review agent is available
	 */
	async isAvailable(): Promise<boolean> {
		if (!this.initialized) {
			return await this.initialize();
		}
		return true;
	}

	/**
	 * Check if current directory or any parent directory is a git repository
	 * @param startDir - Starting directory to check
	 * @returns Path to git root directory, or null if not found
	 */
	private findGitRoot(startDir: string): string | null {
		let currentDir = path.resolve(startDir);
		const root = path.parse(currentDir).root;

		while (currentDir !== root) {
			const gitDir = path.join(currentDir, '.git');
			if (fs.existsSync(gitDir)) {
				return currentDir;
			}
			currentDir = path.dirname(currentDir);
		}

		return null;
	}

	/**
	 * Check if git is available and current directory is in a git repository
	 * @returns Object with isGitRepo flag and optional error message
	 */
	checkGitRepository(): {isGitRepo: boolean; gitRoot?: string; error?: string} {
		try {
			// Check if git command is available
			try {
				execSync('git --version', {stdio: 'ignore'});
			} catch {
				return {
					isGitRepo: false,
					error: 'Git is not installed or not available in PATH',
				};
			}

			// Find git root directory (check current and parent directories)
			const gitRoot = this.findGitRoot(process.cwd());

			if (!gitRoot) {
				return {
					isGitRepo: false,
					error:
						'Current directory is not in a git repository. Please run this command from within a git repository.',
				};
			}

			return {isGitRepo: true, gitRoot};
		} catch (error) {
			return {
				isGitRepo: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to check git repository',
			};
		}
	}

	/**
	 * Get git diff for uncommitted changes
	 * @param gitRoot - Git repository root directory
	 * @returns Git diff output
	 */
	getGitDiff(gitRoot: string): string {
		try {
			// Get staged changes
			const stagedDiff = execSync('git diff --cached', {
				cwd: gitRoot,
				encoding: 'utf-8',
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			});

			// Get unstaged changes
			const unstagedDiff = execSync('git diff', {
				cwd: gitRoot,
				encoding: 'utf-8',
				maxBuffer: 10 * 1024 * 1024,
			});

			// Combine both diffs
			let combinedDiff = '';
			if (stagedDiff) {
				combinedDiff += '# Staged Changes\n\n' + stagedDiff + '\n\n';
			}
			if (unstagedDiff) {
				combinedDiff += '# Unstaged Changes\n\n' + unstagedDiff;
			}

			if (!combinedDiff) {
				return 'No changes detected in the repository.';
			}

			return combinedDiff;
		} catch (error) {
			logger.error('Failed to get git diff:', error);
			throw new Error(
				'Failed to get git changes: ' +
					(error instanceof Error ? error.message : 'Unknown error'),
			);
		}
	}

	/**
	 * Generate code review prompt
	 */
	private generateReviewPrompt(gitDiff: string): string {
		return `You are a senior code reviewer. Please review the following git changes and provide feedback.

**Your task:**
1. Identify potential bugs, security issues, or logic errors
2. Suggest performance optimizations
3. Point out code quality issues (readability, maintainability)
4. Check for best practices violations
5. Highlight any breaking changes or compatibility issues

**Important:**
- DO NOT modify the code yourself
- Focus on finding issues and suggesting improvements
- Ask the user if they want to fix any issues you find
- Be constructive and specific in your feedback
- Prioritize critical issues over minor style preferences

**Git Changes:**

\`\`\`diff
${gitDiff}
\`\`\`

Please provide your review in a clear, structured format.`;
	}

	/**
	 * Call the advanced model with streaming (same routing as main flow)
	 */
	private async *callAdvancedModel(
		messages: ChatMessage[],
		abortSignal?: AbortSignal,
	): AsyncGenerator<any, void, unknown> {
		const config = getOpenAiConfig();

		if (!config.advancedModel) {
			throw new Error('Advanced model not configured');
		}

		// Get custom system prompt if configured
		const customSystemPrompt = getCustomSystemPrompt();

		// If custom system prompt exists, prepend it to messages
		let processedMessages = messages;
		if (customSystemPrompt) {
			processedMessages = [
				{
					role: 'system',
					content: customSystemPrompt,
				},
				...messages,
			];
		}

		// Route to appropriate streaming API based on request method
		switch (this.requestMethod) {
			case 'anthropic':
				yield* createStreamingAnthropicCompletion(
					{
						model: this.modelName,
						messages: processedMessages,
						max_tokens: 4096,
						disableThinking: true, // Agents 不使用 Extended Thinking
					},
					abortSignal,
				);
				break;

			case 'gemini':
				yield* createStreamingGeminiCompletion(
					{
						model: this.modelName,
						messages: processedMessages,
					},
					abortSignal,
				);
				break;

			case 'responses':
				yield* createStreamingResponse(
					{
						model: this.modelName,
						messages: processedMessages,
						stream: true,
					},
					abortSignal,
				);
				break;

			case 'chat':
			default:
				yield* createStreamingChatCompletion(
					{
						model: this.modelName,
						messages: processedMessages,
						stream: true,
					},
					abortSignal,
				);
				break;
		}
	}

	/**
	 * Review git changes and return streaming generator
	 * @param abortSignal - Optional abort signal
	 * @returns Async generator for streaming response
	 */
	async *reviewChanges(
		abortSignal?: AbortSignal,
	): AsyncGenerator<any, void, unknown> {
		const available = await this.isAvailable();
		if (!available) {
			throw new Error('Review agent is not available');
		}

		// Check git repository
		const gitCheck = this.checkGitRepository();
		if (!gitCheck.isGitRepo) {
			throw new Error(gitCheck.error || 'Not a git repository');
		}

		// Get git diff
		const gitDiff = this.getGitDiff(gitCheck.gitRoot!);

		if (gitDiff === 'No changes detected in the repository.') {
			throw new Error(
				'No changes detected. Please make some changes before running code review.',
			);
		}

		// Generate review prompt
		const reviewPrompt = this.generateReviewPrompt(gitDiff);

		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: reviewPrompt,
			},
		];

		// Stream the response
		yield* this.callAdvancedModel(messages, abortSignal);
	}
}

// Export singleton instance
export const reviewAgent = new ReviewAgent();
