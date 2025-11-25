import {exec} from 'child_process';
import {
	loadHookConfig,
	type HookType,
	type HookRule,
	type HookAction,
} from '../config/hooksConfig.js';
import {processManager} from '../core/processManager.js';
import {getOpenAiConfig} from '../config/apiConfig.js';
import {logger} from '../core/logger.js';
import {
	createStreamingChatCompletion,
	type ChatMessage,
} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import type {RequestMethod} from '../config/apiConfig.js';

/**
 * Prompt Hook 执行结果（小模型返回的 JSON）
 *
 * CRITICAL - 流程控制：
 * - ask: "ai" -> 流程继续，message 会作为提示发送给 AI
 * - ask: "user" -> 结束对话，message 直接显示给用户
 * - continue: boolean -> 快捷判断，true=继续/false=结束
 */
export interface PromptHookResponse {
	ask: 'user' | 'ai'; // 必填：流程控制 - "ai"继续/"user"结束
	message: string; // 必填：消息内容
	continue: boolean; // 必填：快捷判断 - true继续/false结束
}

/**
 * Command Hook 执行结果
 */
export interface CommandHookResult {
	type: 'command';
	success: boolean;
	output?: string;
	error?: string;
}

/**
 * Prompt Hook 执行结果
 */
export interface PromptHookResult {
	type: 'prompt';
	success: boolean;
	response?: PromptHookResponse;
	error?: string;
}

/**
 * Hook 执行结果（单个 Action）
 */
export type HookActionResult = CommandHookResult | PromptHookResult;

/**
 * Hooks 执行器执行结果（整体）
 */
export interface UnifiedHookExecutionResult {
	success: boolean;
	results: HookActionResult[]; // 所有执行的 Action 结果（按顺序）
	executedActions: number;
	skippedActions: number;
}

/**
 * Hook 执行上下文
 */
export interface HookContext {
	[key: string]: any;
}

/**
 * 统一 Hooks 执行器
 * 按照 Action 顺序依次执行，根据每个 Action 的类型选择相应的执行方式
 * - 支持项目级和全局级 hooks
 * - 项目级优先，没有则回退到全局级
 * - 支持 command 和 prompt 两种类型的 Action
 * - 严格按照配置顺序执行
 * - 支持 matcher 匹配
 */
export class UnifiedHooksExecutor {
	// Command 执行器配置
	private maxOutputLength: number;
	private defaultTimeout: number;

	// Prompt 执行器配置
	private modelName: string = '';
	private requestMethod: RequestMethod = 'chat';
	private promptInitialized: boolean = false;

	constructor(
		maxOutputLength: number = 10000,
		defaultTimeout: number = 5000,
	) {
		this.maxOutputLength = maxOutputLength;
		this.defaultTimeout = defaultTimeout;
	}

	/**
	 * 初始化 Prompt 执行器（获取 basicModel 配置）
	 */
	private async initializePromptExecutor(): Promise<boolean> {
		if (this.promptInitialized) {
			return true;
		}

		try {
			const config = getOpenAiConfig();

			if (!config.basicModel) {
				logger.warn('Unified hooks executor: Basic model not configured');
				return false;
			}

			this.modelName = config.basicModel;
			this.requestMethod = config.requestMethod;
			this.promptInitialized = true;

			return true;
		} catch (error) {
			logger.warn('Unified hooks executor: Failed to initialize:', error);
			return false;
		}
	}

