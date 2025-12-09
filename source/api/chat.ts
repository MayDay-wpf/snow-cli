import {
	getOpenAiConfig,
	getCustomSystemPrompt,
	getCustomHeaders,
} from '../utils/config/apiConfig.js';
import {getSystemPromptForMode} from './systemPrompt.js';
import {
	withRetryGenerator,
	parseJsonWithFix,
} from '../utils/core/retryUtils.js';
import type {
	ChatMessage,
	ChatCompletionTool,
	ToolCall,
	UsageInfo,
	ImageContent,
} from './types.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';
import {saveUsageToFile} from '../utils/core/usageLogger.js';

export type {
	ChatMessage,
	ChatCompletionTool,
	ToolCall,
	UsageInfo,
	ImageContent,
};

export interface ChatCompletionOptions {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	tools?: ChatCompletionTool[];
	tool_choice?:
		| 'auto'
		| 'none'
		| 'required'
		| {type: 'function'; function: {name: string}};
	includeBuiltinSystemPrompt?: boolean; // 控制是否添加内置系统提示词（默认 true）
	planMode?: boolean; // 启用 Plan 模式（使用 Plan 模式系统提示词）
	// Sub-agent configuration overrides
	configProfile?: string; // 子代理配置文件名（覆盖模型等设置）
	customSystemPromptId?: string; // 自定义系统提示词 ID
	customHeaders?: Record<string, string>; // 自定义请求头
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

export interface ChatCompletionMessageParam {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content:
		| string
		| Array<{
				type: 'text' | 'image_url';
				text?: string;
				image_url?: {url: string};
		  }>;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
}

/**
 * Convert internal ChatMessage to OpenAI's message format
 * Supports both text-only and multimodal (text + images) messages
 * System prompt handling:
 * 1. If custom system prompt provided: place it as system message, default as user message
 * 2. If no custom system prompt: use default as system
 * @param messages - The messages to convert
 * @param includeBuiltinSystemPrompt - Whether to include builtin system prompt (default true)
 * @param customSystemPromptOverride - Optional custom system prompt content (for sub-agents)
 */
function convertToOpenAIMessages(
	messages: ChatMessage[],
	includeBuiltinSystemPrompt: boolean = true,
	customSystemPromptOverride?: string,
	planMode: boolean = false, // When true, use Plan mode system prompt
): ChatCompletionMessageParam[] {
	const customSystemPrompt =
		customSystemPromptOverride || getCustomSystemPrompt();

	let result = messages.map(msg => {
		// 如果消息包含图片，使用 content 数组格式
		if (msg.role === 'user' && msg.images && msg.images.length > 0) {
			const contentParts: Array<{
				type: 'text' | 'image_url';
				text?: string;
				image_url?: {url: string};
			}> = [];

			// 添加文本内容
			if (msg.content) {
				contentParts.push({
					type: 'text',
					text: msg.content,
				});
			}

			// 添加图片内容
			for (const image of msg.images) {
				contentParts.push({
					type: 'image_url',
					image_url: {
						url: image.data, // Base64 data URL
					},
				});
			}

			return {
				role: 'user',
				content: contentParts,
			} as ChatCompletionMessageParam;
		}

		const baseMessage = {
			role: msg.role,
			content: msg.content,
		};

		if (msg.role === 'assistant' && msg.tool_calls) {
			return {
				...baseMessage,
				tool_calls: msg.tool_calls,
			} as ChatCompletionMessageParam;
		}

		if (msg.role === 'tool' && msg.tool_call_id) {
			// Handle multimodal tool results with images
			if (msg.images && msg.images.length > 0) {
				const content: Array<{
					type: 'text' | 'image_url';
					text?: string;
					image_url?: {url: string};
				}> = [];

				// Add text content
				if (msg.content) {
					content.push({
						type: 'text',
						text: msg.content,
					});
				}

				// Add images as base64 data URLs
				for (const image of msg.images) {
					content.push({
						type: 'image_url',
						image_url: {
							url: `data:${image.mimeType};base64,${image.data}`,
						},
					});
				}

				return {
					role: 'tool',
					content,
					tool_call_id: msg.tool_call_id,
				} as ChatCompletionMessageParam;
			}

			return {
				role: 'tool',
				content: msg.content,
				tool_call_id: msg.tool_call_id,
			} as ChatCompletionMessageParam;
		}

		return baseMessage as ChatCompletionMessageParam;
	});

	// 如果第一条消息已经是 system 消息，跳过
	if (result.length > 0 && result[0]?.role === 'system') {
		return result;
	}

	// 如果配置了自定义系统提示词（最高优先级，始终添加）
	if (customSystemPrompt) {
		if (includeBuiltinSystemPrompt) {
			// 自定义系统提示词作为 system 消息，默认系统提示词作为第一条 user 消息
			result = [
				{
					role: 'system',
					content: customSystemPrompt,
				} as ChatCompletionMessageParam,
				{
					role: 'user',
					content: getSystemPromptForMode(planMode),
				} as ChatCompletionMessageParam,
				...result,
			];
		} else {
			// 只添加自定义系统提示词
			result = [
				{
					role: 'system',
					content: customSystemPrompt,
				} as ChatCompletionMessageParam,
				...result,
			];
		}
	} else if (includeBuiltinSystemPrompt) {
		// 没有自定义系统提示词，但需要添加默认系统提示词
		result = [
			{
				role: 'system',
				content: getSystemPromptForMode(planMode),
			} as ChatCompletionMessageParam,
			...result,
		];
	}

	return result;
}

export function resetOpenAIClient(): void {
	// No-op: kept for backward compatibility
}

export interface StreamChunk {
	type:
		| 'content'
		| 'tool_calls'
		| 'tool_call_delta'
		| 'reasoning_delta'
		| 'reasoning_started'
		| 'done'
		| 'usage';
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
						`Stream terminated unexpectedly with incomplete data: ${buffer.substring(
							0,
							100,
						)}...`,
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
						toolName: 'SSE stream',
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
		const {logger} = await import('../utils/core/logger.js');
		logger.error('SSE stream parsing error:', {
			error: error instanceof Error ? error.message : 'Unknown error',
			remainingBuffer: buffer.substring(0, 200),
		});
		throw error;
	}
}

