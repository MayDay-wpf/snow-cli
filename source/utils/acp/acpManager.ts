/**
 * ACP (Agent Client Protocol) Manager
 *
 * 实现 ACP 协议，让 Snow CLI 作为 Agent 服务端与第三方 Client 通讯
 * 使用 stdin/stdout 进行 JSON-RPC 2.0 通信
 */

import {
	AgentSideConnection,
	type Agent,
	type InitializeRequest,
	type InitializeResponse,
	type NewSessionRequest,
	type NewSessionResponse,
	type LoadSessionRequest,
	type LoadSessionResponse,
	type PromptRequest,
	type PromptResponse,
	type CancelNotification,
	type AuthenticateRequest,
	type AuthenticateResponse,
	type StopReason,
	type ToolCallUpdate,
	type PermissionOption,
	type PermissionOptionKind,
	type McpServer,
	type AgentCapabilities,
	type ProtocolVersion,
	type SessionUpdate,
	ndJsonStream,
} from '@agentclientprotocol/sdk';
import {Readable, Writable} from 'stream';
import {sessionManager} from '../session/sessionManager.js';
import {
	loadPermissionsConfig,
	addMultipleToolsToPermissions,
	addToolToPermissions,
} from '../config/permissionsConfig.js';
import {isSensitiveCommand} from '../execution/sensitiveCommandManager.js';
import {randomUUID} from 'crypto';
import {
	createStreamingChatCompletion,
	type ChatMessage,
} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {collectAllMCPTools} from '../execution/mcpToolsManager.js';
import {getOpenAiConfig} from '../config/apiConfig.js';
import type {ResponseStreamChunk} from '../../api/responses.js';
import type {AnthropicStreamChunk} from '../../api/anthropic.js';
import type {GeminiStreamChunk} from '../../api/gemini.js';
import type {StreamChunk} from '../../api/chat.js';
import {executeToolCall, type ToolCall} from '../execution/toolExecutor.js';

// ACP 协议版本
const ACP_PROTOCOL_VERSION: ProtocolVersion = 1;

// 会话状态
interface AcpSession {
	id: string;
	cwd: string;
	mcpServers: McpServer[];
	controller: AbortController | null;
	prompting: boolean;
	messages: ChatMessage[];
}

// 工具调用状态类型
type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * ACP Manager 类
 * 负责 ACP 协议的连接管理和消息处理
 */
class AcpManager {
	private connection: AgentSideConnection | null = null;
	private sessions: Map<string, AcpSession> = new Map();

	/**
	 * 启动 ACP 服务
	 */
	async start(input: Readable, output: Writable): Promise<void> {
		// 将 Node.js 流转换为 Web Streams API
		const readable = Readable.toWeb(input) as ReadableStream<Uint8Array>;
		const writable = Writable.toWeb(output) as WritableStream<Uint8Array>;

		// 创建 ndjson 流
		const stream = ndJsonStream(writable, readable);

		// 创建 Agent 连接
		this.connection = new AgentSideConnection(
			conn => this.createAgentHandler(conn),
			stream,
		);

		// 等待连接关闭
		await this.connection.closed;
	}

