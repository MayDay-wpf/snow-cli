import {
	getOpenAiConfig,
	getCustomSystemPrompt,
	getCustomHeaders,
} from '../utils/apiConfig.js';
import {getSystemPrompt} from './systemPrompt.js';
import {withRetryGenerator, parseJsonWithFix} from '../utils/retryUtils.js';
import type {
	ChatMessage,
	ToolCall,
	ChatCompletionTool,
	UsageInfo,
} from './types.js';
import {addProxyToFetchOptions} from '../utils/proxyUtils.js';
import {saveUsageToFile} from '../utils/usageLogger.js';
export interface ResponseOptions {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	tools?: ChatCompletionTool[];
	tool_choice?: 'auto' | 'none' | 'required';
	reasoning?: {
		summary?: 'auto' | 'none';
		effort?: 'low' | 'medium' | 'high';
	} | null; // null means don't pass reasoning parameter (for small models)
	prompt_cache_key?: string;
	store?: boolean;
	include?: string[];
	includeBuiltinSystemPrompt?: boolean; // 控制是否添加内置系统提示词（默认 true）
}

/**
 * 确保 schema 符合 Responses API 的要求：
 * 1. additionalProperties: false
 * 2. 保持原有的 required 数组（不修改）
 */
function ensureStrictSchema(
	schema?: Record<string, any>,
): Record<string, any> | undefined {
	if (!schema) {
		return undefined;
	}

	// 深拷贝 schema
	const stringified = JSON.stringify(schema);
	const parseResult = parseJsonWithFix(stringified, {
		toolName: 'Schema deep copy',
		fallbackValue: schema, // 如果失败，使用原始 schema
		logWarning: true,
		logError: true,
	});
	const strictSchema = parseResult.data as Record<string, any>;

	if (strictSchema?.['type'] === 'object') {
		// 添加 additionalProperties: false
		strictSchema['additionalProperties'] = false;

		// 递归处理嵌套的 object 属性
		if (strictSchema['properties']) {
			for (const key of Object.keys(strictSchema['properties'])) {
				const prop = strictSchema['properties'][key];

				// 递归处理嵌套的 object
				if (
					prop['type'] === 'object' ||
					(Array.isArray(prop['type']) && prop['type'].includes('object'))
				) {
					if (!('additionalProperties' in prop)) {
						prop['additionalProperties'] = false;
					}
				}
			}
		}

		// 如果 properties 为空且有 required 字段，删除它
		if (
			strictSchema['properties'] &&
			Object.keys(strictSchema['properties']).length === 0 &&
			strictSchema['required']
		) {
			delete strictSchema['required'];
		}
	}

	return strictSchema;
}

/**
 * 转换 Chat Completions 格式的工具为 Responses API 格式
 * Chat Completions: {type: 'function', function: {name, description, parameters}}
 * Responses API: {type: 'function', name, description, parameters, strict}
 */
function convertToolsForResponses(tools?: ChatCompletionTool[]):
	| Array<{
			type: 'function';
			name: string;
			description?: string;
			strict?: boolean;
			parameters?: Record<string, any>;
	  }>
	| undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map(tool => ({
		type: 'function',
		name: tool.function.name,
		description: tool.function.description,
		strict: false,
		parameters: ensureStrictSchema(tool.function.parameters),
	}));
}

export interface ResponseStreamChunk {
	type:
		| 'content'
		| 'tool_calls'
		| 'tool_call_delta'
		| 'reasoning_delta'
		| 'reasoning_started'
		| 'reasoning_data'
		| 'done'
		| 'usage';
	content?: string;
	tool_calls?: ToolCall[];
	delta?: string;
	usage?: UsageInfo;
	reasoning?: {
		summary?: Array<{type: 'summary_text'; text: string}>;
		content?: any;
		encrypted_content?: string;
	};
}

let openaiConfig: {
	apiKey: string;
	baseUrl: string;
	customHeaders: Record<string, string>;
} | null = null;

function getOpenAIConfig() {
	if (!openaiConfig) {
		const config = getOpenAiConfig();

		if (!config.apiKey || !config.baseUrl) {
			throw new Error(
				'OpenAI API configuration is incomplete. Please configure API settings first.',
			);
		}

		const customHeaders = getCustomHeaders();

		openaiConfig = {
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			customHeaders,
		};
	}

	return openaiConfig;
}

function getResponsesReasoningConfig(): {
	effort?: 'low' | 'medium' | 'high';
	summary?: 'auto' | 'none';
} | null {
	const config = getOpenAiConfig();
	const reasoningConfig = config.responsesReasoning;

	// 如果 reasoning 未启用，返回 null
	if (!reasoningConfig?.enabled) {
		return null;
	}

	// 返回配置，summary 永远默认为 'auto'
	return {
		effort: reasoningConfig.effort || 'high',
		summary: 'auto',
	};
}

