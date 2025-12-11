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
import type {ChatMessage, ChatCompletionTool, UsageInfo} from './types.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';
import {saveUsageToFile} from '../utils/core/usageLogger.js';

export interface GeminiOptions {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	tools?: ChatCompletionTool[];
	includeBuiltinSystemPrompt?: boolean; // 控制是否添加内置系统提示词（默认 true）
	planMode?: boolean; // 启用 Plan 模式（使用 Plan 模式系统提示词）
	// Sub-agent configuration overrides
	configProfile?: string; // 子代理配置文件名（覆盖模型等设置）
	customSystemPromptId?: string; // 自定义系统提示词 ID
	customHeaders?: Record<string, string>; // 自定义请求头
}

export interface GeminiStreamChunk {
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
	};
}

// Deprecated: No longer used, kept for backward compatibility
// @ts-ignore - Variable kept for backward compatibility with resetGeminiClient export
let geminiConfig: {
	apiKey: string;
	baseUrl: string;
	customHeaders: Record<string, string>;
	geminiThinking?: {
		enabled: boolean;
		budget: number;
	};
} | null = null;

// Deprecated: Client reset is no longer needed with new config loading approach
export function resetGeminiClient(): void {
	geminiConfig = null;
}

/**
 * Convert OpenAI-style tools to Gemini function declarations
 */
function convertToolsToGemini(tools?: ChatCompletionTool[]): any[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const functionDeclarations = tools
		.filter(tool => tool.type === 'function' && 'function' in tool)
		.map(tool => {
			if (tool.type === 'function' && 'function' in tool) {
				// Convert OpenAI parameters schema to Gemini format
				const params = tool.function.parameters as any;

				return {
					name: tool.function.name,
					description: tool.function.description || '',
					parametersJsonSchema: {
						type: 'object',
						properties: params.properties || {},
						required: params.required || [],
					},
				};
			}
			throw new Error('Invalid tool format');
		});

	return [{functionDeclarations}];
}

/**
 * Convert our ChatMessage format to Gemini's format
 * @param messages - The messages to convert
 * @param includeBuiltinSystemPrompt - Whether to include builtin system prompt (default true)
 */
