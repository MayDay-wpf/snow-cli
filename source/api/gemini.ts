import { GoogleGenAI } from '@google/genai';
import { getOpenAiConfig, getCustomSystemPrompt } from '../utils/apiConfig.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { withRetryGenerator } from '../utils/retryUtils.js';
import type { ChatMessage } from './chat.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface GeminiOptions {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	tools?: ChatCompletionTool[];
}

export interface UsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cache_creation_input_tokens?: number; // Tokens used to create cache (Anthropic)
	cache_read_input_tokens?: number; // Tokens read from cache (Anthropic)
	cached_tokens?: number; // Cached tokens from prompt_tokens_details (OpenAI)
}

export interface GeminiStreamChunk {
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

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
	if (!geminiClient) {
		const config = getOpenAiConfig();

		if (!config.apiKey) {
			throw new Error('Gemini API configuration is incomplete. Please configure API key first.');
		}

		// Create client configuration
		const clientConfig: any = {
			apiKey: config.apiKey
		};

		// Support custom baseUrl and headers for proxy servers
		if (config.baseUrl && config.baseUrl !== 'https://api.openai.com/v1') {
			clientConfig.httpOptions = {
				baseUrl: config.baseUrl,
				headers: {
					'x-goog-api-key': config.apiKey, // Gemini API requires this header
				}
			};
		}

		geminiClient = new GoogleGenAI(clientConfig);
	}

	return geminiClient;
}

export function resetGeminiClient(): void {
	geminiClient = null;
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
						required: params.required || []
					}
				};
			}
			throw new Error('Invalid tool format');
		});

	return [{ functionDeclarations }];
}

/**
 * Convert our ChatMessage format to Gemini's format
 */
function convertToGeminiMessages(messages: ChatMessage[]): { systemInstruction?: string; contents: any[] } {
	const customSystemPrompt = getCustomSystemPrompt();
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

			if (!msg.content) {
				responseData = {};
			} else {
				let contentToParse = msg.content;

				// Sometimes the content is double-encoded as JSON
				// First, try to parse it once
				try {
					const firstParse = JSON.parse(contentToParse);
					// If it's a string, it might be double-encoded, try parsing again
					if (typeof firstParse === 'string') {
						contentToParse = firstParse;
					}
				} catch {
					// Not JSON, use as-is
				}

				// Now parse or wrap the final content
				try {
					const parsed = JSON.parse(contentToParse);
					// If parsed result is an object (not array, not null), use it directly
					if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
						responseData = parsed;
					} else {
						// If it's a primitive, array, or null, wrap it
						responseData = { content: parsed };
					}
				} catch {
					// Not valid JSON, wrap the raw string
					responseData = { content: contentToParse };
				}
			}

			contents.push({
				role: 'user',
				parts: [{
					functionResponse: {
						name: functionName,
						response: responseData
					}
				}]
			});
			continue;
		}

		// Handle tool calls in assistant messages
		if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
			const parts: any[] = [];

			// Add text content if exists
			if (msg.content) {
				parts.push({ text: msg.content });
			}

			// Add function calls
			for (const toolCall of msg.tool_calls) {
				parts.push({
					functionCall: {
						name: toolCall.function.name,
						args: JSON.parse(toolCall.function.arguments)
					}
				});
			}

			contents.push({
				role: 'model',
				parts
			});
			continue;
		}

		// Build message parts
		const parts: any[] = [];

		// Add text content
		if (msg.content) {
			parts.push({ text: msg.content });
		}

		// Add images for user messages
		if (msg.role === 'user' && msg.images && msg.images.length > 0) {
			for (const image of msg.images) {
				const base64Match = image.data.match(/^data:([^;]+);base64,(.+)$/);
				if (base64Match) {
					parts.push({
						inlineData: {
							mimeType: base64Match[1] || image.mimeType,
							data: base64Match[2] || ''
						}
					});
				}
			}
		}

		// Add to contents
		const role = msg.role === 'assistant' ? 'model' : 'user';
		contents.push({ role, parts });
	}

	// Handle system instruction
	if (customSystemPrompt) {
		systemInstruction = customSystemPrompt;
		// Prepend default system prompt as first user message
		contents.unshift({
			role: 'user',
			parts: [{ text: SYSTEM_PROMPT }]
		});
	} else if (!systemInstruction) {
		systemInstruction = SYSTEM_PROMPT;
	}

	return { systemInstruction, contents };
}

/**
 * Create streaming chat completion using Gemini API
 */
export async function* createStreamingGeminiCompletion(
	options: GeminiOptions,
	abortSignal?: AbortSignal,
	onRetry?: (error: Error, attempt: number, nextDelay: number) => void
): AsyncGenerator<GeminiStreamChunk, void, unknown> {
	const client = getGeminiClient();

	// 使用重试包装生成器
	yield* withRetryGenerator(
		async function* () {
			const { systemInstruction, contents } = convertToGeminiMessages(options.messages);

		// Build request config
		const requestConfig: any = {
			model: options.model,
			contents,
			config: {
				systemInstruction,
				temperature: options.temperature ?? 0.7,
			}
		};

		// Add tools if provided
		const geminiTools = convertToolsToGemini(options.tools);
		if (geminiTools) {
			requestConfig.config.tools = geminiTools;
		}

		// Stream the response
		const stream = await client.models.generateContentStream(requestConfig);

		let contentBuffer = '';
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
		let totalTokens = { prompt: 0, completion: 0, total: 0 };

		// Save original console.warn to suppress SDK warnings
		const originalWarn = console.warn;
		console.warn = () => {}; // Suppress "there are non-text parts" warnings

		for await (const chunk of stream) {
			if (abortSignal?.aborted) {
				console.warn = originalWarn; // Restore console.warn
				return;
			}

			// Process text content
			if (chunk.text) {
				contentBuffer += chunk.text;
				yield {
					type: 'content',
					content: chunk.text
				};
			}

			// Process function calls using the official API
			if (chunk.functionCalls && chunk.functionCalls.length > 0) {
				hasToolCalls = true;
				for (const fc of chunk.functionCalls) {
					if (!fc.name) continue;

					const toolCall = {
						id: `call_${toolCallIndex++}`,
						type: 'function' as const,
						function: {
							name: fc.name,
							arguments: JSON.stringify(fc.args)
						}
					};
					toolCallsBuffer.push(toolCall);

					// Yield delta for token counting
					const deltaText = fc.name + JSON.stringify(fc.args);
					yield {
						type: 'tool_call_delta',
						delta: deltaText
					};
				}
			}

			// Track usage info
			if (chunk.usageMetadata) {
				totalTokens = {
					prompt: chunk.usageMetadata.promptTokenCount || 0,
					completion: chunk.usageMetadata.candidatesTokenCount || 0,
					total: chunk.usageMetadata.totalTokenCount || 0
				};
			}
		}

		// Restore console.warn
		console.warn = originalWarn;

		// Yield tool calls if any
		if (hasToolCalls && toolCallsBuffer.length > 0) {
			yield {
				type: 'tool_calls',
				tool_calls: toolCallsBuffer
			};
		}

		// Yield usage info
		if (totalTokens.total > 0) {
			yield {
				type: 'usage',
				usage: {
					prompt_tokens: totalTokens.prompt,
					completion_tokens: totalTokens.completion,
					total_tokens: totalTokens.total
				}
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
