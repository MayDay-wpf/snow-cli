import Anthropic from '@anthropic-ai/sdk';
import { createHash, randomUUID } from 'crypto';
import { getOpenAiConfig, getCustomSystemPrompt } from '../utils/apiConfig.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { withRetryGenerator } from '../utils/retryUtils.js';
import type { ChatMessage } from './chat.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface AnthropicOptions {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	max_tokens?: number;
	tools?: ChatCompletionTool[];
	sessionId?: string; // Session ID for user tracking and caching
}

export interface UsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cache_creation_input_tokens?: number; // Tokens used to create cache (first time)
	cache_read_input_tokens?: number; // Tokens read from cache (cache hit)
}

export interface AnthropicStreamChunk {
	type: 'content' | 'tool_calls' | 'tool_call_delta' | 'done' | 'usage';
	content?: string;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
	delta?: string;
	usage?: UsageInfo;
}

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
	if (!anthropicClient) {
		const config = getOpenAiConfig();

		if (!config.apiKey) {
			throw new Error('Anthropic API configuration is incomplete. Please configure API key first.');
		}

		const clientConfig: any = {
			apiKey: config.apiKey,
		};

		// Support custom baseUrl for proxy servers
		if (config.baseUrl && config.baseUrl !== 'https://api.openai.com/v1') {
			clientConfig.baseURL = config.baseUrl;
		}

		// Configure headers for prompt caching support
		// Prompt caching is available by default in API version 2024-09-24+
		// No need for beta flag - it's a standard feature now
		clientConfig.defaultHeaders = {
			'Authorization': `Bearer ${config.apiKey}`,
			'anthropic-version': '2024-09-24',
		};

		// If explicit Beta flag is set, add the beta header (for backwards compatibility)
		if (config.anthropicBeta) {
			clientConfig.defaultHeaders['anthropic-beta'] = 'prompt-caching-2024-07-31';
		}

		anthropicClient = new Anthropic(clientConfig);
	}

	return anthropicClient;
}

export function resetAnthropicClient(): void {
	anthropicClient = null;
}

/**
 * Generate a user_id in the format: user_<hash>_account__session_<uuid>
 * This matches Anthropic's expected format for tracking and caching
 * The hash is based on sessionId only to keep it consistent within the same session
 */
function generateUserId(sessionId: string): string {
	// Generate a 64-character hash (consistent for the same session)
	const hash = createHash('sha256')
		.update(`anthropic_user_${sessionId}`)
		.digest('hex');

	return `user_${hash}_account__session_${sessionId}`;
}

/**
 * Convert OpenAI-style tools to Anthropic tool format
 * Adds cache_control to the last tool for prompt caching
 */
function convertToolsToAnthropic(tools?: ChatCompletionTool[]): Anthropic.Tool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const convertedTools = tools
		.filter(tool => tool.type === 'function' && 'function' in tool)
		.map(tool => {
			if (tool.type === 'function' && 'function' in tool) {
				return {
					name: tool.function.name,
					description: tool.function.description || '',
					input_schema: tool.function.parameters as any
				};
			}
			throw new Error('Invalid tool format');
		});

	// Add cache_control to the last tool for prompt caching
	if (convertedTools.length > 0) {
		const lastTool = convertedTools[convertedTools.length - 1];
		(lastTool as any).cache_control = { type: 'ephemeral' };
	}

	return convertedTools;
}

/**
 * Convert our ChatMessage format to Anthropic's message format
 * Adds cache_control to system prompt and last user message for prompt caching
 * Logic:
 * 1. If custom system prompt exists: use custom as system, prepend default as first user message
 * 2. If no custom system prompt: use default as system
 */