	/**
	 * 创建 Agent 处理器
	 */
	private createAgentHandler(conn: AgentSideConnection): Agent {
		return {
			// 初始化
			initialize: async (
				_req: InitializeRequest,
			): Promise<InitializeResponse> => {
				const capabilities: AgentCapabilities = {
					loadSession: true,
					promptCapabilities: {
						image: true,
						audio: false,
						embeddedContext: false,
					},
					mcpCapabilities: {
						http: false,
						sse: false,
					},
				};

				return {
					protocolVersion: ACP_PROTOCOL_VERSION,
					agentCapabilities: capabilities,
					agentInfo: {
						name: 'snow-ai',
						title: 'Snow CLI',
						version: this.getVersion(),
					},
				};
			},

			// 认证 (暂不实现)
			authenticate: async (
				_req: AuthenticateRequest,
			): Promise<AuthenticateResponse> => {
				return {};
			},

			// 创建新会话
			newSession: async (
				req: NewSessionRequest,
			): Promise<NewSessionResponse> => {
				const sessionId = randomUUID();

				this.sessions.set(sessionId, {
					id: sessionId,
					cwd: req.cwd,
					mcpServers: req.mcpServers || [],
					controller: null,
					prompting: false,
					messages: [],
				});

				// 设置当前工作目录
				if (req.cwd) {
					try {
						process.chdir(req.cwd);
					} catch {
						// 忽略错误
					}
				}

				return {
					sessionId,
				};
			},

			// 加载已有会话
			loadSession: async (
				req: LoadSessionRequest,
			): Promise<LoadSessionResponse> => {
				const sessionId = req.sessionId;

				// 尝试加载内部会话
				const internalSession = await sessionManager.loadSession(sessionId);

				let messages: ChatMessage[] = [];
				if (internalSession) {
					sessionManager.setCurrentSession(internalSession);
					// 转换会话消息
					messages = internalSession.messages.map(msg => ({
						role: msg.role as 'user' | 'assistant' | 'system',
						content: msg.content || '',
					}));
				}

				this.sessions.set(sessionId, {
					id: sessionId,
					cwd: req.cwd,
					mcpServers: req.mcpServers || [],
					controller: null,
					prompting: false,
					messages,
				});

				// 设置当前工作目录
				if (req.cwd) {
					try {
						process.chdir(req.cwd);
					} catch {
						// 忽略错误
					}
				}

				return {};
			},

			// 处理用户提示
			prompt: async (req: PromptRequest): Promise<PromptResponse> => {
				const session = this.sessions.get(req.sessionId);
				if (!session) {
					throw new Error(`Session not found: ${req.sessionId}`);
				}

				// 提取文本内容
				let userContent = '';
				const imageUrls: string[] = [];

				for (const block of req.prompt) {
					if (block.type === 'text') {
						userContent += block.text;
					} else if (block.type === 'image') {
						imageUrls.push(block.data);
					}
				}

				// 创建 AbortController
				const controller = new AbortController();
				session.controller = controller;
				session.prompting = true;

				// 用于跟踪是否已取消
				let cancelled = false;

				// 监听取消信号
				controller.signal.addEventListener('abort', () => {
					cancelled = true;
				});

				try {
					// 执行对话处理
					const stopReason = await this.handlePrompt(
						session,
						userContent,
						imageUrls,
						controller,
						conn,
						() => cancelled,
					);

					return {
						stopReason: cancelled ? 'cancelled' : stopReason,
					};
				} catch (error) {
					if (
						error instanceof Error &&
						(error.message === 'Request aborted' ||
							error.message === 'User cancelled')
					) {
						return {
							stopReason: 'cancelled' as StopReason,
						};
					}
					throw error;
				} finally {
					session.controller = null;
					session.prompting = false;
				}
			},

			// 取消操作
			cancel: async (req: CancelNotification): Promise<void> => {
				const session = this.sessions.get(req.sessionId);
				if (session?.controller) {
					session.controller.abort();
				}
			},
		};
	}

