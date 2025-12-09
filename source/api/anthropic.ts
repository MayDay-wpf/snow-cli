import {createHash, randomUUID} from 'crypto';
import {
	getOpenAiConfig,
	getCustomSystemPrompt,
	getCustomHeaders,
	type ThinkingConfig,
} from '../utils/config/apiConfig.js';
import {getSystemPromptForMode} from './systemPrompt.js';
import {
	withRetryGenerator,
	parseJsonWithFix,
} from '../utils/core/retryUtils.js';
import type {ChatMessage, ChatCompletionTool, UsageInfo} from './types.js';
import {logger} from '../utils/core/logger.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';
import {saveUsageToFile} from '../utils/core/usageLogger.js';
import {isDevMode, getDevUserId} from '../utils/core/devMode.js';

export interface AnthropicOptions {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	max_tokens?: number;
	tools?: ChatCompletionTool[];
	sessionId?: string; // Session ID for user tracking and caching
	includeBuiltinSystemPrompt?: boolean; // 控制是否添加内置系统提示词（默认 true）
	disableThinking?: boolean; // 禁用 Extended Thinking 功能（用于 agents 等场景，默认 false）
	planMode?: boolean; // 启用 Plan 模式（使用 Plan 模式系统提示词）
	// Sub-agent configuration overrides
	configProfile?: string; // 子代理配置文件名（覆盖模型等设置）
	customSystemPromptId?: string; // 自定义系统提示词 ID
	customHeaders?: Record<string, string>; // 自定义请求头
}

export interface AnthropicStreamChunk {
	type:
		| 'content'
		| 'tool_calls'
		| 'tool_call_delta'
		| 'done'
		| 'usage'
		| 'reasoning_started'
		| 'reasoning_delta';
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
	thinking?: {
		type: 'thinking';
		thinking: string;
		signature?: string;
	};
}

export interface AnthropicTool {
	name: string;
	description: string;
	input_schema: any;
	cache_control?: {type: 'ephemeral'; ttl?: '5m' | '1h'};
}

export interface AnthropicMessageParam {
	role: 'user' | 'assistant';
	content: string | Array<any>;
}

// Deprecated: No longer used, kept for backward compatibility
// @ts-ignore - Variable kept for backward compatibility with resetAnthropicClient export
let anthropicConfig: {
	apiKey: string;
	baseUrl: string;
	customHeaders: Record<string, string>;
	anthropicBeta?: boolean;
	thinking?: ThinkingConfig;
} | null = null;

// Persistent userId that remains the same until application restart
let persistentUserId: string | null = null;

// Deprecated: Client reset is no longer needed with new config loading approach
export function resetAnthropicClient(): void {
	anthropicConfig = null;
	persistentUserId = null; // Reset userId on client reset
}

/**
 * Generate a persistent user_id that remains the same until application restart
 * Format: user_<hash>_account__session_<uuid>
 * This matches Anthropic's expected format for tracking and caching
 *
 * In dev mode (--dev flag), uses a persistent userId from ~/.snow/dev-user-id
 * instead of generating a new one each session
 */
function getPersistentUserId(): string {
	// Check if dev mode is enabled
	if (isDevMode()) {
		return getDevUserId();
	}

	// Normal mode: generate userId per session
	if (!persistentUserId) {
		const sessionId = randomUUID();
		const hash = createHash('sha256')
			.update(`anthropic_user_${sessionId}`)
			.digest('hex');
		persistentUserId = `user_${hash}_account__session_${sessionId}`;
	}
	return persistentUserId;
}

/**
 * Convert OpenAI-style tools to Anthropic tool format
 * Adds cache_control to the last tool for prompt caching
 */
function convertToolsToAnthropic(
	tools?: ChatCompletionTool[],
): AnthropicTool[] | undefined {
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
					input_schema: tool.function.parameters as any,
				};
			}
			throw new Error('Invalid tool format');
		});

	// Do not add cache_control to tools to avoid TTL ordering issues
	// if (convertedTools.length > 0) {
	// 	const lastTool = convertedTools[convertedTools.length - 1];
	// 	(lastTool as any).cache_control = {type: 'ephemeral', ttl: '5m'};
	// }

	return convertedTools;
}

