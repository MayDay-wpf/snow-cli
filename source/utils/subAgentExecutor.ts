import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingChatCompletion} from '../api/chat.js';
import {getSubAgent} from './subAgentConfig.js';
import {collectAllMCPTools, executeMCPTool} from './mcpToolsManager.js';
import {getOpenAiConfig} from './apiConfig.js';
import {sessionManager} from './sessionManager.js';
import type {MCPTool} from './mcpToolsManager.js';
import type {ChatMessage} from '../api/types.js';

export interface SubAgentMessage {
	type: 'sub_agent_message';
	agentId: string;
	agentName: string;
	message: any; // Stream event from anthropic API
}

export interface SubAgentResult {
	success: boolean;
	result: string;
	error?: string;
}

export interface ToolConfirmationCallback {
	(toolName: string, toolArgs: any): Promise<string>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

export interface AddToAlwaysApprovedCallback {
	(toolName: string): void;
}

/**
 * Execute a sub-agent as a tool
 * @param agentId - The ID of the sub-agent to execute
 * @param prompt - The task prompt to send to the sub-agent
 * @param onMessage - Callback for streaming sub-agent messages (for UI display)
 * @param abortSignal - Optional abort signal
 * @param requestToolConfirmation - Callback to request tool confirmation from user
 * @param isToolAutoApproved - Function to check if a tool is auto-approved
 * @param yoloMode - Whether YOLO mode is enabled (auto-approve all tools)
 * @returns The final result from the sub-agent
 */
export async function executeSubAgent(
	agentId: string,
	prompt: string,
	onMessage?: (message: SubAgentMessage) => void,
	abortSignal?: AbortSignal,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
): Promise<SubAgentResult> {
	try {
		// Get sub-agent configuration
		const agent = getSubAgent(agentId);
		if (!agent) {
			return {
				success: false,
				result: '',
				error: `Sub-agent with ID "${agentId}" not found`,
			};
		}

		// Get all available tools
		const allTools = await collectAllMCPTools();

		// Filter tools based on sub-agent's allowed tools
		const allowedTools = allTools.filter((tool: MCPTool) => {
			const toolName = tool.function.name;
			return agent.tools.some(allowedTool => {
				// Normalize both tool names: replace underscores with hyphens for comparison
				const normalizedToolName = toolName.replace(/_/g, '-');
				const normalizedAllowedTool = allowedTool.replace(/_/g, '-');

				// Support both exact match and prefix match (e.g., "filesystem" matches "filesystem-read")
				return (
					normalizedToolName === normalizedAllowedTool ||
					normalizedToolName.startsWith(`${normalizedAllowedTool}-`)
				);
			});
		});

		if (allowedTools.length === 0) {
			return {
				success: false,
				result: '',
				error: `Sub-agent "${agent.name}" has no valid tools configured`,
			};
		}

		// Build conversation history for sub-agent
		// Append role to prompt if configured
		let finalPrompt = prompt;
		if (agent.role) {
			finalPrompt = `${prompt}\n\n${agent.role}`;
		}

		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: finalPrompt,
			},
		];

		// Stream sub-agent execution
		let finalResponse = '';
		let hasError = false;
		let errorMessage = '';

		// Local session-approved tools for this sub-agent execution
		// This ensures tools approved during execution are immediately recognized
		const sessionApprovedTools = new Set<string>();

