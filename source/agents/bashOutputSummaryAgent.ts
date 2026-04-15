import {getOpenAiConfig} from '../utils/config/apiConfig.js';
import {logger} from '../utils/core/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {RequestMethod} from '../utils/config/apiConfig.js';
import type {CommandExecutionResult} from '../mcp/types/bash.types.js';

/**
 * Bash output summarization agent.
 * Uses basicModel and follows the same request routing as the main flow.
 */
export class BashOutputSummaryAgent {
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private initialized: boolean = false;

	private async initialize(): Promise<boolean> {
		try {
			const config = getOpenAiConfig();
			if (!config.basicModel) {
				return false;
			}

			this.modelName = config.basicModel;
			this.requestMethod = config.requestMethod;
			this.initialized = true;
			return true;
		} catch (error) {
			logger.warn('Bash output summary agent: initialize failed', error);
			return false;
		}
	}

	clearCache(): void {
		this.initialized = false;
		this.modelName = '';
		this.requestMethod = 'chat';
	}

	async isAvailable(): Promise<boolean> {
		if (!this.initialized) {
			return this.initialize();
		}
		return true;
	}

	private async callModel(
		messages: ChatMessage[],
		abortSignal?: AbortSignal,
	): Promise<string> {
		let streamGenerator: AsyncGenerator<any, void, unknown>;

		switch (this.requestMethod) {
			case 'anthropic':
				streamGenerator = createStreamingAnthropicCompletion(
					{
						model: this.modelName,
						messages,
						max_tokens: 1200,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
					},
					abortSignal,
				);
				break;
			case 'gemini':
				streamGenerator = createStreamingGeminiCompletion(
					{
						model: this.modelName,
						messages,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
					},
					abortSignal,
				);
				break;
			case 'responses':
				streamGenerator = createStreamingResponse(
					{
						model: this.modelName,
						messages,
						stream: true,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
					},
					abortSignal,
				);
				break;
			case 'chat':
			default:
				streamGenerator = createStreamingChatCompletion(
					{
						model: this.modelName,
						messages,
						stream: true,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
					},
					abortSignal,
				);
				break;
		}

		let content = '';
		for await (const chunk of streamGenerator) {
			if (abortSignal?.aborted) {
				throw new Error('Request aborted');
			}

			if (this.requestMethod === 'chat') {
				if (chunk.choices && chunk.choices[0]?.delta?.content) {
					content += chunk.choices[0].delta.content;
				}
			} else if (chunk.type === 'content' && chunk.content) {
				content += chunk.content;
			}
		}

		return content.trim();
	}

	async summarizeCommandResult(
		commandResult: CommandExecutionResult,
		abortSignal?: AbortSignal,
	): Promise<CommandExecutionResult> {
		const available = await this.isAvailable();
		if (!available) {
			return commandResult;
		}

		try {
			const prompt = `You are a terminal output compression assistant.
Your goal is to compress noisy command output into useful, actionable information for another AI agent.

Requirements:
1) Keep factual correctness. Do not invent outputs.
2) Error-first policy: always report errors before warnings, even if warning volume is much higher.
3) If any errors exist, list all unique errors with exact lines/snippets and likely impact first.
4) Prioritize actionable next steps, key artifacts/paths, and final status after errors/warnings.
5) Remove repetitive logs, progress bars, and low-value noise.
6) Keep language concise and structured.
7) Preserve important command snippets and exact error lines when needed.
8) Output plain text only.

Command: ${commandResult.command}
Exit code: ${commandResult.exitCode}
Executed at: ${commandResult.executedAt}

STDOUT:
${commandResult.stdout || '(empty)'}

STDERR:
${commandResult.stderr || '(empty)'}

Now produce the compressed terminal result:`;

			const messages: ChatMessage[] = [{role: 'user', content: prompt}];
			const summary = await this.callModel(messages, abortSignal);

			if (!summary) {
				return commandResult;
			}

			return {
				...commandResult,
				stdout: summary,
				stderr: '',
			};
		} catch (error) {
			logger.warn(
				'Bash output summary agent: summarize failed, fallback to original output',
				error,
			);
			return commandResult;
		}
	}
}

export const bashOutputSummaryAgent = new BashOutputSummaryAgent();
