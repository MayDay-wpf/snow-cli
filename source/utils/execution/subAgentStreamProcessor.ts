import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingChatCompletion} from '../../api/chat.js';
import {
	shouldCompressSubAgentContext,
	getContextPercentage,
	compressSubAgentContext,
	countMessagesTokens,
} from '../core/subAgentContextCompressor.js';
import {emitSubAgentMessage} from './subAgentTypes.js';
import type {SubAgentExecutionContext} from './subAgentTypes.js';
import type {ChatMessage} from '../../api/chat.js';
import type {MCPTool} from './mcpToolsManager.js';

export interface StreamProcessResult {
	currentContent: string;
	toolCalls: any[];
	hasError: boolean;
	errorMessage: string;
}

export function createApiStream(
	config: any,
	model: string,
	messages: ChatMessage[],
	allowedTools: MCPTool[],
	sessionId: string | undefined,
	configProfile: string | undefined,
	abortSignal?: AbortSignal,
): AsyncIterable<any> {
	if (config.requestMethod === 'anthropic') {
		return createStreamingAnthropicCompletion(
			{
				model,
				messages,
				temperature: 0,
				max_tokens: config.maxTokens || 4096,
				tools: allowedTools,
				sessionId,
				configProfile,
			},
			abortSignal,
		);
	}
	if (config.requestMethod === 'gemini') {
		return createStreamingGeminiCompletion(
			{
				model,
				messages,
				temperature: 0,
				tools: allowedTools,
				configProfile,
			},
			abortSignal,
		);
	}
	if (config.requestMethod === 'responses') {
		return createStreamingResponse(
			{
				model,
				messages,
				temperature: 0,
				tools: allowedTools,
				prompt_cache_key: sessionId,
				configProfile,
			},
			abortSignal,
		);
	}
	return createStreamingChatCompletion(
		{
			model,
			messages,
			temperature: 0,
			tools: allowedTools,
			configProfile,
		},
		abortSignal,
	);
}

export async function processStreamEvents(
	ctx: SubAgentExecutionContext,
	stream: AsyncIterable<any>,
	config: any,
): Promise<StreamProcessResult> {
	let currentContent = '';
	let toolCalls: any[] = [];
	let currentThinking:
		| {type: 'thinking'; thinking: string; signature?: string}
		| undefined;
	let currentReasoningContent: string | undefined;
	let currentReasoning:
		| {
				summary?: Array<{type: 'summary_text'; text: string}>;
				content?: any;
				encrypted_content?: string;
		  }
		| undefined;

	for await (const event of stream) {
		emitSubAgentMessage(ctx, event);

		if (event.type === 'usage' && event.usage) {
			handleUsageEvent(ctx, event.usage, config);
		}

		if (event.type === 'content' && event.content) {
			currentContent += event.content;
		} else if (event.type === 'tool_calls' && event.tool_calls) {
			toolCalls = event.tool_calls;
		} else if (event.type === 'reasoning_data' && 'reasoning' in event) {
			currentReasoning = event.reasoning as typeof currentReasoning;
		} else if (event.type === 'done') {
			if ('thinking' in event && event.thinking) {
				currentThinking = event.thinking as {
					type: 'thinking';
					thinking: string;
					signature?: string;
				};
			}
			if ('reasoning_content' in event && event.reasoning_content) {
				currentReasoningContent = event.reasoning_content as string;
			}
		}
	}

	// Add assistant response to conversation
	if (currentContent || toolCalls.length > 0) {
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: currentContent || '',
		};

		if (currentThinking) {
			assistantMessage.thinking = currentThinking;
		}
		if (currentReasoningContent) {
			(assistantMessage as any).reasoning_content = currentReasoningContent;
		}
		if (currentReasoning) {
			(assistantMessage as any).reasoning = currentReasoning;
		}
		if (toolCalls.length > 0) {
			assistantMessage.tool_calls = toolCalls;
		}

		ctx.messages.push(assistantMessage);
		ctx.finalResponse = currentContent;
	}

	// Fallback: count tokens with tiktoken when API doesn't return usage
	if (ctx.latestTotalTokens === 0 && config.maxContextTokens) {
		ctx.latestTotalTokens = countMessagesTokens(ctx.messages);

		if (ctx.latestTotalTokens > 0) {
			const ctxPct = getContextPercentage(
				ctx.latestTotalTokens,
				config.maxContextTokens,
			);
			emitSubAgentMessage(ctx, {
				type: 'context_usage',
				percentage: Math.max(1, Math.round(ctxPct)),
				inputTokens: ctx.latestTotalTokens,
				maxTokens: config.maxContextTokens,
			});
		}
	}

	return {
		currentContent,
		toolCalls,
		hasError: false,
		errorMessage: '',
	};
}

