import { createStreamingAnthropicCompletion } from '../../api/anthropic.js';
import { createStreamingResponse } from '../../api/responses.js';
import { createStreamingGeminiCompletion } from '../../api/gemini.js';
import { createStreamingChatCompletion } from '../../api/chat.js';
import { getSubAgent } from '../config/subAgentConfig.js';
import { collectAllMCPTools, executeMCPTool } from './mcpToolsManager.js';
import { getOpenAiConfig } from '../config/apiConfig.js';
import { sessionManager } from '../session/sessionManager.js';
import { unifiedHooksExecutor } from './unifiedHooksExecutor.js';
import type { MCPTool } from './mcpToolsManager.js';
import type { ChatMessage } from '../../api/types.js';
import type { ConfirmationResult } from '../../ui/components/ToolConfirmation.js';

export interface SubAgentMessage {
	type: 'sub_agent_message';
	agentId: string;
	agentName: string;
	message: any; // Stream event from anthropic API
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
}

export interface SubAgentResult {
	success: boolean;
	result: string;
	error?: string;
	usage?: TokenUsage;
}

export interface ToolConfirmationCallback {
	(toolName: string, toolArgs: any): Promise<ConfirmationResult>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

export interface AddToAlwaysApprovedCallback {
	(toolName: string): void;
}

/**
 * 用户问题回调接口
 * 用于子智能体调用 askuser 工具时，请求主会话显示蓝色边框的 AskUserQuestion 组件
 * @param question - 问题文本
 * @param options - 选项列表
 * @returns 用户选择的结果
 */
export interface UserQuestionCallback {
	(question: string, options: string[]): Promise<{
		selected: string;
		customInput?: string;
	}>;
}

/**
 * 执行子智能体作为工具
 * @param agentId - 子智能体 ID
 * @param prompt - 发送给子智能体的任务提示
 * @param onMessage - 流式消息回调（用于 UI 显示）
 * @param abortSignal - 可选的中止信号
 * @param requestToolConfirmation - 工具确认回调
 * @param isToolAutoApproved - 检查工具是否自动批准
 * @param yoloMode - 是否启用 YOLO 模式（自动批准所有工具）
 * @param addToAlwaysApproved - 添加工具到始终批准列表的回调
 * @param requestUserQuestion - 用户问题回调，用于子智能体调用 askuser 工具时显示主会话的蓝色边框 UI
 * @returns 子智能体的最终结果
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
	requestUserQuestion?: UserQuestionCallback,
): Promise<SubAgentResult> {
	try {
		// Handle built-in agents (hardcoded)
		let agent: any;
		if (agentId === 'agent_explore') {
			agent = {
				id: 'agent_explore',
				name: 'Explore Agent',
				description:
					'Specialized for quickly exploring and understanding codebases. Excels at searching code, finding definitions, analyzing code structure and semantic understanding.',
				role: 'You are a specialized code exploration agent. Your task is to help users understand codebase structure, locate specific code, and analyze dependencies. Use search and analysis tools to explore code, but do not modify any files or execute commands. Focus on code discovery and understanding.\n\nIMPORTANT: You have NO access to the main conversation history. The prompt provided to you contains ALL the context from the main session. Read it carefully - all file locations, business requirements, constraints, and discovered information are included in the prompt. Do not assume any additional context.',
				tools: [
					// Filesystem read-only tools
					'filesystem-read',
					// ACE code search tools (core tools)
					'ace-find_definition',
					'ace-find_references',
					'ace-semantic_search',
					'ace-text_search',
					'ace-file_outline',
					// Codebase search tools
					'codebase-search',
					// Web search for documentation
					'websearch-search',
					'websearch-fetch',
				],
			};
		} else if (agentId === 'agent_plan') {
			agent = {
				id: 'agent_plan',
				name: 'Plan Agent',
				description:
					'Specialized for planning complex tasks. Excels at analyzing requirements, exploring existing code, and creating detailed implementation plans.',
				role: 'You are a specialized task planning agent. Your task is to analyze user requirements, explore existing codebase, identify relevant files and dependencies, and then create detailed implementation plans. Use search and analysis tools to gather information, check diagnostics to understand current state, but do not execute actual modifications. Output clear step-by-step plans including files to modify, suggested implementation approaches, and important considerations.\n\nIMPORTANT: You have NO access to the main conversation history. The prompt provided to you contains ALL the context from the main session. Read it carefully - all requirements, architecture understanding, file locations, constraints, and user preferences are included in the prompt. Do not assume any additional context.',
				tools: [
					// Filesystem read-only tools
					'filesystem-read',
					// ACE code search tools (planning requires code understanding)
					'ace-find_definition',
					'ace-find_references',
					'ace-semantic_search',
					'ace-text_search',
					'ace-file_outline',
					// IDE diagnostics (understand current issues)
					'ide-get_diagnostics',
					// Codebase search
					'codebase-search',
					// Web search for reference
					'websearch-search',
					'websearch-fetch',
				],
			};
		} else if (agentId === 'agent_general') {
			agent = {
				id: 'agent_general',
				name: 'General Purpose Agent',
				description:
					'General-purpose multi-step task execution agent. Has complete tool access for code search, file modification, command execution, and various operations.',
				role: 'You are a general-purpose task execution agent. You can perform various complex multi-step tasks, including searching code, modifying files, executing commands, etc. When given a task, systematically break it down and execute. You have access to all tools and should select appropriate tools as needed to complete tasks efficiently.\n\nIMPORTANT: You have NO access to the main conversation history. The prompt provided to you contains ALL the context from the main session. Read it carefully - all task requirements, file paths, code patterns, dependencies, business logic, constraints, and testing requirements are included in the prompt. Do not assume any additional context.',
				tools: [
					// Filesystem tools (complete access)
					'filesystem-read',
					'filesystem-create',
					'filesystem-edit',
					'filesystem-edit_search',
					// Terminal tools
					'terminal-execute',
					// ACE code search tools
					'ace-find_definition',
					'ace-find_references',
					'ace-semantic_search',
					'ace-text_search',
					'ace-file_outline',
					// Web search tools
					'websearch-search',
					'websearch-fetch',
					// IDE diagnostics tools
					'ide-get_diagnostics',
					// Codebase search tools
					'codebase-search',
				],
			};
		} else {
			// Get user-configured sub-agent
			agent = getSubAgent(agentId);
			if (!agent) {
				return {
					success: false,
					result: '',
					error: `Sub-agent with ID "${agentId}" not found`,
				};
			}
		}

		// Get all available tools
		const allTools = await collectAllMCPTools();

		// Filter tools based on sub-agent's allowed tools
		const allowedTools = allTools.filter((tool: MCPTool) => {
			const toolName = tool.function.name;
			return agent.tools.some((allowedTool: string) => {
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
		let totalUsage: TokenUsage | undefined;

		// Local session-approved tools for this sub-agent execution
		// This ensures tools approved during execution are immediately recognized
		const sessionApprovedTools = new Set<string>();

		// eslint-disable-next-line no-constant-condition
		while (true) {
			// Check abort signal before streaming
			if (abortSignal?.aborted) {
				// Send done message to mark completion (like normal tool abort)
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'done',
						},
					});
				}
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

				// Capture usage from stream events
				if (event.type === 'usage' && event.usage) {
					const eventUsage = event.usage;
					if (!totalUsage) {
						totalUsage = {
							inputTokens: eventUsage.prompt_tokens || 0,
							outputTokens: eventUsage.completion_tokens || 0,
							cacheCreationInputTokens: eventUsage.cache_creation_input_tokens,
							cacheReadInputTokens: eventUsage.cache_read_input_tokens,
						};
					} else {
						// Accumulate usage if there are multiple rounds
						totalUsage.inputTokens += eventUsage.prompt_tokens || 0;
						totalUsage.outputTokens += eventUsage.completion_tokens || 0;
						if (eventUsage.cache_creation_input_tokens) {
							totalUsage.cacheCreationInputTokens =
								(totalUsage.cacheCreationInputTokens || 0) +
								eventUsage.cache_creation_input_tokens;
						}
						if (eventUsage.cache_read_input_tokens) {
							totalUsage.cacheReadInputTokens =
								(totalUsage.cacheReadInputTokens || 0) +
								eventUsage.cache_read_input_tokens;
						}
					}
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
				// 执行 onSubAgentComplete 钩子（在子代理任务完成前）
				try {
					const hookResult = await unifiedHooksExecutor.executeHooks(
						'onSubAgentComplete',
						{
							agentId: agent.id,
							agentName: agent.name,
							content: finalResponse,
							success: true,
							usage: totalUsage,
						},
					);

					// 处理钩子返回结果
					if (hookResult.results && hookResult.results.length > 0) {
						let shouldContinue = false;

						for (const result of hookResult.results) {
							if (result.type === 'command' && !result.success) {
								if (result.exitCode >= 2) {
									// exitCode >= 2: 错误，追加消息并再次调用 API
									const errorMessage: ChatMessage = {
										role: 'user',
										content: result.error || result.output || '未知错误',
									};
									messages.push(errorMessage);
									shouldContinue = true;
								}
							} else if (result.type === 'prompt' && result.response) {
								// 处理 prompt 类型
								if (result.response.ask === 'ai' && result.response.continue) {
									// 发送给 AI 继续处理
									const promptMessage: ChatMessage = {
										role: 'user',
										content: result.response.message,
									};
									messages.push(promptMessage);
									shouldContinue = true;

									// 向 UI 显示钩子消息，告知用户子代理继续执行
									if (onMessage) {
										console.log(`Hook: ${result.response.message}`);
									}
								}
							}
						}
						// 如果需要继续，则不 break，让循环继续
						if (shouldContinue) {
							// 在继续前发送提示信息
							if (onMessage) {
								// 先发送一个 done 消息标记当前流结束
								onMessage({
									type: 'sub_agent_message',
									agentId: agent.id,
									agentName: agent.name,
									message: {
										type: 'done',
									},
								});
							}
							continue;
						}
					}
				} catch (error) {
					console.error('onSubAgentComplete hook execution failed:', error);
				}

				break;
			}

			// 拦截 askuser 工具：子智能体调用时需要显示主会话的蓝色边框 UI，而不是工具确认界面
			const askUserTool = toolCalls.find(tc =>
				tc.function.name.startsWith('askuser-'),
			);

			if (askUserTool && requestUserQuestion) {
				// 解析工具参数，失败时使用默认值
				let question = 'Please select an option:';
				let options: string[] = ['Yes', 'No'];

				try {
					const args = JSON.parse(askUserTool.function.arguments);
					if (args.question) question = args.question;
					if (args.options && Array.isArray(args.options)) {
						options = args.options;
					}
				} catch (error) {
					console.error('Failed to parse askuser tool arguments:', error);
				}

				const userAnswer = await requestUserQuestion(question, options);

				const answerText = userAnswer.customInput
					? `${userAnswer.selected}: ${userAnswer.customInput}`
					: userAnswer.selected;

				const toolResultMessage = {
					role: 'tool' as const,
					tool_call_id: askUserTool.id,
					content: JSON.stringify({
						answer: answerText,
						selected: userAnswer.selected,
						customInput: userAnswer.customInput,
					}),
				};

				messages.push(toolResultMessage);

				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'tool_result',
							tool_call_id: askUserTool.id,
							tool_name: askUserTool.function.name,
							content: JSON.stringify({
								answer: answerText,
								selected: userAnswer.selected,
								customInput: userAnswer.customInput,
							}),
						} as any,
					});
				}

				// 移除已处理的 askuser 工具，避免重复执行
				const remainingTools = toolCalls.filter(tc => tc.id !== askUserTool.id);

				if (remainingTools.length === 0) {
					continue;
				}

				toolCalls = remainingTools;
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

					if (
						confirmation === 'reject' ||
						(typeof confirmation === 'object' &&
							confirmation.type === 'reject_with_reply')
					) {
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
				// Send done message to mark completion when tools are rejected
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'done',
						},
					});
				}
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
				// Check abort signal before executing each tool
				if (abortSignal?.aborted) {
					// Send done message to mark completion
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'done',
							},
						});
					}
					return {
						success: false,
						result: finalResponse,
						error: 'Sub-agent execution aborted during tool execution',
					};
				}

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
						content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'
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
								content: `Error: ${error instanceof Error
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
			usage: totalUsage,
		};
	} catch (error) {
		return {
			success: false,
			result: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}