		// eslint-disable-next-line no-constant-condition
		while (true) {
			// Check abort signal
			if (abortSignal?.aborted) {
				return {
					success: false,
					result: finalResponse,
					error: 'Sub-agent execution aborted',
				};
			}

			// Get API configuration
			const config = getOpenAiConfig();
			const currentSession = sessionManager.getCurrentSession();
			const model = config.advancedModel || 'gpt-5';

			// Call API with sub-agent's tools - choose API based on config
			const stream =
				config.requestMethod === 'anthropic'
					? createStreamingAnthropicCompletion(
							{
								model,
								messages,
								temperature: 0,
								max_tokens: config.maxTokens || 4096,
								tools: allowedTools,
								sessionId: currentSession?.id,
								disableThinking: true, // Sub-agents 不使用 Extended Thinking
							},
							abortSignal,
					  )
					: config.requestMethod === 'gemini'
					? createStreamingGeminiCompletion(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
							},
							abortSignal,
					  )
					: config.requestMethod === 'responses'
					? createStreamingResponse(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
								prompt_cache_key: currentSession?.id,
							},
							abortSignal,
					  )
					: createStreamingChatCompletion(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
							},
							abortSignal,
					  );

			let currentContent = '';
			let toolCalls: any[] = [];

			for await (const event of stream) {
				// Forward message to UI (but don't save to main conversation)
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: event,
					});
				}

				if (event.type === 'content' && event.content) {
					currentContent += event.content;
				} else if (event.type === 'tool_calls' && event.tool_calls) {
					toolCalls = event.tool_calls;
				}
			}

			if (hasError) {
				return {
					success: false,
					result: finalResponse,
					error: errorMessage,
				};
			}

			// Add assistant response to conversation
			if (currentContent || toolCalls.length > 0) {
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: currentContent || '',
				};

				if (toolCalls.length > 0) {
					assistantMessage.tool_calls = toolCalls;
				}

				messages.push(assistantMessage);
				finalResponse = currentContent;
			}

			// If no tool calls, we're done
			if (toolCalls.length === 0) {
				break;
			}

			// Check tool approvals before execution
			const approvedToolCalls: typeof toolCalls = [];
			const rejectedToolCalls: typeof toolCalls = [];

			for (const toolCall of toolCalls) {
				const toolName = toolCall.function.name;
				let args: any;
				try {
					args = JSON.parse(toolCall.function.arguments);
				} catch (e) {
					args = {};
				}

				// Check if tool needs confirmation
				let needsConfirmation = true;

				// In YOLO mode, auto-approve all tools
				if (yoloMode) {
					needsConfirmation = false;
				}
				// Check if tool is in auto-approved list (global or session)
				else if (
					sessionApprovedTools.has(toolName) ||
					(isToolAutoApproved && isToolAutoApproved(toolName))
				) {
					needsConfirmation = false;
				}

				if (needsConfirmation && requestToolConfirmation) {
					// Request confirmation from user
					const confirmation = await requestToolConfirmation(toolName, args);

					if (confirmation === 'reject') {
						rejectedToolCalls.push(toolCall);
						continue;
					}
					// If approve_always, add to both global and session lists
					if (confirmation === 'approve_always') {
						// Add to local session set (immediate effect)
						sessionApprovedTools.add(toolName);
						// Add to global list (persistent across sub-agent calls)
						if (addToAlwaysApproved) {
							addToAlwaysApproved(toolName);
						}
					}
				}

				approvedToolCalls.push(toolCall);
			}

			// Handle rejected tools
			if (rejectedToolCalls.length > 0) {
				return {
					success: false,
					result: finalResponse,
					error: `User rejected tool execution: ${rejectedToolCalls
						.map(tc => tc.function.name)
						.join(', ')}`,
				};
			}

			// Execute approved tool calls
			const toolResults: ChatMessage[] = [];
			for (const toolCall of approvedToolCalls) {
				try {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await executeMCPTool(
						toolCall.function.name,
						args,
						abortSignal,
					);

					const toolResult = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: JSON.stringify(result),
					};
					toolResults.push(toolResult);

					// Send tool result to UI
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: JSON.stringify(result),
							} as any,
						});
					}
				} catch (error) {
					const errorResult = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: `Error: ${
							error instanceof Error ? error.message : 'Tool execution failed'
						}`,
					};
					toolResults.push(errorResult);

					// Send error result to UI
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: `Error: ${
									error instanceof Error
										? error.message
										: 'Tool execution failed'
								}`,
							} as any,
						});
					}
				}
			}

			// Add tool results to conversation
			messages.push(...toolResults);

			// Continue to next iteration if there were tool calls
			// The loop will continue until no more tool calls
		}

		return {
			success: true,
			result: finalResponse,
		};
	} catch (error) {
		return {
			success: false,
			result: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}