	/**
	 * 处理 prompt 请求
	 */
	private async handlePrompt(
		session: AcpSession,
		userContent: string,
		imageUrls: string[],
		controller: AbortController,
		conn: AgentSideConnection,
		isCancelled: () => boolean,
	): Promise<StopReason> {
		// 只有当用户内容非空时才构建并添加用户消息
		// 工具调用后的递归调用会传入空字符串，此时不需要添加用户消息
		if (userContent.trim() || imageUrls.length > 0) {
			// 构建用户消息
			const userMessage: ChatMessage = {
				role: 'user',
				content: userContent,
			};

			// 如果有图片，构建多模态内容
			if (imageUrls.length > 0) {
				const content: Array<
					| {type: 'text'; text: string}
					| {type: 'image_url'; image_url: {url: string}}
				> = [{type: 'text', text: userContent}];

				for (const imageUrl of imageUrls) {
					content.push({
						type: 'image_url',
						image_url: {url: imageUrl},
					});
				}
				userMessage.content = content as any;
			}

			session.messages.push(userMessage);
		}

		// 获取配置
		const config = getOpenAiConfig();
		const model = config.advancedModel || 'claude-sonnet-4-20250514';

		// 收集 MCP 工具
		const mcpTools = await collectAllMCPTools();

		// 流式响应处理
		let fullContent = '';
		const toolCalls: ToolCall[] = [];

		// 流式回调
		const onChunk = async (chunk: string, _isThinking: boolean) => {
			if (isCancelled()) return;

			fullContent += chunk;
			// 发送消息块
			await conn
				.sessionUpdate({
					sessionId: session.id,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: {type: 'text', text: chunk},
					} as SessionUpdate,
				})
				.catch(() => {});
		};

		// 思考内容缓冲区
		let reasoningContent = '';
		// Anthropic thinking 需要保存完整的 thinking 对象（包含 signature）
		let thinkingBlock:
			| {type: 'thinking'; thinking: string; signature?: string}
			| undefined;

		// 发送思考内容块
		const onReasoningChunk = async (chunk: string) => {
			if (isCancelled()) return;

			reasoningContent += chunk;
			await conn
				.sessionUpdate({
					sessionId: session.id,
					update: {
						sessionUpdate: 'agent_thought_chunk',
						content: {type: 'text', text: chunk},
					} as SessionUpdate,
				})
				.catch(() => {});
		};

		// 根据配置的 requestMethod 选择正确的 API 链路
		const requestMethod = config.requestMethod || 'chat';

		// 处理流式响应的通用逻辑
		const processStreamChunk = async (
			part:
				| StreamChunk
				| ResponseStreamChunk
				| AnthropicStreamChunk
				| GeminiStreamChunk,
		) => {
			if (isCancelled()) return false; // false = 不终止，继续处理

			// 处理内容块
			if ('content' in part && part.content) {
				await onChunk(part.content, false);
			}
			// 处理思考内容 (reasoning_delta)
			if (part.type === 'reasoning_delta' && 'delta' in part && part.delta) {
				await onReasoningChunk(part.delta);
			}
			// 处理思考开始事件
			if (part.type === 'reasoning_started') {
				// 思考开始，不需要特殊处理，delta 事件会发送内容
			}
			// 处理工具调用
			if (
				part.type === 'tool_calls' &&
				'tool_calls' in part &&
				part.tool_calls
			) {
				toolCalls.push(...part.tool_calls);
				// 发送 tool_call 事件创建工具调用（客户端需要这个来显示工具）
				for (const tc of part.tool_calls) {
					await conn
						.sessionUpdate({
							sessionId: session.id,
							update: {
								sessionUpdate: 'tool_call',
								toolCallId: tc.id,
								title: tc.function.name,
								status: 'pending',
							} as SessionUpdate,
						})
						.catch(() => {});
				}
			}
			// 处理完成信号 - 捕获 thinking 对象（Anthropic/Gemini 需要）
			if (part.type === 'done') {
				// 从 done 事件中提取 thinking 对象（Anthropic 返回 thinking，Chat API 返回 reasoning_content）
				if ('thinking' in part && part.thinking) {
					thinkingBlock = part.thinking as typeof thinkingBlock;
				}
				return true; // true = 完成
			}
			return false;
		};