	/**
	 * 执行指定类型的 hooks
	 * @param hookType - Hook 类型
	 * @param context - 执行上下文（用于 matcher 匹配）
	 * @returns 执行结果
	 */
	async executeHooks(
		hookType: HookType,
		context?: HookContext,
	): Promise<UnifiedHookExecutionResult> {
		// 1. 先尝试加载项目级 hooks
		let rules = loadHookConfig(hookType, 'project');

		// 2. 如果项目级没有，回退到全局级
		if (rules.length === 0) {
			rules = loadHookConfig(hookType, 'global');
		}

		// 3. 没有配置任何 hooks
		if (rules.length === 0) {
			return {
				success: true,
				results: [],
				executedActions: 0,
				skippedActions: 0,
			};
		}

		// 4. 执行所有匹配的规则
		let totalExecuted = 0;
		let totalSkipped = 0;
		const allResults: HookActionResult[] = [];
		let hasError = false;

		for (const rule of rules) {
			// 检查 matcher
			if (!this.matchRule(rule, context)) {
				totalSkipped += rule.hooks.length;
				continue;
			}

			// 按顺序执行规则中的所有 actions
			for (const action of rule.hooks) {
				// 跳过禁用的 action
				if (action.enabled === false) {
					totalSkipped++;
					continue;
				}

				// 根据类型执行相应的 action
				let result: HookActionResult | null = null;

				if (action.type === 'command' && action.command) {
					result = await this.executeCommand(action);
				} else if (action.type === 'prompt' && action.prompt) {
					result = await this.executePrompt(action, context);
				} else {
					// 类型不匹配或缺少必要参数
					totalSkipped++;
					continue;
				}

				totalExecuted++;
				allResults.push(result);

				// 检查是否有错误
				if (!result.success) {
					hasError = true;
				}
			}
		}

		return {
			success: !hasError,
			results: allResults,
			executedActions: totalExecuted,
			skippedActions: totalSkipped,
		};
	}