function convertToAnthropicMessages(messages: ChatMessage[]): {
	system?: any;
	messages: Anthropic.MessageParam[]
} {
	const customSystemPrompt = getCustomSystemPrompt();
	let systemContent: string | undefined;
	const anthropicMessages: Anthropic.MessageParam[] = [];

	for (const msg of messages) {
		// Extract system message
		if (msg.role === 'system') {
			systemContent = msg.content;
			continue;
		}

		// Handle tool result messages
		if (msg.role === 'tool' && msg.tool_call_id) {
			// Anthropic expects tool results as user messages with tool_result content
			anthropicMessages.push({
				role: 'user',
				content: [{
					type: 'tool_result',
					tool_use_id: msg.tool_call_id,
					content: msg.content
				}]
			});
			continue;
		}

		// Handle user messages with images
		if (msg.role === 'user' && msg.images && msg.images.length > 0) {
			const content: any[] = [];

			// Add text content
			if (msg.content) {
				content.push({
					type: 'text',
					text: msg.content
				});
			}

			// Add images
			for (const image of msg.images) {
				// Extract base64 data and mime type
				const base64Match = image.data.match(/^data:([^;]+);base64,(.+)$/);
				if (base64Match) {
					content.push({
						type: 'image',
						source: {
							type: 'base64',
							media_type: base64Match[1] || image.mimeType,
							data: base64Match[2] || ''
						}
					});
				}
			}

			anthropicMessages.push({
				role: 'user',
				content
			});
			continue;
		}

		// Handle assistant messages with tool calls
		if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
			const content: any[] = [];

			// Add text content if present
			if (msg.content) {
				content.push({
					type: 'text',
					text: msg.content
				});
			}

			// Add tool uses
			for (const toolCall of msg.tool_calls) {
				content.push({
					type: 'tool_use',
					id: toolCall.id,
					name: toolCall.function.name,
					input: JSON.parse(toolCall.function.arguments)
				});
			}

			anthropicMessages.push({
				role: 'assistant',
				content
			});
			continue;
		}

		// Handle regular text messages
		if (msg.role === 'user' || msg.role === 'assistant') {
			anthropicMessages.push({
				role: msg.role,
				content: msg.content
			});
		}
	}

	// 如果配置了自定义系统提示词
	if (customSystemPrompt) {
		// 自定义系统提示词作为 system，默认系统提示词作为第一条用户消息
		systemContent = customSystemPrompt;
		// Add cache_control to the default system prompt (now as first user message)
		anthropicMessages.unshift({
			role: 'user',
			content: [{
				type: 'text',
				text: SYSTEM_PROMPT,
				cache_control: { type: 'ephemeral' }
			}] as any
		});
	} else if (!systemContent) {
		// 没有自定义系统提示词，默认系统提示词作为 system
		systemContent = SYSTEM_PROMPT;
	}

	// Add cache_control to last user message for prompt caching
	// Find the last user message (skip if it's the first message we just added)
	let lastUserMessageIndex = -1;
	for (let i = anthropicMessages.length - 1; i >= 0; i--) {
		if (anthropicMessages[i]?.role === 'user') {
			// Skip the first message if it's the default system prompt
			if (customSystemPrompt && i === 0) {
				continue;
			}
			lastUserMessageIndex = i;
			break;
		}
	}

	if (lastUserMessageIndex >= 0) {
		const lastMessage = anthropicMessages[lastUserMessageIndex];
		if (lastMessage && lastMessage.role === 'user') {
			// Convert content to array format if it's a string
			if (typeof lastMessage.content === 'string') {
				lastMessage.content = [{
					type: 'text',
					text: lastMessage.content,
					cache_control: { type: 'ephemeral' }
				} as any];
			} else if (Array.isArray(lastMessage.content)) {
				// Add cache_control to last content block
				const lastContentIndex = lastMessage.content.length - 1;
				if (lastContentIndex >= 0) {
					const lastContent = lastMessage.content[lastContentIndex] as any;
					lastContent.cache_control = { type: 'ephemeral' };
				}
			}
		}
	}

	// Format system prompt with cache_control (only if we have a system prompt)
	const system = systemContent ? [{
		type: 'text',
		text: systemContent,
		cache_control: { type: 'ephemeral' }
	}] : undefined;

	return { system, messages: anthropicMessages };
}

/**
 * Create streaming chat completion using Anthropic API
 */