export function resetOpenAIClient(): void {
	openaiConfig = null;
}

function convertToResponseInput(
	messages: ChatMessage[],
	includeBuiltinSystemPrompt: boolean = true,
): {
	input: any[];
	systemInstructions: string;
} {
	const customSystemPrompt = getCustomSystemPrompt();
	const result: any[] = [];

	for (const msg of messages) {
		if (!msg) continue;

		// 跳过 system 消息（不放入 input，也不放入 instructions）
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
					text: msg.content,
				});
			}

			// 添加图片内容
			if (msg.images && msg.images.length > 0) {
				for (const image of msg.images) {
					contentParts.push({
						type: 'input_image',
						image_url: image.data,
					});
				}
			}

			result.push({
				type: 'message',
				role: 'user',
				content: contentParts,
			});
			continue;
		}

		// Assistant 消息（带工具调用）
		// 在 Responses API 中，需要将工具调用转换为 function_call 类型的独立项
		if (
			msg.role === 'assistant' &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			// 为每个工具调用添加 function_call 项
			for (const toolCall of msg.tool_calls) {
				result.push({
					type: 'function_call',
					name: toolCall.function.name,
					arguments: toolCall.function.arguments,
					call_id: toolCall.id,
				});
			}
			continue;
		}

		// Assistant 消息（纯文本）
		if (msg.role === 'assistant') {
			result.push({
				type: 'message',
				role: 'assistant',
				content: [
					{
						type: 'output_text',
						text: msg.content || '',
					},
				],
			});
			continue;
		}

		// Tool 消息：转换为 function_call_output
		if (msg.role === 'tool' && msg.tool_call_id) {
			// Handle multimodal tool results with images
			if (msg.images && msg.images.length > 0) {
				// For Responses API, we need to include images in a structured way
				// The output can be an array of content items
				const outputContent: any[] = [];

				// Add text content
				if (msg.content) {
					outputContent.push({
						type: 'input_text',
						text: msg.content,
					});
				}

				// Add images as base64 data URLs (Responses API format)
				for (const image of msg.images) {
					outputContent.push({
						type: 'input_image',
						image_url: `data:${image.mimeType};base64,${image.data}`,
					});
				}

				result.push({
					type: 'function_call_output',
					call_id: msg.tool_call_id,
					output: outputContent,
				});
			} else {
				result.push({
					type: 'function_call_output',
					call_id: msg.tool_call_id,
					output: msg.content,
				});
			}
			continue;
		}
	}

	// 确定系统提示词：参考 anthropic.ts 的逻辑
	let systemInstructions: string;
	// 如果配置了自定义系统提示词（最高优先级，始终添加）
	if (customSystemPrompt) {
		// 有自定义系统提示词：自定义作为 instructions
		systemInstructions = customSystemPrompt;
		if (includeBuiltinSystemPrompt) {
			// 默认系统提示词作为第一条用户消息
			result.unshift({
				type: 'message',
				role: 'user',
				content: [
					{
						type: 'input_text',
						text: getSystemPrompt(),
					},
				],
			});
		}
	} else if (includeBuiltinSystemPrompt) {
		// 没有自定义系统提示词，但需要添加默认系统提示词
		systemInstructions = getSystemPrompt();
	} else {
		// 既没有自定义系统提示词，也不需要添加默认系统提示词
		systemInstructions = 'You are a helpful assistant.';
	}

	return {input: result, systemInstructions};
}

/**
 * Parse Server-Sent Events (SSE) stream
 */
async function* parseSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<any, void, unknown> {
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const {done, value} = await reader.read();

			if (done) {
				// ✅ 关键修复：检查buffer是否有残留数据
				if (buffer.trim()) {
					// 连接异常中断，抛出明确错误
					throw new Error(
						`Stream terminated unexpectedly with incomplete data: ${buffer.substring(0, 100)}...`,
					);
				}
				break; // 正常结束
			}

			buffer += decoder.decode(value, {stream: true});
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith(':')) continue;

				if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
					return;
				}

				// Handle both "event: " and "event:" formats
				if (trimmed.startsWith('event:')) {
					// Event type, will be followed by data
					continue;
				}

				// Handle both "data: " and "data:" formats
				if (trimmed.startsWith('data:')) {
					const data = trimmed.startsWith('data: ')
						? trimmed.slice(6)
						: trimmed.slice(5);
					const parseResult = parseJsonWithFix(data, {
						toolName: 'Responses API SSE stream',
						logWarning: false,
						logError: true,
					});

					if (parseResult.success) {
						yield parseResult.data;
					}
				}
			}
		}
	} catch (error) {
		const {logger} = await import('../utils/logger.js');
		logger.error('Responses API SSE stream parsing error:', {
			error: error instanceof Error ? error.message : 'Unknown error',
			remainingBuffer: buffer.substring(0, 200),
		});
		throw error;
	}
}