function convertToGeminiMessages(
	messages: ChatMessage[],
	includeBuiltinSystemPrompt: boolean = true,
	customSystemPromptOverride?: string, // Allow override for sub-agents
	planMode: boolean = false, // When true, use Plan mode system prompt
): {
	systemInstruction?: string;
	contents: any[];
} {
	const customSystemPrompt =
		customSystemPromptOverride || getCustomSystemPrompt();
	let systemInstruction: string | undefined;
	const contents: any[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;

		// Extract system message as systemInstruction
		if (msg.role === 'system') {
			systemInstruction = msg.content;
			continue;
		}

		// Handle tool results
		if (msg.role === 'tool') {
			// Find the corresponding function call to get the function name
			// Look backwards in contents to find the matching tool call
			let functionName = 'unknown_function';
			for (let j = contents.length - 1; j >= 0; j--) {
				const contentMsg = contents[j];
				if (contentMsg.role === 'model' && contentMsg.parts) {
					for (const part of contentMsg.parts) {
						if (part.functionCall) {
							functionName = part.functionCall.name;
							break;
						}
					}
					if (functionName !== 'unknown_function') break;
				}
			}

			// Tool response must be a valid object for Gemini API
			// If content is a JSON string, parse it; otherwise wrap it in an object
			let responseData: any;
			const imageParts: any[] = [];

			// Handle images from tool result
			if (msg.images && msg.images.length > 0) {
				for (const image of msg.images) {
					imageParts.push({
						inlineData: {
							mimeType: image.mimeType,
							data: image.data,
						},
					});
				}
			}

			if (!msg.content) {
				responseData = {};
			} else {
				let contentToParse = msg.content;

				// Sometimes the content is double-encoded as JSON
				// First, try to parse it once
				const firstParseResult = parseJsonWithFix(contentToParse, {
					toolName: 'Gemini tool response (first parse)',
					logWarning: false,
					logError: false,
				});

				if (
					firstParseResult.success &&
					typeof firstParseResult.data === 'string'
				) {
					// If it's a string, it might be double-encoded, try parsing again
					contentToParse = firstParseResult.data;
				}

				// Now parse or wrap the final content
				const finalParseResult = parseJsonWithFix(contentToParse, {
					toolName: 'Gemini tool response (final parse)',
					logWarning: false,
					logError: false,
				});

				if (finalParseResult.success) {
					const parsed = finalParseResult.data;
					// If parsed result is an object (not array, not null), use it directly
					if (
						typeof parsed === 'object' &&
						parsed !== null &&
						!Array.isArray(parsed)
					) {
						responseData = parsed;
					} else {
						// If it's a primitive, array, or null, wrap it
						responseData = {content: parsed};
					}
				} else {
					// Not valid JSON, wrap the raw string
					responseData = {content: contentToParse};
				}
			}

			// Build parts array with functionResponse and optional images
			const parts: any[] = [
				{
					functionResponse: {
						name: functionName,
						response: responseData,
					},
				},
			];

			// Add images as inline data parts
			if (imageParts.length > 0) {
				parts.push(...imageParts);
			}

			contents.push({
				role: 'user',
				parts,
			});
			continue;
		}

		// Handle tool calls in assistant messages
		if (
			msg.role === 'assistant' &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			const parts: any[] = [];

			// Add text content if exists
			if (msg.content) {
				parts.push({text: msg.content});
			}

			// Add function calls
			for (const toolCall of msg.tool_calls) {
				const argsParseResult = parseJsonWithFix(toolCall.function.arguments, {
					toolName: `Gemini function call: ${toolCall.function.name}`,
					fallbackValue: {},
					logWarning: true,
					logError: true,
				});

				parts.push({
					functionCall: {
						name: toolCall.function.name,
						args: argsParseResult.data,
					},
				});
			}

			contents.push({
				role: 'model',
				parts,
			});
			continue;
		}

		// Build message parts
		const parts: any[] = [];

		// Add text content
		if (msg.content) {
			parts.push({text: msg.content});
		}

		// Add images for user messages
		if (msg.role === 'user' && msg.images && msg.images.length > 0) {
			for (const image of msg.images) {
				const base64Match = image.data.match(/^data:([^;]+);base64,(.+)$/);
				if (base64Match) {
					parts.push({
						inlineData: {
							mimeType: base64Match[1] || image.mimeType,
							data: base64Match[2] || '',
						},
					});
				}
			}
		}

		// Add to contents
		const role = msg.role === 'assistant' ? 'model' : 'user';
		contents.push({role, parts});
	}

	// Handle system instruction
	// 如果配置了自定义系统提示词（最高优先级，始终添加）
	if (customSystemPrompt) {
		systemInstruction = customSystemPrompt;
		if (includeBuiltinSystemPrompt) {
			// Prepend default system prompt as first user message
			contents.unshift({
				role: 'user',
				parts: [{text: getSystemPromptForMode(planMode)}],
			});
		}
	} else if (!systemInstruction && includeBuiltinSystemPrompt) {
		// 没有自定义系统提示词，但需要添加默认系统提示词
		systemInstruction = getSystemPromptForMode(planMode);
	}

	return {systemInstruction, contents};
}

/**
 * Create streaming chat completion using Gemini API
 */