export async function* createStreamingAnthropicCompletion(
	options: AnthropicOptions,
	abortSignal?: AbortSignal,
	onRetry?: (error: Error, attempt: number, nextDelay: number) => void
): AsyncGenerator<AnthropicStreamChunk, void, unknown> {
	const client = getAnthropicClient();

	// 使用重试包装生成器
	yield* withRetryGenerator(
		async function* () {
			const { system, messages } = convertToAnthropicMessages(options.messages);

		// Generate user_id with session tracking if sessionId is provided
		const sessionId = options.sessionId || randomUUID();
		const userId = generateUserId(sessionId);

		// Prepare request body for logging
		const requestBody: any = {
			model: options.model,
			max_tokens: options.max_tokens || 4096,
			temperature: options.temperature ?? 0.7,
			system,
			messages,
			tools: convertToolsToAnthropic(options.tools),
			metadata: {
				user_id: userId
			},
			stream: true
		};

		// Create streaming request
		const stream = await client.messages.create(requestBody) as any;

		let contentBuffer = '';
		let toolCallsBuffer: Map<string, {
			id: string;
			type: 'function';
			function: {
				name: string;
				arguments: string;
			};
		}> = new Map();
		let hasToolCalls = false;
		let usageData: UsageInfo | undefined;
		// Map content block index to tool use ID for tracking deltas
		let blockIndexToId: Map<number, string> = new Map();

		for await (const event of stream) {
			if (abortSignal?.aborted) {
				return;
			}

			// Handle different event types
			if (event.type === 'content_block_start') {
				const block = event.content_block;

				// Handle tool use blocks
				if (block.type === 'tool_use') {
					hasToolCalls = true;
					const blockIndex = event.index;
					// Map block index to tool ID for tracking deltas
					blockIndexToId.set(blockIndex, block.id);

					toolCallsBuffer.set(block.id, {
						id: block.id,
						type: 'function',
						function: {
							name: block.name,
							arguments: '{}' // Initialize with empty object instead of empty string
						}
					});

					// Yield delta for token counting
					yield {
						type: 'tool_call_delta',
						delta: block.name
					};
				}
			} else if (event.type === 'content_block_delta') {
				const delta = event.delta;

				// Handle text content
				if (delta.type === 'text_delta') {
					const text = delta.text;
					contentBuffer += text;
					yield {
						type: 'content',
						content: text
					};
				}

				// Handle tool input deltas
				if (delta.type === 'input_json_delta') {
					const jsonDelta = delta.partial_json;
					const blockIndex = event.index;
					// Use block index to find the correct tool ID
					const toolId = blockIndexToId.get(blockIndex);

					if (toolId) {
						const toolCall = toolCallsBuffer.get(toolId);
						if (toolCall) {
							// If this is the first delta and arguments is still '{}', replace it
							if (toolCall.function.arguments === '{}') {
								toolCall.function.arguments = jsonDelta;
							} else {
								toolCall.function.arguments += jsonDelta;
							}

							// Yield delta for token counting
							yield {
								type: 'tool_call_delta',
								delta: jsonDelta
							};
						}
					}
				}
			} else if (event.type === 'message_start') {
				// Capture initial usage data (including cache metrics)
				if (event.message.usage) {
					usageData = {
						prompt_tokens: event.message.usage.input_tokens || 0,
						completion_tokens: event.message.usage.output_tokens || 0,
						total_tokens: (event.message.usage.input_tokens || 0) + (event.message.usage.output_tokens || 0),
						cache_creation_input_tokens: (event.message.usage as any).cache_creation_input_tokens,
						cache_read_input_tokens: (event.message.usage as any).cache_read_input_tokens
					};
				}
			} else if (event.type === 'message_delta') {
				// Update usage data with final token counts (including cache metrics)
				if (event.usage) {
					if (!usageData) {
						usageData = {
							prompt_tokens: 0,
							completion_tokens: 0,
							total_tokens: 0
						};
					}
					usageData.completion_tokens = event.usage.output_tokens || 0;
					usageData.total_tokens = usageData.prompt_tokens + usageData.completion_tokens;
					// Update cache metrics if present
					if ((event.usage as any).cache_creation_input_tokens !== undefined) {
						usageData.cache_creation_input_tokens = (event.usage as any).cache_creation_input_tokens;
					}
					if ((event.usage as any).cache_read_input_tokens !== undefined) {
						usageData.cache_read_input_tokens = (event.usage as any).cache_read_input_tokens;
					}
				}
			}
		}

		// Yield tool calls if any (only after stream completes)
		if (hasToolCalls && toolCallsBuffer.size > 0) {
			// Validate that all tool call arguments are complete valid JSON
			const toolCalls = Array.from(toolCallsBuffer.values());
			for (const toolCall of toolCalls) {
				try {
					// Validate JSON completeness
					// Empty string should be treated as empty object
					const args = toolCall.function.arguments.trim() || '{}';
					JSON.parse(args);
					// Update with normalized version
					toolCall.function.arguments = args;
				} catch (e) {
					const errorMsg = e instanceof Error ? e.message : 'Unknown error';
					throw new Error(`Incomplete tool call JSON for ${toolCall.function.name}: ${toolCall.function.arguments} (${errorMsg})`);
				}
			}

			yield {
				type: 'tool_calls',
				tool_calls: toolCalls
			};
		}

		// Yield usage information if available
		if (usageData) {
			yield {
				type: 'usage',
				usage: usageData
			};
		}

		// Signal completion
		yield {
			type: 'done'
		};
		},
		{
			abortSignal,
			onRetry
		}
	);
}
