import OpenAI from 'openai';
import { getOpenAiConfig } from '../utils/apiConfig.js';
import { executeMCPTool } from '../utils/mcpToolsManager.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

export interface ImageContent {
	type: 'image';
	data: string; // Base64 编码的图片数据
	mimeType: string; // 图片 MIME 类型
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
	images?: ImageContent[]; // 图片内容
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatCompletionOptions {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	tools?: ChatCompletionTool[];
	tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

export interface ChatCompletionChunk {
	id: string;
	object: 'chat.completion.chunk';
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				type?: 'function';
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason?: string | null;
	}>;
}

/**
 * Convert our ChatMessage format to OpenAI's ChatCompletionMessageParam format
 * Automatically prepends system prompt if not present
 * Logic:
 * 1. If custom system prompt exists: use custom as system, prepend default as first user message
 * 2. If no custom system prompt: use default as system
 */
function convertToOpenAIMessages(messages: ChatMessage[], includeSystemPrompt: boolean = true): ChatCompletionMessageParam[] {
	const config = getOpenAiConfig();
	const customSystemPrompt = config.systemPrompt;

	let result = messages.map(msg => {
		// 如果消息包含图片，使用 content 数组格式
		if (msg.role === 'user' && msg.images && msg.images.length > 0) {
			const contentParts: Array<{type: 'text' | 'image_url', text?: string, image_url?: {url: string}}> = [];

			// 添加文本内容
			if (msg.content) {
				contentParts.push({
					type: 'text',
					text: msg.content
				});
			}

			// 添加图片内容
			for (const image of msg.images) {
				contentParts.push({
					type: 'image_url',
					image_url: {
						url: image.data // Base64 data URL
					}
				});
			}

			return {
				role: 'user',
				content: contentParts
			} as ChatCompletionMessageParam;
		}

		const baseMessage = {
			role: msg.role,
			content: msg.content
		};

		if (msg.role === 'assistant' && msg.tool_calls) {
			return {
				...baseMessage,
				tool_calls: msg.tool_calls
			} as ChatCompletionMessageParam;
		}

		if (msg.role === 'tool' && msg.tool_call_id) {
			return {
				role: 'tool',
				content: msg.content,
				tool_call_id: msg.tool_call_id
			} as ChatCompletionMessageParam;
		}

		return baseMessage as ChatCompletionMessageParam;
	});

	// 如果需要系统提示词
	if (includeSystemPrompt) {
		// 如果第一条消息已经是 system 消息，跳过
		if (result.length > 0 && result[0]?.role === 'system') {
			return result;
		}

		// 如果配置了自定义系统提示词
		if (customSystemPrompt) {
			// 自定义系统提示词作为 system 消息，默认系统提示词作为第一条 user 消息
			result = [
				{
					role: 'system',
					content: customSystemPrompt
				} as ChatCompletionMessageParam,
				{
					role: 'user',
					content: SYSTEM_PROMPT
				} as ChatCompletionMessageParam,
				...result
			];
		} else {
			// 没有自定义系统提示词，默认系统提示词作为 system 消息
			result = [
				{
					role: 'system',
					content: SYSTEM_PROMPT
				} as ChatCompletionMessageParam,
				...result
			];
		}
	}

	return result;
}

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
	if (!openaiClient) {
		const config = getOpenAiConfig();

		if (!config.apiKey || !config.baseUrl) {
			throw new Error('OpenAI API configuration is incomplete. Please configure API settings first.');
		}

		openaiClient = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});
	}

	return openaiClient;
}

export function resetOpenAIClient(): void {
	openaiClient = null;
}

/**
 * Create chat completion with automatic function calling support
 */