function handleUsageEvent(
	ctx: SubAgentExecutionContext,
	eventUsage: any,
	config: any,
): void {
	ctx.latestTotalTokens =
		eventUsage.total_tokens ||
		(eventUsage.prompt_tokens || 0) + (eventUsage.completion_tokens || 0);

	if (!ctx.totalUsage) {
		ctx.totalUsage = {
			inputTokens: eventUsage.prompt_tokens || 0,
			outputTokens: eventUsage.completion_tokens || 0,
			cacheCreationInputTokens: eventUsage.cache_creation_input_tokens,
			cacheReadInputTokens: eventUsage.cache_read_input_tokens,
		};
	} else {
		ctx.totalUsage.inputTokens += eventUsage.prompt_tokens || 0;
		ctx.totalUsage.outputTokens += eventUsage.completion_tokens || 0;
		if (eventUsage.cache_creation_input_tokens) {
			ctx.totalUsage.cacheCreationInputTokens =
				(ctx.totalUsage.cacheCreationInputTokens || 0) +
				eventUsage.cache_creation_input_tokens;
		}
		if (eventUsage.cache_read_input_tokens) {
			ctx.totalUsage.cacheReadInputTokens =
				(ctx.totalUsage.cacheReadInputTokens || 0) +
				eventUsage.cache_read_input_tokens;
		}
	}

	if (config.maxContextTokens && ctx.latestTotalTokens > 0) {
		const ctxPct = getContextPercentage(
			ctx.latestTotalTokens,
			config.maxContextTokens,
		);
		emitSubAgentMessage(ctx, {
			type: 'context_usage',
			percentage: Math.max(1, Math.round(ctxPct)),
			inputTokens: ctx.latestTotalTokens,
			maxTokens: config.maxContextTokens,
		});
	}
}

export async function handleContextCompression(
	ctx: SubAgentExecutionContext,
	config: any,
	model: string,
): Promise<boolean> {
	if (ctx.latestTotalTokens <= 0 || !config.maxContextTokens) {
		return false;
	}

	if (
		!shouldCompressSubAgentContext(
			ctx.latestTotalTokens,
			config.maxContextTokens,
		)
	) {
		return false;
	}

	const ctxPercentage = getContextPercentage(
		ctx.latestTotalTokens,
		config.maxContextTokens,
	);

	emitSubAgentMessage(ctx, {
		type: 'context_compressing',
		percentage: Math.round(ctxPercentage),
	});

	try {
		const compressionResult = await compressSubAgentContext(
			ctx.messages,
			ctx.latestTotalTokens,
			config.maxContextTokens,
			{
				model,
				requestMethod: config.requestMethod,
				maxTokens: config.maxTokens,
				configProfile: ctx.agent.configProfile,
			},
		);

		if (compressionResult.compressed) {
			ctx.messages.length = 0;
			ctx.messages.push(...compressionResult.messages);

			if (compressionResult.afterTokensEstimate) {
				ctx.latestTotalTokens = compressionResult.afterTokensEstimate;
			}

			emitSubAgentMessage(ctx, {
				type: 'context_compressed',
				beforeTokens: compressionResult.beforeTokens,
				afterTokensEstimate: compressionResult.afterTokensEstimate,
			});

			console.log(
				`[SubAgent:${ctx.agent.name}] Context compressed: ` +
					`${compressionResult.beforeTokens} → ~${compressionResult.afterTokensEstimate} tokens`,
			);

			return true;
		}
	} catch (compressError) {
		console.error(
			`[SubAgent:${ctx.agent.name}] Context compression failed:`,
			compressError,
		);
	}

	return false;
}
