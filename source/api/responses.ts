import OpenAI from 'openai';
import { getOpenAiConfig, getCustomSystemPrompt } from '../utils/apiConfig.js';
import { executeMCPTool } from '../utils/mcpToolsManager.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import type { ChatMessage, ToolCall } from './chat.js';

export interface ResponseOptions {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	tools?: Array<{
		type: 'function';
		function: {
			name: string;
			description?: string;
			parameters?: Record<string, any>;
		};
	}>;
	tool_choice?: 'auto' | 'none' | 'required';
	reasoning?: {
		summary?: 'auto' | 'none';
		effort?: 'low' | 'medium' | 'high';
	};
	prompt_cache_key?: string;
	store?: boolean;
	include?: string[];
}

/**
 * 确保 schema 符合 Responses API 的要求：
 * 1. additionalProperties: false
 * 2. 保持原有的 required 数组（不修改）
 */
function ensureStrictSchema(schema?: Record<string, any>): Record<string, any> | undefined {
	if (!schema) {
		return undefined;
	}

	// 深拷贝 schema
	const strictSchema = JSON.parse(JSON.stringify(schema));

	if (strictSchema.type === 'object') {
		// 添加 additionalProperties: false
		strictSchema.additionalProperties = false;

		// 递归处理嵌套的 object 属性
		if (strictSchema.properties) {
			for (const key of Object.keys(strictSchema.properties)) {
				const prop = strictSchema.properties[key];

				// 递归处理嵌套的 object
				if (prop.type === 'object' || (Array.isArray(prop.type) && prop.type.includes('object'))) {
					if (!('additionalProperties' in prop)) {
						prop.additionalProperties = false;
					}
				}
			}
		}

		// 如果 properties 为空且有 required 字段，删除它
		if (strictSchema.properties && Object.keys(strictSchema.properties).length === 0 && strictSchema.required) {
			delete strictSchema.required;
		}
	}

	return strictSchema;
}

/**
 * 转换 Chat Completions 格式的工具为 Responses API 格式
 * Chat Completions: {type: 'function', function: {name, description, parameters}}
 * Responses API: {type: 'function', name, description, parameters, strict}
 */
function convertToolsForResponses(tools?: Array<{
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, any>;
	};
}>): Array<{
	type: 'function';
	name: string;
	description?: string;
	parameters?: Record<string, any>;
	strict?: boolean;
}> | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map(tool => ({
		type: 'function',
		name: tool.function.name,
		description: tool.function.description,
		parameters: ensureStrictSchema(tool.function.parameters),
		strict: false
	}));
}

export interface UsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cache_creation_input_tokens?: number; // Tokens used to create cache (Anthropic)
	cache_read_input_tokens?: number; // Tokens read from cache (Anthropic)
	cached_tokens?: number; // Cached tokens from prompt_tokens_details (OpenAI)
}

export interface ResponseStreamChunk {
	type: 'content' | 'tool_calls' | 'tool_call_delta' | 'reasoning_delta' | 'done' | 'usage';
	content?: string;
	tool_calls?: ToolCall[];
	delta?: string;
	usage?: UsageInfo;
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
 * 转换消息格式为 Responses API 的 input 格式
 * Responses API 的 input 格式：
 * 1. 支持 user, assistant 角色消息，使用 type: "message" 包裹
 * 2. 工具调用在 assistant 中表示为 function_call 类型的 item
 * 3. 工具结果使用 function_call_output 类型
 *
 * 注意：Responses API 使用 instructions 字段代替 system 消息
 * 优化：使用 type: "message" 包裹以提高缓存命中率
 * Logic:
 * 1. If custom system prompt exists: use custom as instructions, prepend default as first user message
 * 2. If no custom system prompt: use default as instructions
 */
function convertToResponseInput(messages: ChatMessage[]): { input: any[]; systemInstructions: string } {
	const customSystemPrompt = getCustomSystemPrompt();
	const result: any[] = [];

	for (const msg of messages) {
		if (!msg) continue;

		// 跳过 system 消息（在 createResponse 中使用 instructions 字段）
		if (msg.role === 'system') {
			continue;
		}

		// 用户消息：content 必须是数组格式，使用 type: "message" 包裹
		if (msg.role === 'user') {
			const contentParts: any[] = [];

			// 添加文本内容
			if (msg.content) {
				contentParts.push({
					type: 'input_text',
					text: msg.content
				});
			}

			// 添加图片内容
			if (msg.images && msg.images.length > 0) {
				for (const image of msg.images) {
					contentParts.push({
						type: 'input_image',
						image_url: image.data
					});
				}
			}

			result.push({
				type: 'message',
				role: 'user',
				content: contentParts
			});
			continue;
		}

		// Assistant 消息（带工具调用）
		// 在 Responses API 中，需要将工具调用转换为 function_call 类型的独立项
		if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
			// 添加 assistant 文本内容（如果有）
			if (msg.content) {
				result.push({
					type: 'message',
					role: 'assistant',
					content: [{
						type: 'output_text',
						text: msg.content
					}]
				});
			}

			// 为每个工具调用添加 function_call 项
			for (const toolCall of msg.tool_calls) {
				result.push({
					type: 'function_call',
					call_id: toolCall.id,
					name: toolCall.function.name,
					arguments: toolCall.function.arguments
				});
			}
			continue;
		}

		// Assistant 消息（纯文本）
		if (msg.role === 'assistant') {
			result.push({
				type: 'message',
				role: 'assistant',
				content: [{
					type: 'output_text',
					text: msg.content || ''
				}]
			});
			continue;
		}

		// Tool 消息：转换为 function_call_output
		if (msg.role === 'tool' && msg.tool_call_id) {
			result.push({
				type: 'function_call_output',
				call_id: msg.tool_call_id,
				output: msg.content
			});
			continue;
		}
	}