export async function createChatCompletionWithTools(
	options: ChatCompletionOptions,
	maxToolRounds: number = 5
): Promise<{ content: string; toolCalls: ToolCall[] }> {
	const client = getOpenAIClient();
	let messages = [...options.messages];
	let allToolCalls: ToolCall[] = [];
	let rounds = 0;

	try {
		while (rounds < maxToolRounds) {
			const response = await client.chat.completions.create({
				model: options.model,
				messages: convertToOpenAIMessages(messages),
				stream: false,
				temperature: options.temperature || 0.7,
				max_tokens: options.max_tokens,
				tools: options.tools,
				tool_choice: options.tool_choice,
			});

			const message = response.choices[0]?.message;
			if (!message) {
				throw new Error('No response from AI');
			}

			// Add assistant message to conversation
			messages.push({
				role: 'assistant',
				content: message.content || '',
				tool_calls: message.tool_calls as ToolCall[] | undefined
			});

			// Check if AI wants to call tools
			if (message.tool_calls && message.tool_calls.length > 0) {
				allToolCalls.push(...message.tool_calls as ToolCall[]);

				// Execute each tool call
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === 'function') {
						try {
							const args = JSON.parse(toolCall.function.arguments);
							const result = await executeMCPTool(toolCall.function.name, args);

							// Add tool result to conversation
							messages.push({
								role: 'tool',
								content: JSON.stringify(result),
								tool_call_id: toolCall.id
							});
						} catch (error) {
							// Add error result to conversation
							messages.push({
								role: 'tool',
								content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}`,
								tool_call_id: toolCall.id
							});
						}
					}
				}

				rounds++;
				continue;
			}

			// No tool calls, return the content
			return {
				content: message.content || '',
				toolCalls: allToolCalls
			};
		}

		throw new Error(`Maximum tool calling rounds (${maxToolRounds}) exceeded`);
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Chat completion with tools failed: ${error.message}`);
		}
		throw new Error('Chat completion with tools failed: Unknown error');
	}
}

export async function createChatCompletion(options: ChatCompletionOptions): Promise<string> {
	const client = getOpenAIClient();
	let messages = [...options.messages];

	try {
		while (true) {
			const response = await client.chat.completions.create({
				model: options.model,
				messages: convertToOpenAIMessages(messages),
				stream: false,
				temperature: options.temperature || 0.7,
				max_tokens: options.max_tokens,
				tools: options.tools,
				tool_choice: options.tool_choice,
			});

			const message = response.choices[0]?.message;
			if (!message) {
				throw new Error('No response from AI');
			}

			// Add assistant message to conversation
			messages.push({
				role: 'assistant',
				content: message.content || '',
				tool_calls: message.tool_calls as ToolCall[] | undefined
			});

			// Check if AI wants to call tools
			if (message.tool_calls && message.tool_calls.length > 0) {
				// Execute each tool call
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === 'function') {
						try {
							const args = JSON.parse(toolCall.function.arguments);
							const result = await executeMCPTool(toolCall.function.name, args);

							// Add tool result to conversation
							messages.push({
								role: 'tool',
								content: JSON.stringify(result),
								tool_call_id: toolCall.id
							});
						} catch (error) {
							// Add error result to conversation
							messages.push({
								role: 'tool',
								content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}`,
								tool_call_id: toolCall.id
							});
						}
					}
				}
				// Continue the conversation with tool results
				continue;
			}

			// No tool calls, return the content
			return message.content || '';
		}
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Chat completion failed: ${error.message}`);
		}
		throw new Error('Chat completion failed: Unknown error');
	}
}

export interface UsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface StreamChunk {
	type: 'content' | 'tool_calls' | 'tool_call_delta' | 'reasoning_delta' | 'done' | 'usage';
	content?: string;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
	delta?: string; // For tool call streaming chunks or reasoning content
	usage?: UsageInfo; // Token usage information
}

/**
 * Simple streaming chat completion - only handles OpenAI interaction
 * Tool execution should be handled by the caller
 */
export async function* createStreamingChatCompletion(
	options: ChatCompletionOptions,
	abortSignal?: AbortSignal
): AsyncGenerator<StreamChunk, void, unknown> {
	const client = getOpenAIClient();

	try {
		const stream = (await client.chat.completions.create({
			model: options.model,
			messages: convertToOpenAIMessages(options.messages),
			stream: true,
			stream_options: { include_usage: true } as any, // Request usage data in stream
			temperature: options.temperature || 0.7,
			max_tokens: options.max_tokens,
			tools: options.tools,
			tool_choice: options.tool_choice,
		} as any, {
			signal: abortSignal,
		}) as unknown) as AsyncIterable<any>;

		let contentBuffer = '';
		let toolCallsBuffer: { [index: number]: any } = {};
		let hasToolCalls = false;
		let usageData: UsageInfo | undefined;

		for await (const chunk of stream) {
			if (abortSignal?.aborted) {
				return;
			}

			// Capture usage information if available (usually in the last chunk)
			const usageValue = (chunk as any).usage;
			if (usageValue !== null && usageValue !== undefined) {
				usageData = {
					prompt_tokens: usageValue.prompt_tokens || 0,
					completion_tokens: usageValue.completion_tokens || 0,
					total_tokens: usageValue.total_tokens || 0
				};
			}

			// Skip content processing if no choices (but usage is already captured above)
			const choice = chunk.choices[0];
			if (!choice) {
				continue;
			}

			// Stream content chunks
			const content = choice.delta?.content;
			if (content) {
				contentBuffer += content;
				yield {
					type: 'content',
					content
				};
			}

		// Stream reasoning content (for o1 models, etc.)
		// Note: reasoning_content is NOT included in the response, only counted for tokens
		const reasoningContent = (choice.delta as any)?.reasoning_content;
		if (reasoningContent) {
			yield {
				type: 'reasoning_delta',
				delta: reasoningContent
			};
		}

			// Accumulate tool calls and stream deltas
			const deltaToolCalls = choice.delta?.tool_calls;
			if (deltaToolCalls) {
				hasToolCalls = true;
				for (const deltaCall of deltaToolCalls) {
					const index = deltaCall.index ?? 0;

					if (!toolCallsBuffer[index]) {
						toolCallsBuffer[index] = {
							id: '',
							type: 'function',
							function: {
								name: '',
								arguments: ''
							}
						};
					}

					if (deltaCall.id) {
						toolCallsBuffer[index].id = deltaCall.id;
					}

					// Yield tool call deltas for token counting
					let deltaText = '';
					if (deltaCall.function?.name) {
						toolCallsBuffer[index].function.name += deltaCall.function.name;
						deltaText += deltaCall.function.name;
					}
					if (deltaCall.function?.arguments) {
						toolCallsBuffer[index].function.arguments += deltaCall.function.arguments;
						deltaText += deltaCall.function.arguments;
					}

					// Stream the delta to frontend for real-time token counting
					if (deltaText) {
						yield {
							type: 'tool_call_delta',
							delta: deltaText
						};
					}
				}
			}

			if (choice.finish_reason) {
				break;
			}
		}

		// If there are tool calls, yield them
		if (hasToolCalls) {
			yield {
				type: 'tool_calls',
				tool_calls: Object.values(toolCallsBuffer)
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
		if (error instanceof Error && error.name === 'AbortError') {
			return;
		}
		if (error instanceof Error) {
			throw new Error(`Streaming chat completion failed: ${error.message}`);
		}
		throw new Error('Streaming chat completion failed: Unknown error');
	}
}


export function validateChatOptions(options: ChatCompletionOptions): string[] {
	const errors: string[] = [];

	if (!options.model || options.model.trim().length === 0) {
		errors.push('Model is required');
	}

	if (!options.messages || options.messages.length === 0) {
		errors.push('At least one message is required');
	}

	for (const message of options.messages || []) {
		if (!message.role || !['system', 'user', 'assistant', 'tool'].includes(message.role)) {
			errors.push('Invalid message role');
		}

		// Tool messages must have tool_call_id
		if (message.role === 'tool' && !message.tool_call_id) {
			errors.push('Tool messages must have tool_call_id');
		}

		// Content can be empty for tool calls
		if (message.role !== 'tool' && (!message.content || message.content.trim().length === 0)) {
			errors.push('Message content cannot be empty (except for tool messages)');
		}
	}

	return errors;
}
