import Anthropic from '@anthropic-ai/sdk';
import { createHash, randomUUID } from 'crypto';
import { getOpenAiConfig } from '../utils/apiConfig.js';
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

		// If Anthropic Beta is enabled, add default query parameter
		if (config.anthropicBeta) {
			clientConfig.defaultQuery = { beta: 'true' };
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
 */
function convertToolsToAnthropic(tools?: ChatCompletionTool[]): Anthropic.Tool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools
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
}

/**
 * Convert our ChatMessage format to Anthropic's message format
 * Adds cache_control to system prompt and last user message for prompt caching
 */
function convertToAnthropicMessages(messages: ChatMessage[]): {
	system?: any;
	messages: Anthropic.MessageParam[]
} {
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

	// Add cache_control to last user message for prompt caching
	if (anthropicMessages.length > 0) {
		const lastMessageIndex = anthropicMessages.length - 1;
		const lastMessage = anthropicMessages[lastMessageIndex];

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

	// Format system prompt with cache_control
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
	abortSignal?: AbortSignal
): AsyncGenerator<AnthropicStreamChunk, void, unknown> {
	const client = getAnthropicClient();

	try {
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
					toolCallsBuffer.set(block.id, {
						id: block.id,
						type: 'function',
						function: {
							name: block.name,
							arguments: ''
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
					const toolCall = toolCallsBuffer.get(event.index.toString());
					if (toolCall) {
						toolCall.function.arguments += jsonDelta;

						// Yield delta for token counting
						yield {
							type: 'tool_call_delta',
							delta: jsonDelta
						};
					}
				}
			} else if (event.type === 'message_start') {
				// Capture initial usage data
				if (event.message.usage) {
					usageData = {
						prompt_tokens: event.message.usage.input_tokens || 0,
						completion_tokens: event.message.usage.output_tokens || 0,
						total_tokens: (event.message.usage.input_tokens || 0) + (event.message.usage.output_tokens || 0)
					};
				}
			} else if (event.type === 'message_delta') {
				// Update usage data with final token counts
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
				}
			}
		}

		// Yield tool calls if any
		if (hasToolCalls && toolCallsBuffer.size > 0) {
			yield {
				type: 'tool_calls',
				tool_calls: Array.from(toolCallsBuffer.values())
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

	} catch (error) {
		if (abortSignal?.aborted) {
			return;
		}
		if (error instanceof Error) {
			throw new Error(`Anthropic streaming completion failed: ${error.message}`);
		}
		throw new Error('Anthropic streaming completion failed: Unknown error');
	}
}