export async function* createStreamingGeminiCompletion(
	options: GeminiOptions,
	abortSignal?: AbortSignal,
	onRetry?: (error: Error, attempt: number, nextDelay: number) => void,
): AsyncGenerator<GeminiStreamChunk, void, unknown> {
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
			const {systemInstruction, contents} = convertToGeminiMessages(
				options.messages,
				options.includeBuiltinSystemPrompt !== false, // 默认为 true
				customSystemPromptContent, // 传递自定义系统提示词
				options.planMode || false, // Pass planMode to use correct system prompt
			);

			// Build request payload
			const requestBody: any = {
				contents,
				systemInstruction: systemInstruction
					? {parts: [{text: systemInstruction}]}
					: undefined,
			};

			// Add thinking configuration if enabled
			// Only include generationConfig when thinking is enabled
			if (config.geminiThinking?.enabled) {
				requestBody.generationConfig = {
					thinkingConfig: {
						thinkingBudget: config.geminiThinking.budget,
					},
				};
			}

			// Add tools if provided
			const geminiTools = convertToolsToGemini(options.tools);
			if (geminiTools) {
				requestBody.tools = geminiTools;
			}

			// Extract model name from options.model (e.g., "gemini-pro" or "models/gemini-pro")
			const effectiveModel = options.model || config.advancedModel || '';
			const modelName = effectiveModel.startsWith('models/')
				? effectiveModel
				: `models/${effectiveModel}`;

			// Use configured baseUrl or default Gemini URL
			const baseUrl =
				config.baseUrl && config.baseUrl !== 'https://api.openai.com/v1'
					? config.baseUrl
					: 'https://generativelanguage.googleapis.com/v1beta';

			const url = `${baseUrl}/${modelName}:streamGenerateContent?key=${config.apiKey}&alt=sse`;

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

			let response: Response;
			try {
				response = await fetch(url, fetchOptions);
			} catch (error) {
				// 捕获 fetch 底层错误（网络错误、连接超时等）
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				throw new Error(
					`Gemini API fetch failed: ${errorMessage}\n` +
						`URL: ${url}\n` +
						`Model: ${effectiveModel}\n` +
						`Error type: ${
							error instanceof TypeError
								? 'Network/Connection Error'
								: 'Unknown Error'
						}\n` +
						`Possible causes: Network unavailable, DNS resolution failed, proxy issues, or server unreachable`,
				);
			}

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			if (!response.body) {
				throw new Error('No response body from Gemini API');
			}

			let contentBuffer = '';
			let thinkingTextBuffer = ''; // Accumulate thinking text content
			let toolCallsBuffer: Array<{
				id: string;
				type: 'function';
				function: {
					name: string;
					arguments: string;
				};
			}> = [];
			let hasToolCalls = false;
			let toolCallIndex = 0;
			let totalTokens = {prompt: 0, completion: 0, total: 0};

			// Parse SSE stream
			const reader = response.body.getReader();
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

					if (abortSignal?.aborted) {
						return;
					}

					buffer += decoder.decode(value, {stream: true});
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith(':')) continue;

						if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
							break;
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
								toolName: 'Gemini SSE stream',
								logWarning: false,
								logError: true,
							});

							if (parseResult.success) {
								const chunk = parseResult.data;

								// Process candidates
								if (chunk.candidates && chunk.candidates.length > 0) {
									const candidate = chunk.candidates[0];
									if (candidate.content && candidate.content.parts) {
										for (const part of candidate.content.parts) {
											// Process thought content (Gemini thinking)
											// When part.thought === true, the text field contains thinking content
											if (part.thought === true && part.text) {
												thinkingTextBuffer += part.text;
												yield {
													type: 'reasoning_delta',
													delta: part.text,
												};
											}
											// Process regular text content (when thought is not true)
											else if (part.text) {
												contentBuffer += part.text;
												yield {
													type: 'content',
													content: part.text,
												};
											}

											// Process function calls
											if (part.functionCall) {
												hasToolCalls = true;
												const fc = part.functionCall;

												const toolCall = {
													id: `call_${toolCallIndex++}`,
													type: 'function' as const,
													function: {
														name: fc.name,
														arguments: JSON.stringify(fc.args || {}),
													},
												};
												toolCallsBuffer.push(toolCall);

												// Yield delta for token counting
												const deltaText =
													fc.name + JSON.stringify(fc.args || {});
												yield {
													type: 'tool_call_delta',
													delta: deltaText,
												};
											}
										}
									}
								}

								// Track usage info
								if (chunk.usageMetadata) {
									totalTokens = {
										prompt: chunk.usageMetadata.promptTokenCount || 0,
										completion: chunk.usageMetadata.candidatesTokenCount || 0,
										total: chunk.usageMetadata.totalTokenCount || 0,
									};
								}
							}
						}
					}
				}
			} catch (error) {
				const {logger} = await import('../utils/core/logger.js');
				logger.error('Gemini SSE stream parsing error:', {
					error: error instanceof Error ? error.message : 'Unknown error',
					remainingBuffer: buffer.substring(0, 200),
				});
				throw error;
			}

			// Yield tool calls if any
			if (hasToolCalls && toolCallsBuffer.length > 0) {
				yield {
					type: 'tool_calls',
					tool_calls: toolCallsBuffer,
				};
			}

			// Yield usage info
			if (totalTokens.total > 0) {
				const usageData = {
					prompt_tokens: totalTokens.prompt,
					completion_tokens: totalTokens.completion,
					total_tokens: totalTokens.total,
				};

				// Save usage to file system at API layer
				saveUsageToFile(options.model, usageData);

				yield {
					type: 'usage',
					usage: usageData,
				};
			}

			// Return complete thinking block if thinking content exists
			const thinkingBlock = thinkingTextBuffer
				? {
						type: 'thinking' as const,
						thinking: thinkingTextBuffer,
				  }
				: undefined;

			// Signal completion
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