/**
 * Simple streaming chat completion - only handles OpenAI interaction
 * Tool execution should be handled by the caller
 */
export async function* createStreamingChatCompletion(
	options: ChatCompletionOptions,
	abortSignal?: AbortSignal,
	onRetry?: (error: Error, attempt: number, nextDelay: number) => void,
): AsyncGenerator<StreamChunk, void, unknown> {
	// Load configuration: if configProfile is specified, load it; otherwise use main config
	let config: ReturnType<typeof getOpenAiConfig>;
	if (options.configProfile) {
		try {
			const {loadProfile} = await import('../utils/config/configManager.js');
			const profileConfig = loadProfile(options.configProfile);
			if (profileConfig?.snowcfg) {
				config = profileConfig.snowcfg;
			} else {
				// Profile not found, fallback to main config
				config = getOpenAiConfig();
				const {logger} = await import('../utils/core/logger.js');
				logger.warn(
					`Profile ${options.configProfile} not found, using main config`,
				);
			}
		} catch (error) {
			// If loading profile fails, fallback to main config
			config = getOpenAiConfig();
			const {logger} = await import('../utils/core/logger.js');
			logger.warn(
				`Failed to load profile ${options.configProfile}, using main config:`,
				error,
			);
		}
	} else {
		// No configProfile specified, use main config
		config = getOpenAiConfig();
	}

	// Get system prompt (with custom override support)
	let customSystemPromptContent: string | undefined;
	if (options.customSystemPromptId) {
		const {getSystemPromptConfig} = await import(
			'../utils/config/apiConfig.js'
		);
		const systemPromptConfig = getSystemPromptConfig();
		const customPrompt = systemPromptConfig?.prompts.find(
			p => p.id === options.customSystemPromptId,
		);
		if (customPrompt) {
			customSystemPromptContent = customPrompt.content;
		}
	}

	// 使用重试包装生成器
	yield* withRetryGenerator(
		async function* () {
			const requestBody = {
				model: options.model || config.advancedModel,
				messages: convertToOpenAIMessages(
					options.messages,
					options.includeBuiltinSystemPrompt !== false, // 默认为 true
					customSystemPromptContent,
					options.planMode || false, // Pass planMode to use correct system prompt
				),
				stream: true,
				stream_options: {include_usage: true},
				temperature: options.temperature || 0.7,
				max_tokens: options.max_tokens,
				tools: options.tools,
				tool_choice: options.tool_choice,
			};

			const url = `${config.baseUrl}/chat/completions`;

			// Use custom headers from options if provided, otherwise get from main config
			const customHeaders = options.customHeaders || getCustomHeaders();

			const fetchOptions = addProxyToFetchOptions(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${config.apiKey}`,
					'x-snow': 'true',
					...customHeaders,
				},
				body: JSON.stringify(requestBody),
				signal: abortSignal,
			});

			const response = await fetch(url, fetchOptions);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			if (!response.body) {
				throw new Error('No response body from OpenAI API');
			}

			let contentBuffer = '';
			let toolCallsBuffer: {[index: number]: any} = {};
			let hasToolCalls = false;
			let usageData: UsageInfo | undefined;
			let reasoningStarted = false; // Track if reasoning has started
			for await (const chunk of parseSSEStream(response.body.getReader())) {
				if (abortSignal?.aborted) {
					return;
				}

				// Capture usage information if available (usually in the last chunk)
				const usageValue = (chunk as any).usage;
				if (usageValue !== null && usageValue !== undefined) {
					usageData = {
						prompt_tokens: usageValue.prompt_tokens || 0,
						completion_tokens: usageValue.completion_tokens || 0,
						total_tokens: usageValue.total_tokens || 0,
						// OpenAI Chat API: cached_tokens in prompt_tokens_details
						cached_tokens: usageValue.prompt_tokens_details?.cached_tokens,
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
						content,
					};
				}

				// Stream reasoning content (for o1 models, etc.)
				// Note: reasoning_content is NOT included in the response, only counted for tokens
				const reasoningContent = (choice.delta as any)?.reasoning_content;
				if (reasoningContent) {
					// Emit reasoning_started event on first reasoning content
					if (!reasoningStarted) {
						reasoningStarted = true;
						yield {
							type: 'reasoning_started',
						};
					}
					yield {
						type: 'reasoning_delta',
						delta: reasoningContent,
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
									arguments: '',
								},
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
							toolCallsBuffer[index].function.arguments +=
								deltaCall.function.arguments;
							deltaText += deltaCall.function.arguments;
						}

						// Stream the delta to frontend for real-time token counting
						if (deltaText) {
							yield {
								type: 'tool_call_delta',
								delta: deltaText,
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
					tool_calls: Object.values(toolCallsBuffer),
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

			// Signal completion
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

export function validateChatOptions(options: ChatCompletionOptions): string[] {
	const errors: string[] = [];

	if (!options.model || options.model.trim().length === 0) {
		errors.push('Model is required');
	}

	if (!options.messages || options.messages.length === 0) {
		errors.push('At least one message is required');
	}

	for (const message of options.messages || []) {
		if (
			!message.role ||
			!['system', 'user', 'assistant', 'tool'].includes(message.role)
		) {
			errors.push('Invalid message role');
		}

		// Tool messages must have tool_call_id
		if (message.role === 'tool' && !message.tool_call_id) {
			errors.push('Tool messages must have tool_call_id');
		}

		// Content can be empty for tool calls
		if (
			message.role !== 'tool' &&
			(!message.content || message.content.trim().length === 0)
		) {
			errors.push('Message content cannot be empty (except for tool messages)');
		}
	}

	return errors;
}