		// 处理流式响应
		try {
			switch (requestMethod) {
				case 'responses': {
					const stream = createStreamingResponse(
						{
							messages: session.messages,
							model,
							tools: mcpTools,
							store: false,
						},
						controller.signal,
					);
					for await (const part of stream) {
						const done = await processStreamChunk(part);
						if (done) break;
					}
					break;
				}
				case 'anthropic': {
					const stream = createStreamingAnthropicCompletion(
						{
							messages: session.messages,
							model,
							tools: mcpTools,
						},
						controller.signal,
					);
					for await (const part of stream) {
						const done = await processStreamChunk(part);
						if (done) break;
					}
					break;
				}
				case 'gemini': {
					const stream = createStreamingGeminiCompletion(
						{
							messages: session.messages,
							model,
							tools: mcpTools,
						},
						controller.signal,
					);
					for await (const part of stream) {
						const done = await processStreamChunk(part);
						if (done) break;
					}
					break;
				}
				case 'chat':
				default: {
					const stream = createStreamingChatCompletion(
						{
							messages: session.messages,
							model,
							tools: mcpTools,
						},
						controller.signal,
					);
					for await (const part of stream) {
						const done = await processStreamChunk(part);
						if (done) break;
					}
					break;
				}
			}
		} catch (error) {
			if (controller.signal.aborted) {
				return 'cancelled';
			}
			throw error;
		}