/**
 * 使用 Responses API 创建流式响应（带自动工具调用）
 */
export async function* createStreamingResponse(
	options: ResponseOptions,
	abortSignal?: AbortSignal,
	onRetry?: (error: Error, attempt: number, nextDelay: number) => void,
): AsyncGenerator<ResponseStreamChunk, void, unknown> {
	const config = getOpenAIConfig();

	// 提取系统提示词和转换后的消息
	const {input: requestInput, systemInstructions} = convertToResponseInput(
		options.messages,
		options.includeBuiltinSystemPrompt !== false, // 默认为 true
	);

	// 获取配置的 reasoning 设置
	const configuredReasoning = getResponsesReasoningConfig();

	// 使用重试包装生成器
	yield* withRetryGenerator(
		async function* () {
			const requestPayload: any = {
				model: options.model,
				instructions: systemInstructions,
				input: requestInput,
				tools: convertToolsForResponses(options.tools),
				tool_choice: options.tool_choice,
				parallel_tool_calls: false,
				// 只有当 reasoning 启用时才添加 reasoning 字段
				...(configuredReasoning && {
					reasoning: configuredReasoning,
				}),
				store: false,
				stream: true,
				prompt_cache_key: options.prompt_cache_key,
			};

			const url = `${config.baseUrl}/responses`;
			const fetchOptions = addProxyToFetchOptions(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${config.apiKey}`,
					'x-snow': 'true',
					...config.customHeaders,
				},
				body: JSON.stringify(requestPayload),
				signal: abortSignal,
			});

			const response = await fetch(url, fetchOptions);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`OpenAI Responses API error: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			if (!response.body) {
				throw new Error('No response body from OpenAI Responses API');
			}

			let contentBuffer = '';
			let toolCallsBuffer: {[call_id: string]: any} = {};
			let hasToolCalls = false;
			let currentFunctionCallId: string | null = null;
			let usageData: UsageInfo | undefined;
			let reasoningData:
				| {
						summary?: Array<{text: string; type: 'summary_text'}>;
						content?: any;
						encrypted_content?: string;
				  }
				| undefined;

			for await (const chunk of parseSSEStream(response.body.getReader())) {
				if (abortSignal?.aborted) {
					return;
				}

				// Responses API 使用 SSE 事件格式
				const eventType = chunk.type;

				// 根据事件类型处理
				if (
					eventType === 'response.created' ||
					eventType === 'response.in_progress'
				) {
					// 响应创建/进行中 - 忽略
					continue;
				} else if (eventType === 'response.output_item.added') {
					// 新输出项添加
					const item = chunk.item;
					if (item?.type === 'reasoning') {
						// 推理摘要开始 - 发送 reasoning_started 事件
						yield {
							type: 'reasoning_started',
						};
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
								arguments: '',
							},
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
							delta: delta,
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
					} else if (item?.type === 'reasoning') {
						// 捕获完整的 reasoning 对象（包括 encrypted_content）
						reasoningData = {
							summary: item.summary,
							content: item.content,
							encrypted_content: item.encrypted_content,
						};
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
							delta: delta,
						};
					}
				} else if (eventType === 'response.output_text.delta') {
					// 文本增量更新
					const delta = chunk.delta;
					if (delta) {
						contentBuffer += delta;
						yield {
							type: 'content',
							content: delta,
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
							cached_tokens: (chunk.response.usage as any).input_tokens_details
								?.cached_tokens,
						};
					}
					break;
				} else if (
					eventType === 'response.failed' ||
					eventType === 'response.cancelled'
				) {
					// 响应失败或取消
					const error = chunk.error;
					if (error) {
						throw new Error(
							`Response failed: ${error.message || 'Unknown error'}`,
						);
					}
					break;
				}
			}

			// 如果有工具调用，返回它们
			if (hasToolCalls) {
				yield {
					type: 'tool_calls',
					tool_calls: Object.values(toolCallsBuffer),
				};
			}

			// Yield reasoning data if available
			if (reasoningData) {
				yield {
					type: 'reasoning_data',
					reasoning: reasoningData,
				};
			}

			// Yield usage information if available
			if (usageData) {
				// Save usage to file system at API layer
				saveUsageToFile(options.model, usageData);

				yield {
					type: 'usage',
					usage: usageData,
				};
			}

			// 发送完成信号 - For Responses API, thinking content is in reasoning object, not separate thinking field
			yield {
				type: 'done',
			};
		},
		{
			abortSignal,
			onRetry,
		},
	);
}