	// 确定系统提示词
	let systemInstructions: string;
	if (customSystemPrompt) {
		// 有自定义系统提示词：自定义作为 instructions，默认作为第一条用户消息
		systemInstructions = customSystemPrompt;
		result.unshift({
			type: 'message',
			role: 'user',
			content: [{
				type: 'input_text',
				text: SYSTEM_PROMPT
			}]
		});
	} else {
		// 没有自定义系统提示词：默认作为 instructions
		systemInstructions = SYSTEM_PROMPT;
	}

	return { input: result, systemInstructions };
}

/**
 * 使用 Responses API 创建响应（非流式，带自动工具调用）
 */
export async function createResponse(options: ResponseOptions): Promise<string> {
	const client = getOpenAIClient();
	let messages = [...options.messages];

	// 提取系统提示词和转换后的消息
	const { input: convertedInput, systemInstructions } = convertToResponseInput(messages);

	try {
		// 使用 Responses API
		while (true) {
			const requestPayload: any = {
				model: options.model,
				instructions: systemInstructions,
				input: convertedInput,
				tools: convertToolsForResponses(options.tools),
				tool_choice: options.tool_choice,
				reasoning: options.reasoning || { summary: 'auto', effort: 'high' },
				store: options.store ?? false,
				include: options.include || ['reasoning.encrypted_content'],
				prompt_cache_key: options.prompt_cache_key,
			};

			const response = await client.responses.create(requestPayload);

			// 提取响应 - Responses API 返回 output 数组
			const output = (response as any).output;
			if (!output || output.length === 0) {
				throw new Error('No output from AI');
			}

			// 获取最后一条消息（通常是 assistant 的响应）
			const lastMessage = output[output.length - 1];

			// 添加 assistant 消息到对话
			messages.push({
				role: 'assistant',
				content: lastMessage.content || '',
				tool_calls: lastMessage.tool_calls as ToolCall[] | undefined
			});

			// 检查是否有工具调用
			if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
				// 执行每个工具调用
				for (const toolCall of lastMessage.tool_calls) {
					if (toolCall.type === 'function') {
						try {
							const args = JSON.parse(toolCall.function.arguments);
							const result = await executeMCPTool(toolCall.function.name, args);

							// 添加工具结果到对话
							messages.push({
								role: 'tool',
								content: JSON.stringify(result),
								tool_call_id: toolCall.id
							});
						} catch (error) {
							// 添加错误结果到对话
							messages.push({
								role: 'tool',
								content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}`,
								tool_call_id: toolCall.id
							});
						}
					}
				}
				// 继续对话获取工具结果后的响应
				continue;
			}

			// 没有工具调用，返回内容
			return lastMessage.content || '';
		}
	} catch (error) {
		if (error instanceof Error) {
			// 检查是否是 API 网关不支持 Responses API
			if (error.message.includes('Panic detected') ||
				error.message.includes('nil pointer') ||
				error.message.includes('404') ||
				error.message.includes('not found')) {
				throw new Error(
					'Response creation failed: Your API endpoint does not support the Responses API. ' +
					'Please switch to "Chat Completions" method in API settings, or use an OpenAI-compatible endpoint that supports Responses API.'
				);
			}
			throw new Error(`Response creation failed: ${error.message}`);
		}
		throw new Error('Response creation failed: Unknown error');
	}
}

/**
 * 使用 Responses API 创建流式响应（带自动工具调用）
 */
export async function* createStreamingResponse(
	options: ResponseOptions,
	abortSignal?: AbortSignal
): AsyncGenerator<ResponseStreamChunk, void, unknown> {
	const client = getOpenAIClient();

	// 提取系统提示词和转换后的消息
	const { input: requestInput, systemInstructions } = convertToResponseInput(options.messages);

	try {
		const requestPayload: any = {
			model: options.model,
			instructions: systemInstructions,
			input: requestInput,
			stream: true,
			tools: convertToolsForResponses(options.tools),
			tool_choice: options.tool_choice,
			reasoning: options.reasoning || { summary: 'auto', effort: 'high' },
			store: options.store ?? false,
			include: options.include || ['reasoning.encrypted_content'],
			prompt_cache_key: options.prompt_cache_key,
		};

		const stream = await client.responses.create(requestPayload, {
			signal: abortSignal,
		});

		let contentBuffer = '';
		let toolCallsBuffer: { [call_id: string]: any } = {};
		let hasToolCalls = false;
		let currentFunctionCallId: string | null = null;
		let usageData: UsageInfo | undefined;

		for await (const chunk of stream as any) {
			if (abortSignal?.aborted) {
				return;
			}

			// Responses API 使用 SSE 事件格式
			const eventType = chunk.type;

			// 根据事件类型处理
			if (eventType === 'response.created' || eventType === 'response.in_progress') {
				// 响应创建/进行中 - 忽略
				continue;
			} else if (eventType === 'response.output_item.added') {
				// 新输出项添加
				const item = chunk.item;
				if (item?.type === 'reasoning') {
					// 推理摘要开始 - 忽略
					continue;
				} else if (item?.type === 'message') {
					// 消息开始 - 忽略
					continue;
				} else if (item?.type === 'function_call') {
					// 工具调用开始
					hasToolCalls = true;
					const callId = item.call_id || item.id;
					currentFunctionCallId = callId;
					toolCallsBuffer[callId] = {
						id: callId,
						type: 'function',
						function: {
							name: item.name || '',
							arguments: ''
						}
					};
					continue;
				}
				continue;
			} else if (eventType === 'response.function_call_arguments.delta') {
				// 工具调用参数增量
				const delta = chunk.delta;
				if (delta && currentFunctionCallId) {
					toolCallsBuffer[currentFunctionCallId].function.arguments += delta;
					// 发送 delta 用于 token 计数
					yield {
						type: 'tool_call_delta',
						delta: delta
					};
				}
			} else if (eventType === 'response.function_call_arguments.done') {
				// 工具调用参数完成
				const itemId = chunk.item_id;
				const args = chunk.arguments;
				if (itemId && toolCallsBuffer[itemId]) {
					toolCallsBuffer[itemId].function.arguments = args;
				}
				currentFunctionCallId = null;
				continue;
			} else if (eventType === 'response.output_item.done') {
				// 输出项完成
				const item = chunk.item;
				if (item?.type === 'function_call') {
					// 确保工具调用信息完整
					const callId = item.call_id || item.id;
					if (toolCallsBuffer[callId]) {
						toolCallsBuffer[callId].function.name = item.name;
						toolCallsBuffer[callId].function.arguments = item.arguments;
					}
				}
				continue;
			} else if (eventType === 'response.content_part.added') {
				// 内容部分添加 - 忽略
				continue;
			} else if (eventType === 'response.reasoning_summary_text.delta') {
				// 推理摘要增量更新（仅用于 token 计数，不包含在响应内容中）
				const delta = chunk.delta;
				if (delta) {
					yield {
						type: 'reasoning_delta',
						delta: delta
					};
				}
			} else if (eventType === 'response.output_text.delta') {
				// 文本增量更新
				const delta = chunk.delta;
				if (delta) {
					contentBuffer += delta;
					yield {
						type: 'content',
						content: delta
					};
				}
			} else if (eventType === 'response.output_text.done') {
				// 文本输出完成 - 忽略
				continue;
			} else if (eventType === 'response.content_part.done') {
				// 内容部分完成 - 忽略
				continue;
			} else if (eventType === 'response.completed') {
				// 响应完全完成 - 从 response 对象中提取 usage
				if (chunk.response && chunk.response.usage) {
					usageData = {
						prompt_tokens: chunk.response.usage.input_tokens || 0,
						completion_tokens: chunk.response.usage.output_tokens || 0,
						total_tokens: chunk.response.usage.total_tokens || 0,
						// OpenAI Responses API: cached_tokens in input_tokens_details (note: tokenS)
						cached_tokens: (chunk.response.usage as any).input_tokens_details?.cached_tokens
					};
				}
				break;
			} else if (eventType === 'response.failed' || eventType === 'response.cancelled') {
				// 响应失败或取消
				const error = chunk.error;
				if (error) {
					throw new Error(`Response failed: ${error.message || 'Unknown error'}`);
				}
				break;
			}
		}

		// 如果有工具调用，返回它们
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

		// 发送完成信号
		yield {
			type: 'done'
		};

	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return;
		}
		if (error instanceof Error) {
			// 检查是否是 API 网关不支持 Responses API
			if (error.message.includes('Panic detected') ||
				error.message.includes('nil pointer') ||
				error.message.includes('404') ||
				error.message.includes('not found')) {
				throw new Error(
					'Streaming response creation failed: Your API endpoint does not support the Responses API. ' +
					'Please switch to "Chat Completions" method in API settings, or use an OpenAI-compatible endpoint that supports Responses API (OpenAI official API, or compatible providers).'
				);
			}
			throw new Error(`Streaming response creation failed: ${error.message}`);
		}
		throw new Error('Streaming response creation failed: Unknown error');
	}
}

/**
 * 使用 Responses API 创建响应（限制工具调用轮数）
 */
export async function createResponseWithTools(
	options: ResponseOptions,
	maxToolRounds: number = 5
): Promise<{ content: string; toolCalls: ToolCall[] }> {
	const client = getOpenAIClient();
	let messages = [...options.messages];
	let allToolCalls: ToolCall[] = [];
	let rounds = 0;

	// 提取系统提示词和转换后的消息
	const { input: convertedInput, systemInstructions } = convertToResponseInput(messages);

	try {
		while (rounds < maxToolRounds) {
			const requestPayload: any = {
				model: options.model,
				instructions: systemInstructions,
				input: convertedInput,
				tools: convertToolsForResponses(options.tools),
				tool_choice: options.tool_choice,
				reasoning: options.reasoning || { summary: 'auto', effort: 'high' },
				store: options.store ?? false,
				include: options.include || ['reasoning.encrypted_content'],
				prompt_cache_key: options.prompt_cache_key,
			};

			const response = await client.responses.create(requestPayload);

			const output = (response as any).output;
			if (!output || output.length === 0) {
				throw new Error('No output from AI');
			}

			const lastMessage = output[output.length - 1];

			// 添加 assistant 消息
			messages.push({
				role: 'assistant',
				content: lastMessage.content || '',
				tool_calls: lastMessage.tool_calls as ToolCall[] | undefined
			});

			// 检查工具调用
			if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
				allToolCalls.push(...lastMessage.tool_calls as ToolCall[]);

				// 执行工具调用
				for (const toolCall of lastMessage.tool_calls) {
					if (toolCall.type === 'function') {
						try {
							const args = JSON.parse(toolCall.function.arguments);
							const result = await executeMCPTool(toolCall.function.name, args);

							messages.push({
								role: 'tool',
								content: JSON.stringify(result),
								tool_call_id: toolCall.id
							});
						} catch (error) {
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

			// 没有工具调用，返回结果
			return {
				content: lastMessage.content || '',
				toolCalls: allToolCalls
			};
		}

		throw new Error(`Maximum tool calling rounds (${maxToolRounds}) exceeded`);
	} catch (error) {
		if (error instanceof Error) {
			// 检查是否是 API 网关不支持 Responses API
			if (error.message.includes('Panic detected') ||
				error.message.includes('nil pointer') ||
				error.message.includes('404') ||
				error.message.includes('not found')) {
				throw new Error(
					'Response creation with tools failed: Your API endpoint does not support the Responses API. ' +
					'Please switch to "Chat Completions" method in API settings.'
				);
			}
			throw new Error(`Response creation with tools failed: ${error.message}`);
		}
		throw new Error('Response creation with tools failed: Unknown error');
	}
}