/**
 * Convert our ChatMessage format to Anthropic's message format
 * Adds cache_control to system prompt and last user message for prompt caching
 * @param messages - The messages to convert
 * @param includeBuiltinSystemPrompt - Whether to include builtin system prompt (default true)
 * @param customSystemPromptOverride - Allow override for sub-agents
 * @param cacheTTL - Cache TTL for prompt caching (default: '5m')
 */
function convertToAnthropicMessages(
	messages: ChatMessage[],
	includeBuiltinSystemPrompt: boolean = true,
	customSystemPromptOverride?: string, // Allow override for sub-agents
	cacheTTL: '5m' | '1h' = '5m', // Cache TTL configuration
	disableThinking: boolean = false, // When true, strip thinking blocks from messages
	planMode: boolean = false, // When true, use Plan mode system prompt
): {
	system?: any;
	messages: AnthropicMessageParam[];
} {
	const customSystemPrompt =
		customSystemPromptOverride || getCustomSystemPrompt();
	let systemContent: string | undefined;
	const anthropicMessages: AnthropicMessageParam[] = [];

	for (const msg of messages) {
		if (msg.role === 'system') {
			systemContent = msg.content;
			continue;
		}

		if (msg.role === 'tool' && msg.tool_call_id) {
			// Build tool_result content - can be text or array with images
			let toolResultContent: string | any[];

			if (msg.images && msg.images.length > 0) {
				// Multimodal tool result with images
				const contentArray: any[] = [];

				// Add text content first
				if (msg.content) {
					contentArray.push({
						type: 'text',
						text: msg.content,
					});
				}

				// Add images
				for (const image of msg.images) {
					contentArray.push({
						type: 'image',
						source: {
							type: 'base64',
							media_type: image.mimeType,
							data: image.data,
						},
					});
				}

				toolResultContent = contentArray;
			} else {
				// Text-only tool result
				toolResultContent = msg.content;
			}

			anthropicMessages.push({
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: msg.tool_call_id,
						content: toolResultContent,
					},
				],
			});
			continue;
		}

		if (msg.role === 'user' && msg.images && msg.images.length > 0) {
			const content: any[] = [];

			if (msg.content) {
				content.push({
					type: 'text',
					text: msg.content,
				});
			}

			for (const image of msg.images) {
				const base64Match = image.data.match(/^data:([^;]+);base64,(.+)$/);
				if (base64Match) {
					content.push({
						type: 'image',
						source: {
							type: 'base64',
							media_type: base64Match[1] || image.mimeType,
							data: base64Match[2] || '',
						},
					});
				}
			}

			anthropicMessages.push({
				role: 'user',
				content,
			});
			continue;
		}

		if (
			msg.role === 'assistant' &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			const content: any[] = [];

			// When thinking is enabled, thinking block must come first
			// Skip thinking block when disableThinking is true
			if (msg.thinking && !disableThinking) {
				// Use the complete thinking block object (includes signature)
				content.push(msg.thinking);
			}

			if (msg.content) {
				content.push({
					type: 'text',
					text: msg.content,
				});
			}

			for (const toolCall of msg.tool_calls) {
				content.push({
					type: 'tool_use',
					id: toolCall.id,
					name: toolCall.function.name,
					input: JSON.parse(toolCall.function.arguments),
				});
			}

			anthropicMessages.push({
				role: 'assistant',
				content,
			});
			continue;
		}

		if (msg.role === 'user' || msg.role === 'assistant') {
			// For assistant messages with thinking, convert to structured format
			// Skip thinking block when disableThinking is true
			if (msg.role === 'assistant' && msg.thinking && !disableThinking) {
				const content: any[] = [];

				// Thinking block must come first - use complete block object (includes signature)
				content.push(msg.thinking);

				// Then text content
				if (msg.content) {
					content.push({
						type: 'text',
						text: msg.content,
					});
				}

				anthropicMessages.push({
					role: 'assistant',
					content,
				});
			} else {
				anthropicMessages.push({
					role: msg.role,
					content: msg.content,
				});
			}
		}
	}

	// 如果配置了自定义系统提示词（最高优先级，始终添加）
	if (customSystemPrompt) {
		systemContent = customSystemPrompt;
		if (includeBuiltinSystemPrompt) {
			// 将默认系统提示词作为第一条用户消息
			anthropicMessages.unshift({
				role: 'user',
				content: [
					{
						type: 'text',
						text: getSystemPromptForMode(planMode),
						cache_control: {type: 'ephemeral', ttl: cacheTTL},
					},
				] as any,
			});
		}
	} else if (!systemContent && includeBuiltinSystemPrompt) {
		// 没有自定义系统提示词，但需要添加默认系统提示词
		systemContent = getSystemPromptForMode(planMode);
	}

	let lastUserMessageIndex = -1;
	for (let i = anthropicMessages.length - 1; i >= 0; i--) {
		if (anthropicMessages[i]?.role === 'user') {
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
			if (typeof lastMessage.content === 'string') {
				lastMessage.content = [
					{
						type: 'text',
						text: lastMessage.content,
						cache_control: {type: 'ephemeral', ttl: cacheTTL},
					} as any,
				];
			} else if (Array.isArray(lastMessage.content)) {
				const lastContentIndex = lastMessage.content.length - 1;
				if (lastContentIndex >= 0) {
					const lastContent = lastMessage.content[lastContentIndex] as any;
					lastContent.cache_control = {type: 'ephemeral', ttl: cacheTTL};
				}
			}
		}
	}

	const system = systemContent
		? [
				{
					type: 'text',
					text: systemContent,
					cache_control: {type: 'ephemeral', ttl: cacheTTL},
				},
		  ]
		: undefined;

	return {system, messages: anthropicMessages};
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
export async function* createStreamingAnthropicCompletion(
	options: AnthropicOptions,
	abortSignal?: AbortSignal,
	onRetry?: (error: Error, attempt: number, nextDelay: number) => void,
): AsyncGenerator<AnthropicStreamChunk, void, unknown> {
	yield* withRetryGenerator(
		async function* () {
			// Load configuration: if configProfile is specified, load it; otherwise use main config
			let config: ReturnType<typeof getOpenAiConfig>;
			if (options.configProfile) {
				try {
					const {loadProfile} = await import(
						'../utils/config/configManager.js'
					);
					const profileConfig = loadProfile(options.configProfile);
					if (profileConfig?.snowcfg) {
						config = profileConfig.snowcfg;
					} else {
						// Profile not found, fallback to main config
						config = getOpenAiConfig();
						logger.warn(
							`Profile ${options.configProfile} not found, using main config`,
						);
					}
				} catch (error) {
					// If loading profile fails, fallback to main config
					config = getOpenAiConfig();
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

			const {system, messages} = convertToAnthropicMessages(
				options.messages,
				options.includeBuiltinSystemPrompt !== false, // 默认为 true
				customSystemPromptContent, // 传递自定义系统提示词
				config.anthropicCacheTTL || '5m', // 使用配置的 TTL，默认 5m
				options.disableThinking || false, // Strip thinking blocks when thinking is disabled
				options.planMode || false, // Use Plan mode system prompt if enabled
			);

			// Use persistent userId that remains the same until application restart
			const userId = getPersistentUserId();

			const requestBody: any = {
				model: options.model || config.advancedModel,
				max_tokens: options.max_tokens || 4096,
				system,
				messages,
				tools: convertToolsToAnthropic(options.tools),
				metadata: {
					user_id: userId,
				},
				stream: true,
			};

			// Add thinking configuration if enabled and not explicitly disabled
			// When thinking is enabled, temperature must be 1
			// Note: agents and other internal tools should set disableThinking=true
			// Debug: Log thinking decision for troubleshooting
			if (config.thinking) {
				logger.debug('Thinking config check:', {
					configThinking: !!config.thinking,
					disableThinking: options.disableThinking,
					willEnableThinking: config.thinking && !options.disableThinking,
				});
			}
			if (config.thinking && !options.disableThinking) {
				requestBody.thinking = config.thinking;
				requestBody.temperature = 1;
			}

			// Use custom headers from options if provided, otherwise get from main config
			const customHeaders = options.customHeaders || getCustomHeaders();

			// Prepare headers
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'x-api-key': config.apiKey,
				Authorization: `Bearer ${config.apiKey}`,
				'anthropic-version': '2023-06-01',
				'x-snow': 'true',
				...customHeaders,
			};

			// Add beta parameter if configured
			// if (config.anthropicBeta) {
			// 	headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
			// }

			// Use configured baseUrl or default Anthropic URL
			const baseUrl =
				config.baseUrl && config.baseUrl !== 'https://api.openai.com/v1'
					? config.baseUrl
					: 'https://api.anthropic.com/v1';

			const url = config.anthropicBeta
				? `${baseUrl}/messages?beta=true`
				: `${baseUrl}/messages`;

			const fetchOptions = addProxyToFetchOptions(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(requestBody),
				signal: abortSignal,
			});

			const response = await fetch(url, fetchOptions);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			if (!response.body) {
				throw new Error('No response body from Anthropic API');
			}

			let contentBuffer = '';
			let thinkingTextBuffer = ''; // Accumulate thinking text content
			let thinkingSignature = ''; // Accumulate thinking signature
			let toolCallsBuffer: Map<
				string,
				{
					id: string;
					type: 'function';
					function: {
						name: string;
						arguments: string;
					};
				}
			> = new Map();
			let hasToolCalls = false;
			let usageData: UsageInfo | undefined;
			let blockIndexToId: Map<number, string> = new Map();
			let blockIndexToType: Map<number, string> = new Map(); // Track block types (text, thinking, tool_use)
			let completedToolBlocks = new Set<string>(); // Track which tool blocks have finished streaming

			for await (const event of parseSSEStream(response.body.getReader())) {
				if (abortSignal?.aborted) {
					return;
				}
				if (event.type === 'content_block_start') {
					const block = event.content_block;
					const blockIndex = event.index;

					// Track block type for later reference
					blockIndexToType.set(blockIndex, block.type);

					if (block.type === 'tool_use') {
						hasToolCalls = true;
						blockIndexToId.set(blockIndex, block.id);

						toolCallsBuffer.set(block.id, {
							id: block.id,
							type: 'function',
							function: {
								name: block.name,
								arguments: '',
							},
						});

						yield {
							type: 'tool_call_delta',
							delta: block.name,
						};
					}
					// Handle thinking block start (Extended Thinking feature)
					else if (block.type === 'thinking') {
						// Thinking block started - emit reasoning_started event
						yield {
							type: 'reasoning_started',
						};
					}
				} else if (event.type === 'content_block_delta') {
					const delta = event.delta;

					if (delta.type === 'text_delta') {
						const text = delta.text;
						contentBuffer += text;
						yield {
							type: 'content',
							content: text,
						};
					}

					// Handle thinking_delta (Extended Thinking feature)
					// Emit reasoning_delta event for thinking content
					if (delta.type === 'thinking_delta') {
						const thinkingText = delta.thinking;
						thinkingTextBuffer += thinkingText; // Accumulate thinking text
						yield {
							type: 'reasoning_delta',
							delta: thinkingText,
						};
					}

					// Handle signature_delta (Extended Thinking feature)
					// Signature is required for thinking blocks
					if (delta.type === 'signature_delta') {
						thinkingSignature += delta.signature; // Accumulate signature
					}

					if (delta.type === 'input_json_delta') {
						const jsonDelta = delta.partial_json;
						const blockIndex = event.index;
						const toolId = blockIndexToId.get(blockIndex);

						if (toolId) {
							const toolCall = toolCallsBuffer.get(toolId);
							if (toolCall) {
								// Filter out any XML-like tags that might be mixed in the JSON delta
								// This can happen when the model output contains XML that gets interpreted as JSON
								const cleanedDelta = jsonDelta.replace(
									/<\/?parameter[^>]*>/g,
									'',
								);

								if (cleanedDelta) {
									toolCall.function.arguments += cleanedDelta;

									yield {
										type: 'tool_call_delta',
										delta: cleanedDelta,
									};
								}
							}
						}
					}
				} else if (event.type === 'content_block_stop') {
					// Mark this block as completed
					const blockIndex = event.index;
					const toolId = blockIndexToId.get(blockIndex);
					if (toolId) {
						completedToolBlocks.add(toolId);
					}
				} else if (event.type === 'message_start') {
					if (event.message.usage) {
						usageData = {
							prompt_tokens: event.message.usage.input_tokens || 0,
							completion_tokens: event.message.usage.output_tokens || 0,
							total_tokens:
								(event.message.usage.input_tokens || 0) +
								(event.message.usage.output_tokens || 0),
							cache_creation_input_tokens: (event.message.usage as any)
								.cache_creation_input_tokens,
							cache_read_input_tokens: (event.message.usage as any)
								.cache_read_input_tokens,
						};
					}
				} else if (event.type === 'message_delta') {
					if (event.usage) {
						if (!usageData) {
							usageData = {
								prompt_tokens: 0,
								completion_tokens: 0,
								total_tokens: 0,
							};
						}
						// Update prompt_tokens if present in message_delta
						if (event.usage.input_tokens !== undefined) {
							usageData.prompt_tokens = event.usage.input_tokens;
						}
						usageData.completion_tokens = event.usage.output_tokens || 0;
						usageData.total_tokens =
							usageData.prompt_tokens + usageData.completion_tokens;
						if (
							(event.usage as any).cache_creation_input_tokens !== undefined
						) {
							usageData.cache_creation_input_tokens = (
								event.usage as any
							).cache_creation_input_tokens;
						}
						if ((event.usage as any).cache_read_input_tokens !== undefined) {
							usageData.cache_read_input_tokens = (
								event.usage as any
							).cache_read_input_tokens;
						}
					}
				}
			}

			if (hasToolCalls && toolCallsBuffer.size > 0) {
				const toolCalls = Array.from(toolCallsBuffer.values());
				for (const toolCall of toolCalls) {
					// Normalize the arguments
					let args = toolCall.function.arguments.trim();

					// If arguments is empty, use empty object
					if (!args) {
						args = '{}';
					}

					// Try to parse the JSON using the unified parseJsonWithFix utility
					if (completedToolBlocks.has(toolCall.id)) {
						// Tool block was completed, parse with fix and logging
						const parseResult = parseJsonWithFix(args, {
							toolName: toolCall.function.name,
							fallbackValue: {},
							logWarning: true,
							logError: true,
						});

						// Use the parsed data or fallback value
						toolCall.function.arguments = JSON.stringify(parseResult.data);
					} else {
						// Tool block wasn't completed, likely interrupted stream
						// Try to parse without logging errors (incomplete data is expected)
						const parseResult = parseJsonWithFix(args, {
							toolName: toolCall.function.name,
							fallbackValue: {},
							logWarning: false,
							logError: false,
						});

						if (!parseResult.success) {
							logger.warn(
								`Warning: Tool call ${toolCall.function.name} (${toolCall.id}) was incomplete. Using fallback data.`,
							);
						}

						toolCall.function.arguments = JSON.stringify(parseResult.data);
					}
				}

				yield {
					type: 'tool_calls',
					tool_calls: toolCalls,
				};
			}

			if (usageData) {
				// Save usage to file system at API layer
				saveUsageToFile(options.model, usageData);

				yield {
					type: 'usage',
					usage: usageData,
				};
			}
			// Return complete thinking block with signature if thinking content exists
			const thinkingBlock = thinkingTextBuffer
				? {
						type: 'thinking' as const,
						thinking: thinkingTextBuffer,
						signature: thinkingSignature || undefined,
				  }
				: undefined;

			yield {
				type: 'done',
				thinking: thinkingBlock,
			};
		},
		{
			abortSignal,
			onRetry,
		},
	);
}
