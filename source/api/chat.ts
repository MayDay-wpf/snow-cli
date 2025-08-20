import OpenAI from 'openai';
import { getOpenAiConfig } from '../utils/apiConfig.js';
import { executeMCPTool } from '../utils/mcpToolsManager.js';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
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
 */
function convertToOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
	return messages.map(msg => {
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
							console.log(`Executing tool: ${toolCall.function.name}`);
							const args = JSON.parse(toolCall.function.arguments);
							const result = await executeMCPTool(toolCall.function.name, args);

							// Add tool result to conversation
							messages.push({
								role: 'tool',
								content: JSON.stringify(result),
								tool_call_id: toolCall.id
							});
						} catch (error) {
							console.error(`Tool execution failed for ${toolCall.function.name}:`, error);
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
							console.log(`Executing tool: ${toolCall.function.name}`);
							const args = JSON.parse(toolCall.function.arguments);
							const result = await executeMCPTool(toolCall.function.name, args);

							// Add tool result to conversation
							messages.push({
								role: 'tool',
								content: JSON.stringify(result),
								tool_call_id: toolCall.id
							});
						} catch (error) {
							console.error(`Tool execution failed for ${toolCall.function.name}:`, error);
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

export async function* createStreamingChatCompletion(
	options: ChatCompletionOptions,
	abortSignal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
	const client = getOpenAIClient();
	let messages = [...options.messages];

	try {
		while (true) {
			const stream = await client.chat.completions.create({
				model: options.model,
				messages: convertToOpenAIMessages(messages),
				stream: true,
				temperature: options.temperature || 0.7,
				max_tokens: options.max_tokens,
				tools: options.tools,
				tool_choice: options.tool_choice,
			}, {
				signal: abortSignal,
			});

			let assistantMessage: ChatMessage = {
				role: 'assistant',
				content: '',
				tool_calls: []
			};

			let toolCallsBuffer: { [index: number]: any } = {};
			let hasToolCalls = false;

			for await (const chunk of stream) {
				if (abortSignal?.aborted) {
					return;
				}

				const choice = chunk.choices[0];
				if (!choice) continue;

				// Handle content streaming
				const content = choice.delta?.content;
				if (content) {
					assistantMessage.content += content;
					yield content;
				}

				// Handle tool calls streaming
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
						if (deltaCall.function?.name) {
							toolCallsBuffer[index].function.name += deltaCall.function.name;
						}
						if (deltaCall.function?.arguments) {
							toolCallsBuffer[index].function.arguments += deltaCall.function.arguments;
						}
					}
				}

				// Check if streaming is finished
				if (choice.finish_reason) {
					break;
				}
			}

			// Convert buffered tool calls to array
			if (hasToolCalls) {
				assistantMessage.tool_calls = Object.values(toolCallsBuffer);
			}

			// Add assistant message to conversation
			messages.push(assistantMessage);

			// Handle tool calls if present
			if (hasToolCalls && assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
				yield '\n\n🔧 Executing tools...\n';

				// Execute each tool call
				for (const toolCall of assistantMessage.tool_calls) {
					if (toolCall.type === 'function') {
						try {
							yield `\n• Calling ${toolCall.function.name}...`;
							console.log(`Executing tool: ${toolCall.function.name}`);
							const args = JSON.parse(toolCall.function.arguments);
							const result = await executeMCPTool(toolCall.function.name, args);
							// Add tool result to conversation
							messages.push({
								role: 'tool',
								content: JSON.stringify(result),
								tool_call_id: toolCall.id
							});
							yield ` ✅\n`;
						} catch (error) {
							yield ` ❌\n`;
							// Add error result to conversation
							messages.push({
								role: 'tool',
								content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}`,
								tool_call_id: toolCall.id
							});
						}
					}
				}

				yield '\n📝 Continuing with results...\n\n';
				// Continue the conversation with tool results
				continue;
			}

			// No tool calls, we're done
			return;
		}
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return; // Silently handle abort
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