	/**
	 * 检查规则是否匹配当前上下文
	 * @param rule - Hook 规则
	 * @param context - 执行上下文
	 * @returns 是否匹配
	 */
	private matchRule(rule: HookRule, context?: HookContext): boolean {
		// 没有 matcher 表示匹配所有
		if (!rule.matcher || !context) {
			return true;
		}

		// 支持多个 matcher，用逗号分隔
		const matchers = rule.matcher.split(',').map(m => m.trim());

		// 只要有一个匹配就返回 true
		for (const matcher of matchers) {
			if (this.testMatcher(matcher, context)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 测试单个 matcher
	 * @param matcher - 匹配器字符串
	 * @param context - 执行上下文
	 * @returns 是否匹配
	 */
	private testMatcher(matcher: string, context: HookContext): boolean {
		// 支持简单的通配符匹配
		// 例如: "toolName:filesystem-*"
		// 例如: "message:*fix*"

		if (matcher.includes(':')) {
			const [key, pattern] = matcher.split(':', 2);
			const value = context[key!];

			if (value === undefined) {
				return false;
			}

			const valueStr = String(value);
			return this.matchPattern(pattern!, valueStr);
		}

		// 如果没有冒号，直接匹配整个字符串
		const contextStr = JSON.stringify(context);
		return contextStr.includes(matcher);
	}

	/**
	 * 模式匹配（支持通配符 *）
	 * @param pattern - 匹配模式
	 * @param value - 待匹配的值
	 * @returns 是否匹配
	 */
	private matchPattern(pattern: string, value: string): boolean {
		// 转换通配符为正则表达式
		const regexPattern = pattern
			.replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
			.replace(/\*/g, '.*'); // * 转换为 .*

		const regex = new RegExp(`^${regexPattern}$`, 'i');
		return regex.test(value);
	}

	// ==================== Command 执行器逻辑 ====================

	/**
	 * 执行单个 command action
	 * @param action - Hook 动作
	 * @returns 执行结果
	 */
	private async executeCommand(
		action: HookAction,
	): Promise<CommandHookResult> {
		const command = action.command!;
		const timeout = action.timeout || this.defaultTimeout;

		try {
			const childProcess = exec(command, {
				cwd: process.cwd(),
				timeout,
				maxBuffer: this.maxOutputLength,
				env: {
					...process.env,
					// Windows 下不需要设置 LANG
					...(process.platform !== 'win32' && {
						LANG: 'en_US.UTF-8',
						LC_ALL: 'en_US.UTF-8',
					}),
				},
			});

			// 注册进程以便清理
			processManager.register(childProcess);

			// 等待命令执行完成
			const {stdout, stderr} = await new Promise<{
				stdout: string;
				stderr: string;
			}>((resolve, reject) => {
				let stdoutData = '';
				let stderrData = '';

				childProcess.stdout?.on('data', chunk => {
					stdoutData += chunk;
				});

				childProcess.stderr?.on('data', chunk => {
					stderrData += chunk;
				});

				childProcess.on('error', reject);

				childProcess.on('close', (code, signal) => {
					if (signal) {
						const error: any = new Error(`Process killed by signal ${signal}`);
						error.code = code || 1;
						error.stdout = stdoutData;
						error.stderr = stderrData;
						error.signal = signal;
						reject(error);
					} else if (code === 0) {
						resolve({stdout: stdoutData, stderr: stderrData});
					} else {
						const error: any = new Error(`Process exited with code ${code}`);
						error.code = code;
						error.stdout = stdoutData;
						error.stderr = stderrData;
						reject(error);
					}
				});
			});

			return {
				type: 'command',
				success: true,
				output: this.truncateOutput(stdout),
				error: stderr ? this.truncateOutput(stderr) : undefined,
			};
		} catch (error: any) {
			// 处理超时和其他错误
			if (error.code === 'ETIMEDOUT') {
				return {
					type: 'command',
					success: false,
					error: `Command timed out after ${timeout}ms: ${command}`,
				};
			}

			// 即使出错也返回可能的输出
			return {
				type: 'command',
				success: false,
				output: error.stdout
					? this.truncateOutput(error.stdout)
					: undefined,
				error:
					error.stderr || error.message
						? this.truncateOutput(error.stderr || error.message)
						: undefined,
			};
		}
	}

	/**
	 * 截断输出（防止过长）
	 * @param output - 输出内容
	 * @returns 截断后的输出
	 */
	private truncateOutput(output: string): string {
		if (output.length <= this.maxOutputLength) {
			return output;
		}

		const half = Math.floor(this.maxOutputLength / 2);
		return (
			output.slice(0, half) +
			'\n...(output truncated)...\n' +
			output.slice(-half)
		);
	}

	// ==================== Prompt 执行器逻辑 ====================

	/**
	 * 执行单个 prompt action
	 * @param action - Hook 动作
	 * @param context - 执行上下文
	 * @returns 执行结果
	 */
	private async executePrompt(
		action: HookAction,
		context?: HookContext,
	): Promise<PromptHookResult> {
		// 确保 prompt 执行器已初始化
		const initialized = await this.initializePromptExecutor();
		if (!initialized) {
			return {
				type: 'prompt',
				success: false,
				error: 'Basic model not configured',
			};
		}

		const prompt = action.prompt!;

		try {
			// 构建系统提示和用户消息
			const systemPrompt = `You are a hook execution assistant. You must respond ONLY with a valid JSON object in this exact format:
{
  "ask": "user" or "ai",
  "message": "your message content",
  "continue": true or false
}

CRITICAL FLOW CONTROL:
- "ask": "ai" -> Message will be sent to AI, conversation continues
- "ask": "user" -> Message will be shown to user, conversation ENDS
- "continue": true (when ask="ai") or false (when ask="user") -> Quick boolean check
- Choose "ai" + true when you want the AI to process something or continue the workflow
- Choose "user" + false when you want to directly inform/ask the user and stop the current flow

CRITICAL RULES:
- "ask" field is REQUIRED and must be either "user" or "ai"
- "message" field is REQUIRED and contains the actual message content
- "continue" field is REQUIRED and must be boolean (true when ask="ai", false when ask="user")
- Output ONLY the JSON object, no additional text, no explanations
- Ensure the JSON is valid and properly formatted`;

			// 构建用户消息（包含 prompt 和 context）
			let userMessage = prompt;
			if (context && Object.keys(context).length > 0) {
				userMessage += '\n\nContext:\n' + JSON.stringify(context, null, 2);
			}

			const messages: ChatMessage[] = [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: userMessage,
				},
			];

			// 调用小模型
			const response = await this.callModel(messages);

			if (!response || response.trim().length === 0) {
				return {
					type: 'prompt',
					success: false,
					error: 'Empty response from model',
				};
			}

			// 解析 JSON 响应
			const parsed = this.parseJsonResponse(response);

			if (!parsed) {
				return {
					type: 'prompt',
					success: false,
					error: `Failed to parse JSON response: ${response}`,
				};
			}

			// 验证响应格式
			if (!parsed.ask || !parsed.message || parsed.continue === undefined) {
				return {
					type: 'prompt',
					success: false,
					error: `Invalid response format: missing required fields (ask, message, continue)`,
				};
			}

			if (parsed.ask !== 'user' && parsed.ask !== 'ai') {
				return {
					type: 'prompt',
					success: false,
					error: `Invalid "ask" value: must be "user" or "ai"`,
				};
			}

			if (typeof parsed.continue !== 'boolean') {
				return {
					type: 'prompt',
					success: false,
					error: `Invalid "continue" value: must be boolean`,
				};
			}

			// 验证逻辑一致性：ask="ai" 应该 continue=true，ask="user" 应该 continue=false
			if (
				(parsed.ask === 'ai' && !parsed.continue) ||
				(parsed.ask === 'user' && parsed.continue)
			) {
				return {
					type: 'prompt',
					success: false,
					error: `Inconsistent values: ask="${parsed.ask}" but continue=${parsed.continue}`,
				};
			}

			return {
				type: 'prompt',
				success: true,
				response: parsed,
			};
		} catch (error: any) {
			return {
				type: 'prompt',
				success: false,
				error: error.message || String(error),
			};
		}
	}

	/**
	 * 调用小模型
	 */
	private async callModel(
		messages: ChatMessage[],
		abortSignal?: AbortSignal,
	): Promise<string> {
		let streamGenerator: AsyncGenerator<any, void, unknown>;

		// 根据 requestMethod 路由到相应的 API
		switch (this.requestMethod) {
			case 'anthropic':
				streamGenerator = createStreamingAnthropicCompletion(
					{
						model: this.modelName,
						messages,
						max_tokens: 500, // Prompt hooks 限制 token 数量
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
					},
					abortSignal,
				);
				break;

			case 'gemini':
				streamGenerator = createStreamingGeminiCompletion(
					{
						model: this.modelName,
						messages,
						includeBuiltinSystemPrompt: false,
					},
					abortSignal,
				);
				break;

			case 'responses':
				streamGenerator = createStreamingResponse(
					{
						model: this.modelName,
						messages,
						stream: true,
						includeBuiltinSystemPrompt: false,
					},
					abortSignal,
				);
				break;

			case 'chat':
			default:
				streamGenerator = createStreamingChatCompletion(
					{
						model: this.modelName,
						messages,
						stream: true,
						includeBuiltinSystemPrompt: false,
					},
					abortSignal,
				);
				break;
		}

		// 组装完整响应
		let completeContent = '';

		try {
			for await (const chunk of streamGenerator) {
				if (abortSignal?.aborted) {
					throw new Error('Request aborted');
				}

				// 处理不同格式的 chunk
				if (this.requestMethod === 'chat') {
					if (chunk.choices && chunk.choices[0]?.delta?.content) {
						completeContent += chunk.choices[0].delta.content;
					}
				} else {
					if (chunk.type === 'content' && chunk.content) {
						completeContent += chunk.content;
					}
				}
			}
		} catch (streamError) {
			logger.error('Unified hooks executor: Streaming error:', streamError);
			throw streamError;
		}

		return completeContent;
	}

	/**
	 * 解析 JSON 响应（支持 markdown 代码块包装）
	 */
	private parseJsonResponse(response: string): PromptHookResponse | null {
		try {
			let cleaned = response.trim();

			// 移除 markdown 代码块
			const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
			if (codeBlockMatch) {
				cleaned = codeBlockMatch[1]!.trim();
			}

			// 尝试解析 JSON
			const parsed = JSON.parse(cleaned);

			return parsed as PromptHookResponse;
		} catch (error) {
			logger.warn('Unified hooks executor: Failed to parse JSON:', error);
			return null;
		}
	}
}

// 导出默认实例
export const unifiedHooksExecutor = new UnifiedHooksExecutor();