		// 添加助手消息
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: fullContent,
		};

		// 如果有思考内容，添加到消息中（thinking 模型需要）
		if (reasoningContent) {
			(assistantMessage as any).reasoning_content = reasoningContent;
		}

		// 如果有完整的 thinking 对象（Anthropic/Gemini），保存它（用于 tool_calls 场景）
		if (thinkingBlock) {
			(assistantMessage as any).thinking = thinkingBlock;
		}

		// 如果有工具调用，添加到消息中
		if (toolCalls.length > 0) {
			(assistantMessage as any).tool_calls = toolCalls;
		}

		session.messages.push(assistantMessage);

		// 处理工具调用
		if (toolCalls.length > 0) {
			// 执行工具调用
			const workingDirectory = session.cwd || process.cwd();
			const permissionsConfig = loadPermissionsConfig(workingDirectory);
			const approvedToolsSet = new Set(permissionsConfig.alwaysApprovedTools);

			const isToolAutoApproved = (toolName: string) =>
				approvedToolsSet.has(toolName) ||
				toolName.startsWith('todo-') ||
				toolName.startsWith('subagent-') ||
				toolName === 'askuser-ask_question' ||
				toolName === 'tool_search';

			// 创建单个工具批准的回调
			const addToAlwaysApproved = (toolName: string) => {
				addMultipleToolsToPermissions(workingDirectory, [toolName]);
				approvedToolsSet.add(toolName);
			};

			// 请求权限并执行工具
			for (const toolCall of toolCalls) {
				if (isCancelled()) {
					return 'cancelled';
				}

				// 发送工具调用状态
				await this.sendToolCallUpdate(
					conn,
					session.id,
					toolCall,
					'pending',
					undefined,
				);

				// 检查是否自动批准
				let approved = isToolAutoApproved(toolCall.function.name);

				if (!approved) {
					// 请求权限
					approved = await this.requestToolPermission(
						session.id,
						toolCall,
						conn,
						workingDirectory,
					);
				}

				if (!approved) {
					// 用户拒绝
					await this.sendToolCallUpdate(
						conn,
						session.id,
						toolCall,
						'failed',
						'Permission denied by user',
					);
					continue;
				}

				// 更新状态为运行中
				await this.sendToolCallUpdate(
					conn,
					session.id,
					toolCall,
					'running',
					undefined,
				);

				try {
					// 执行工具
					const result = await executeToolCall(
						toolCall,
						controller.signal,
						undefined,
						undefined,
						undefined,
						isToolAutoApproved,
						false,
						addToAlwaysApproved,
						undefined,
					);
					if (result) {
						// 添加工具结果到消息
						session.messages.push({
							role: 'tool',
							content: result.content,
							tool_call_id: toolCall.id,
						} as ChatMessage);

						// 发送工具结果
						await this.sendToolCallUpdate(
							conn,
							session.id,
							toolCall,
							'completed',
							result.content,
						);
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : 'Unknown error';
					await this.sendToolCallUpdate(
						conn,
						session.id,
						toolCall,
						'failed',
						errorMessage,
					);
				}
			}

			// 如果有工具调用，递归处理
			return this.handlePrompt(session, '', [], controller, conn, isCancelled);
		}

		return 'end_turn';
	}

	/**
	 * 发送工具调用更新
	 */
	private async sendToolCallUpdate(
		conn: AgentSideConnection,
		sessionId: string,
		toolCall: ToolCall,
		status: ToolCallStatus,
		result?: string,
	): Promise<void> {
		const update: SessionUpdate = {
			sessionUpdate: 'tool_call_update',
			toolCallId: toolCall.id,
			title: toolCall.function.name,
			status: status as any,
			result,
		} as any;

		await conn
			.sessionUpdate({
				sessionId,
				update,
			})
			.catch(() => {});
	}

	/**
	 * 请求工具权限
	 */
	private async requestToolPermission(
		sessionId: string,
		toolCall: ToolCall,
		conn: AgentSideConnection,
		workingDirectory: string,
	): Promise<boolean> {
		if (!this.connection) {
			return false;
		}

		// 检测是否为敏感命令
		let isSensitive = false;
		if (toolCall.function.name === 'terminal-execute') {
			try {
				const args = JSON.parse(toolCall.function.arguments);
				if (args.command && typeof args.command === 'string') {
					const result = isSensitiveCommand(args.command);
					isSensitive = result.isSensitive;
				}
			} catch {
				// 忽略解析错误
			}
		}

		// 构建权限选项
		const options: PermissionOption[] = [
			{
				optionId: 'approve_once',
				name: 'Approve once',
				kind: 'allow_once' as PermissionOptionKind,
			},
		];

		if (!isSensitive) {
			options.push({
				optionId: 'approve_always',
				name: 'Always approve',
				kind: 'allow_always' as PermissionOptionKind,
			});
		}

		options.push({
			optionId: 'reject_once',
			name: 'Reject',
			kind: 'reject_once' as PermissionOptionKind,
		});

		// 构建工具调用更新 - 使用 title 字段显示工具名（ACP 协议要求）
		const toolCallUpdate: ToolCallUpdate = {
			toolCallId: toolCall.id,
			title: toolCall.function.name,
		} as ToolCallUpdate;

		try {
			const response = await conn.requestPermission({
				sessionId,
				options,
				toolCall: toolCallUpdate,
			});

			if (response.outcome.outcome === 'cancelled') {
				return false;
			}

			const selectedOptionId = response.outcome.optionId;
			const approved =
				selectedOptionId === 'approve_once' ||
				selectedOptionId === 'approve_always';

			// 如果用户选择"总是同意"，保存到权限配置文件
			if (approved && selectedOptionId === 'approve_always') {
				addToolToPermissions(workingDirectory, toolCall.function.name);
			}

			return approved;
		} catch {
			return false;
		}
	}

	/**
	 * 获取版本号
	 */
	private getVersion(): string {
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const packageJson = require('../../../package.json');
			return packageJson.version || '0.0.0';
		} catch {
			return '0.0.0';
		}
	}

	/**
	 * 获取连接状态
	 */
	isConnected(): boolean {
		return this.connection !== null && !this.connection.signal.aborted;
	}

	/**
	 * 停止 ACP 服务
	 */
	async stop(): Promise<void> {
		// 中止所有活跃会话
		for (const session of this.sessions.values()) {
			if (session.controller) {
				session.controller.abort();
			}
		}
		this.sessions.clear();
		this.connection = null;
	}
}

// 导出单例
export const acpManager = new AcpManager();
