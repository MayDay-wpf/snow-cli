import { GoogleGenerativeAI, Part, Content, FunctionDeclaration, Tool } from '@google/generative-ai';
import { getOpenAiConfig } from '../utils/apiConfig.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
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

let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
	if (!geminiClient) {
		const config = getOpenAiConfig();

		if (!config.apiKey) {
			throw new Error('Gemini API configuration is incomplete. Please configure API key first.');
		}

		geminiClient = new GoogleGenerativeAI(config.apiKey);
	}

	return geminiClient;
}

export function resetGeminiClient(): void {
	geminiClient = null;
}

/**
 * Convert OpenAI-style tools to Gemini function declarations
 */
function convertToolsToGemini(tools?: ChatCompletionTool[]): Tool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const functionDeclarations: FunctionDeclaration[] = tools
		.filter(tool => tool.type === 'function' && 'function' in tool)
		.map(tool => {
			if (tool.type === 'function' && 'function' in tool) {
				return {
					name: tool.function.name,
					description: tool.function.description || '',
					parameters: tool.function.parameters as any
				};
			}
			throw new Error('Invalid tool format');
		});

	return [{ functionDeclarations }];
}

/**
 * Convert our ChatMessage format to Gemini's Content format
 * Logic:
 * 1. If custom system prompt exists: use custom as systemInstruction, prepend default as first user message
 * 2. If no custom system prompt: use default as systemInstruction
 */
function convertToGeminiMessages(messages: ChatMessage[]): { systemInstruction?: string; contents: Content[] } {
	const config = getOpenAiConfig();
	const customSystemPrompt = config.systemPrompt;
	let systemInstruction: string | undefined;
	const contents: Content[] = [];

	for (const msg of messages) {
		// Extract system message as systemInstruction
		if (msg.role === 'system') {
			systemInstruction = msg.content;
			continue;
		}

		// Skip tool messages for now (Gemini handles them differently)
		if (msg.role === 'tool') {
			// Tool results in Gemini are represented as function response parts
			const parts: Part[] = [{
				functionResponse: {
					name: 'function_name', // This should be mapped from tool_call_id
					response: {
						content: msg.content
					}
				}
			}];

			contents.push({
				role: 'function',
				parts
			});
			continue;
		}

		// Convert user/assistant messages
		const parts: Part[] = [];

		// Add text content
		if (msg.content) {
			parts.push({ text: msg.content });
		}

		// Add images for user messages
		if (msg.role === 'user' && msg.images && msg.images.length > 0) {
			for (const image of msg.images) {
				// Extract base64 data and mime type
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

		// Handle tool calls in assistant messages
		if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
			for (const toolCall of msg.tool_calls) {
				parts.push({
					functionCall: {
						name: toolCall.function.name,
						args: JSON.parse(toolCall.function.arguments)
					}
				});
			}
		}

		// Map role (Gemini uses 'user' and 'model' instead of 'user' and 'assistant')
		const role = msg.role === 'assistant' ? 'model' : 'user';

		contents.push({
			role,
			parts
		});
	}

	// 如果配置了自定义系统提示词
	if (customSystemPrompt) {
		// 自定义系统提示词作为 systemInstruction，默认系统提示词作为第一条用户消息
		systemInstruction = customSystemPrompt;
		contents.unshift({
			role: 'user',
			parts: [{ text: SYSTEM_PROMPT }]
		});
	} else if (!systemInstruction) {
		// 没有自定义系统提示词，默认系统提示词作为 systemInstruction
		systemInstruction = SYSTEM_PROMPT;
	}

	return { systemInstruction, contents };
}

/**
 * Create streaming chat completion using Gemini API
 */
export async function* createStreamingGeminiCompletion(
	options: GeminiOptions,
	abortSignal?: AbortSignal
): AsyncGenerator<GeminiStreamChunk, void, unknown> {
	const client = getGeminiClient();
	const config = getOpenAiConfig();

	try {
		const { systemInstruction, contents } = convertToGeminiMessages(options.messages);

		// Initialize the model with optional custom baseUrl
		// Note: For Gemini API, baseUrl should be in format: https://your-proxy.com/v1beta
		// Default is: https://generativelanguage.googleapis.com/v1beta
		const modelConfig: any = {
			model: options.model,
			systemInstruction,
			tools: convertToolsToGemini(options.tools),
			generationConfig: {
				temperature: options.temperature ?? 0.7,
			}
		};

		// Support custom baseUrl for proxy servers
		const requestOptions: any = {};
		if (config.baseUrl && config.baseUrl !== 'https://api.openai.com/v1') {
			// Only set custom baseUrl if it's not the default OpenAI URL
			requestOptions.baseUrl = config.baseUrl;
		}

		const model = client.getGenerativeModel(modelConfig, requestOptions);

		// Start chat session
		const chat = model.startChat({
			history: contents.slice(0, -1), // All messages except the last one
		});

		// Get the last user message
		const lastMessage = contents[contents.length - 1];
		if (!lastMessage) {
			throw new Error('No user message found');
		}

		// Stream the response
		const result = await chat.sendMessageStream(lastMessage.parts);

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

		for await (const chunk of result.stream) {
			if (abortSignal?.aborted) {
				return;
			}

			const candidate = chunk.candidates?.[0];
			if (!candidate) continue;

			// Process text content
			const text = chunk.text();
			if (text) {
				contentBuffer += text;
				yield {
					type: 'content',
					content: text
				};
			}

			// Process function calls (tool calls)
			const functionCalls = candidate.content?.parts?.filter(part => 'functionCall' in part);
			if (functionCalls && functionCalls.length > 0) {
				hasToolCalls = true;
				for (const fc of functionCalls) {
					if ('functionCall' in fc && fc.functionCall) {
						const toolCall = {
							id: `call_${toolCallIndex++}`,
							type: 'function' as const,
							function: {
								name: fc.functionCall.name,
								arguments: JSON.stringify(fc.functionCall.args)
							}
						};
						toolCallsBuffer.push(toolCall);

						// Yield delta for token counting
						const deltaText = fc.functionCall.name + JSON.stringify(fc.functionCall.args);
						yield {
							type: 'tool_call_delta',
							delta: deltaText
						};
					}
				}
			}
		}

		// Yield tool calls if any
		if (hasToolCalls && toolCallsBuffer.length > 0) {
			yield {
				type: 'tool_calls',
				tool_calls: toolCallsBuffer
			};
		}

		// Get final response for usage info
		const finalResponse = await result.response;
		const usageMetadata = finalResponse.usageMetadata;

		if (usageMetadata) {
			yield {
				type: 'usage',
				usage: {
					prompt_tokens: usageMetadata.promptTokenCount || 0,
					completion_tokens: usageMetadata.candidatesTokenCount || 0,
					total_tokens: usageMetadata.totalTokenCount || 0
				}
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
			throw new Error(`Gemini streaming completion failed: ${error.message}`);
		}
		throw new Error('Gemini streaming completion failed: Unknown error');
	}
}
