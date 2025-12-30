import {SSEServer, SSEEvent, ClientMessage} from '../../api/sse-server.js';
import {handleConversationWithTools} from '../../hooks/conversation/useConversation.js';
import {sessionManager} from '../session/sessionManager.js';
import type {ToolCall} from '../execution/toolExecutor.js';
import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';
import type {UserQuestionResult} from '../../hooks/conversation/useConversation.js';
import {
	loadPermissionsConfig,
	addMultipleToolsToPermissions,
} from '../config/permissionsConfig.js';
import {isSensitiveCommand} from '../execution/sensitiveCommandManager.js';

/**
 * 待处理的交互请求
 */
interface PendingInteraction {
	requestId: string;
	type: 'tool_confirmation' | 'user_question';
	resolve: (value: any) => void;
	reject: (error: any) => void;
	timeout: NodeJS.Timeout;
}

/**
 * SSE 服务管理器
 * 负责 SSE 服务器的生命周期管理和消息处理
 */
class SSEManager {
	private server: SSEServer | null = null;
	private isRunning = false;
	private pendingInteractions: Map<string, PendingInteraction> = new Map();
	private interactionTimeout = 60000; // 60秒超时
	private logCallback?: (
		message: string,
		level?: 'info' | 'error' | 'success',
	) => void;
	// 存储每个会话的 AbortController，用于中断任务
	private sessionControllers: Map<string, AbortController> = new Map();

	/**
	 * 设置日志回调函数
	 */
	setLogCallback(
		callback: (message: string, level?: 'info' | 'error' | 'success') => void,
	): void {
		this.logCallback = callback;
	}

	/**
	 * 记录日志
	 */
	private log(
		message: string,
		level: 'info' | 'error' | 'success' = 'info',
	): void {
		if (this.logCallback) {
			this.logCallback(message, level);
		} else {
			console.log(message);
		}
	}

	/**
	 * 启动 SSE 服务
	 */
	async start(port: number = 3000): Promise<void> {
		if (this.isRunning) {
			this.log('SSE service is already running', 'info');
			return;
		}

		this.server = new SSEServer(port);

		// 设置日志回调（如果已设置）
		if (this.logCallback) {
			this.server.setLogCallback(this.logCallback);
		}

		// 设置消息处理器
		this.server.setMessageHandler(async (message, sendEvent, connectionId) => {
			await this.handleClientMessage(message, sendEvent, connectionId);
		});

		await this.server.start();
		this.isRunning = true;
		this.log(`SSE service has started on port ${port}`, 'success');
	}

	/**
	 * 停止 SSE 服务
	 */
	async stop(): Promise<void> {
		if (!this.isRunning || !this.server) {
			return;
		}

		await this.server.stop();
		this.server = null;
		this.isRunning = false;
		this.log('SSE service has stopped', 'info');
	}

	/**
	 * 处理客户端消息
	 */
	private async handleClientMessage(
		message: ClientMessage,
		sendEvent: (event: SSEEvent) => void,
		connectionId: string,
	): Promise<void> {
		try {
			// 处理交互响应
			if (
				message.type === 'tool_confirmation_response' ||
				message.type === 'user_question_response'
			) {
				this.handleInteractionResponse(message);
				return;
			}

			// 处理中断请求
			if (message.type === 'abort') {
				this.handleAbortRequest(message, sendEvent);
				return;
			}

			// 处理普通聊天消息
			if (message.type === 'chat' || message.type === 'image') {
				await this.handleChatMessage(message, sendEvent, connectionId);
			}
		} catch (error) {
			// 发送错误事件
			sendEvent({
				type: 'error',
				data: {
					message: error instanceof Error ? error.message : '未知错误',
					stack: error instanceof Error ? error.stack : undefined,
				},
				timestamp: new Date().toISOString(),
			});
		}
	}

	/**
	 * 处理交互响应
	 */
	private handleInteractionResponse(message: ClientMessage): void {
		if (!message.requestId) {
			this.log('Interactive response missing requestId', 'error');
			return;
		}

		const pending = this.pendingInteractions.get(message.requestId);
		if (!pending) {
			this.log(
				`No pending interaction requests found: ${message.requestId}`,
				'error',
			);
			return;
		}

		// 清除超时
		clearTimeout(pending.timeout);

		// 根据类型处理不同的响应格式
		if (pending.type === 'tool_confirmation') {
			// tool_confirmation 响应：直接是 ConfirmationResult 字符串
			// 期望值：'approve' | 'approve_always' | 'reject' | { rejectWithReply: string }
			pending.resolve(message.response);
		} else if (pending.type === 'user_question') {
			// user_question 响应：完整的 UserQuestionResult 对象
			// 期望格式：{ selected: string | string[], customInput?: string, cancelled?: boolean }
			pending.resolve(message.response);
		}
		// 移除待处理请求
		this.pendingInteractions.delete(message.requestId);
	}

	/**
	 * 处理中断请求
	 */
	private handleAbortRequest(
		message: ClientMessage,
		sendEvent: (event: SSEEvent) => void,
	): void {
		if (!message.sessionId) {
			this.log('Abort request missing sessionId', 'error');
			return;
		}

		const controller = this.sessionControllers.get(message.sessionId);
		if (controller) {
			// 触发中断信号
			controller.abort();
			this.log(`Task aborted for session: ${message.sessionId}`, 'info');

			// 发送中断确认事件
			sendEvent({
				type: 'message',
				data: {
					role: 'assistant',
					content: 'Task has been aborted by user',
				},
				timestamp: new Date().toISOString(),
			});

			// 清理 controller
			this.sessionControllers.delete(message.sessionId);
		} else {
			this.log(
				`No active task found for session: ${message.sessionId}`,
				'info',
			);
		}
	}

	/**
	 * 处理聊天消息
	 */
	private async handleChatMessage(
		message: ClientMessage,
		sendEvent: (event: SSEEvent) => void,
		connectionId: string,
	): Promise<void> {
		// 获取或创建 session
		let currentSession;
		if (message.sessionId) {
			// 加载已有的 session
			try {
				currentSession = await sessionManager.loadSession(message.sessionId);
				if (currentSession) {
					sessionManager.setCurrentSession(currentSession);
					this.log(`Load existing session: ${message.sessionId}`, 'success');
					// 绑定 session 到当前连接
					if (this.server) {
						this.server.bindSessionToConnection(
							message.sessionId,
							connectionId,
						);
					}
				} else {
					// Session 不存在，创建新的
					currentSession = await sessionManager.createNewSession();
					this.log(
						`Session does not exist, create a new session: ${currentSession.id}`,
						'info',
					);
					// 绑定 session 到当前连接
					if (this.server) {
						this.server.bindSessionToConnection(
							currentSession.id,
							connectionId,
						);
					}
				}
			} catch (error) {
				this.log('Load session failed, create new session', 'error');
				currentSession = await sessionManager.createNewSession();
				// 绑定 session 到当前连接
				if (this.server) {
					this.server.bindSessionToConnection(currentSession.id, connectionId);
				}
			}
		} else {
			// 创建新 session
			currentSession = await sessionManager.createNewSession();
			this.log(`Create new session: ${currentSession.id}`, 'success');
			// 绑定 session 到当前连接
			if (this.server) {
				this.server.bindSessionToConnection(currentSession.id, connectionId);
			}
		}

		// 在连接事件中返回 sessionId
		sendEvent({
			type: 'message',
			data: {
				role: 'system',
				sessionId: currentSession.id,
				content: `Session ID: ${currentSession.id}`,
			},
			timestamp: new Date().toISOString(),
		});

		// 发送开始处理事件
		sendEvent({
			type: 'message',
			data: {
				role: 'user',
				content: message.content,
				hasImages: Boolean(message.images && message.images.length > 0),
			},
			timestamp: new Date().toISOString(),
		});

		// 准备图片内容
		const imageContents = message.images?.map(img => ({
			type: 'image' as const,
			data: img.data, // 完整的 data URI
			mimeType: img.mimeType,
		}));

		// 创建 AbortController
		const controller = new AbortController();

		// 存储到 sessionControllers，以便可以从客户端中断
		this.sessionControllers.set(currentSession.id, controller);

		// 真实的消息保存函数
		const saveMessage = async (msg: any) => {
			try {
				await sessionManager.addMessage(msg);
				// 不记录每条消息，避免日志过多
			} catch (error) {
				this.log('保存消息失败', 'error');
			}
		};

		// setMessages 实现
		const messagesRef: any[] = [];
		let lastSentMessageId: string | undefined; // 跟踪最后发送的消息ID，避免重复发送

		const setMessages = (updater: any) => {
			if (typeof updater === 'function') {
				const newMessages = updater(messagesRef);
				messagesRef.splice(0, messagesRef.length, ...newMessages);
			} else {
				messagesRef.splice(0, messagesRef.length, ...updater);
			}

			// 发送消息更新事件
			const lastMessage = messagesRef[messagesRef.length - 1];
			if (lastMessage) {
				// 生成消息唯一ID（基于内容和类型）
				const messageId = `${lastMessage.role}-${lastMessage.content?.substring(
					0,
					50,
				)}-${lastMessage.streaming}`;

				// 避免重复发送相同的非流式消息
				if (!lastMessage.streaming && messageId === lastSentMessageId) {
					return;
				}

				if (lastMessage.role === 'assistant') {
					// 发送 assistant 消息（包括流式和最终消息）
					sendEvent({
						type: 'message',
						data: {
							role: 'assistant',
							content: lastMessage.content,
							streaming: lastMessage.streaming || false,
						},
						timestamp: new Date().toISOString(),
					});

					// 更新最后发送的消息ID
					if (!lastMessage.streaming) {
						lastSentMessageId = messageId;
					}
				} else if (lastMessage.toolCall) {
					sendEvent({
						type: 'tool_call',
						data: lastMessage.toolCall,
						timestamp: new Date().toISOString(),
					});
				} else if (lastMessage.toolResult) {
					sendEvent({
						type: 'tool_result',
						data: {
							content: lastMessage.toolResult,
							status: lastMessage.messageStatus,
						},
						timestamp: new Date().toISOString(),
					});
				}
			}
		};

		// Token 计数
		let tokenCount = 0;
		const setStreamTokenCount = (
			count: number | ((prev: number) => number),
		) => {
			if (typeof count === 'function') {
				tokenCount = count(tokenCount);
			} else {
				tokenCount = count;
			}
		};

		// 上下文使用
		const setContextUsage = (usage: any) => {
			sendEvent({
				type: 'usage',
				data: usage,
				timestamp: new Date().toISOString(),
			});
		};

		// 工具确认处理
		const requestToolConfirmation = async (
			toolCall: ToolCall,
			batchToolNames?: string,
			allTools?: ToolCall[],
		): Promise<ConfirmationResult> => {
			const requestId = this.generateRequestId();

			// 检测是否为敏感命令
			let isSensitive = false;
			let sensitiveInfo = undefined;
			if (toolCall.function.name === 'terminal-execute') {
				try {
					const args = JSON.parse(toolCall.function.arguments);
					if (args.command && typeof args.command === 'string') {
						const result = isSensitiveCommand(args.command);
						isSensitive = result.isSensitive;
						if (isSensitive && result.matchedCommand) {
							sensitiveInfo = {
								pattern: result.matchedCommand.pattern,
								description: result.matchedCommand.description,
							};
						}
					}
				} catch {
					// 忽略解析错误
				}
			}

			// 构建可用选项列表
			const availableOptions: Array<{
				value: ConfirmationResult | 'reject_with_reply';
				label: string;
			}> = [{value: 'approve', label: 'Approve once'}];

			// 非敏感命令才显示"总是批准"选项
			if (!isSensitive) {
				availableOptions.push({
					value: 'approve_always',
					label: 'Always approve',
				});
			}

			availableOptions.push(
				{value: 'reject_with_reply', label: 'Reject with reply'},
				{value: 'reject', label: 'Reject and end session'},
			);

			// 发送工具确认请求
			sendEvent({
				type: 'tool_confirmation_request',
				data: {
					toolCall,
					batchToolNames,
					allTools,
					isSensitive,
					sensitiveInfo,
					availableOptions,
				},
				timestamp: new Date().toISOString(),
				requestId,
			});

			// 等待客户端响应
			return this.waitForInteraction(requestId, 'tool_confirmation');
		};

		// 用户问题处理
		const requestUserQuestion = async (
			question: string,
			options: string[],
			toolCall: ToolCall,
			multiSelect?: boolean,
		): Promise<UserQuestionResult> => {
			const requestId = this.generateRequestId();

			// 发送用户问题请求
			sendEvent({
				type: 'user_question_request',
				data: {
					question,
					options,
					toolCall,
					multiSelect,
				},
				timestamp: new Date().toISOString(),
				requestId,
			});

			// 等待客户端响应
			return this.waitForInteraction(requestId, 'user_question');
		};

		// 获取当前工作目录的权限配置
		const workingDirectory = process.cwd();
		const permissionsConfig = loadPermissionsConfig(workingDirectory);
		const approvedToolsSet = new Set(permissionsConfig.alwaysApprovedTools);

		// 工具自动批准检查
		const isToolAutoApproved = (toolName: string) =>
			approvedToolsSet.has(toolName);

		// 添加到自动批准列表
		const addMultipleToAlwaysApproved = (toolNames: string[]) => {
			addMultipleToolsToPermissions(workingDirectory, toolNames);
			// 同步更新本地 Set
			toolNames.forEach(name => approvedToolsSet.add(name));
		};

		// 调用对话处理逻辑
		try {
			const result = await handleConversationWithTools({
				userContent: message.content || '',
				imageContents,
				controller,
				messages: messagesRef,
				saveMessage,
				setMessages,
				setStreamTokenCount,
				requestToolConfirmation,
				requestUserQuestion,
				isToolAutoApproved,
				addMultipleToAlwaysApproved,
				yoloMode: message.yoloMode || false, // 支持客户端传递 YOLO 模式
				setContextUsage,
			});

			// 发送完成事件（包含 sessionId）
			sendEvent({
				type: 'complete',
				data: {
					usage: result.usage,
					tokenCount,
					sessionId: currentSession.id,
				},
				timestamp: new Date().toISOString(),
			});

			// 清理 controller
			this.sessionControllers.delete(currentSession.id);
		} catch (error) {
			// 清理 controller
			this.sessionControllers.delete(currentSession.id);

			// 捕获用户主动中断的错误，作为正常流程结束
			if (
				error instanceof Error &&
				(error.message === 'Request aborted' ||
					error.message === 'User cancelled the interaction')
			) {
				// 发送中断确认事件
				sendEvent({
					type: 'message',
					data: {
						role: 'assistant',
						content:
							error.message === 'Request aborted'
								? 'Task has been aborted'
								: 'User cancelled the interaction',
					},
					timestamp: new Date().toISOString(),
				});

				// 发送完成事件
				sendEvent({
					type: 'complete',
					data: {
						usage: {input_tokens: 0, output_tokens: 0},
						tokenCount,
						sessionId: currentSession.id,
						cancelled: true,
					},
					timestamp: new Date().toISOString(),
				});
			} else {
				// 其他错误继续抛出，由外层的 handleClientMessage 处理
				throw error;
			}
		}
	}

	/**
	 * 等待交互响应
	 */
	private waitForInteraction(
		requestId: string,
		type: 'tool_confirmation' | 'user_question',
	): Promise<any> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingInteractions.delete(requestId);
				reject(new Error(`Interactive timeout: ${requestId}`));
			}, this.interactionTimeout);

			this.pendingInteractions.set(requestId, {
				requestId,
				type,
				resolve,
				reject,
				timeout,
			});
		});
	}

	/**
	 * 生成请求ID
	 */
	private generateRequestId(): string {
		return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	}

	/**
	 * 广播事件
	 */
	broadcast(event: SSEEvent): void {
		if (this.server) {
			this.server.broadcast(event);
		}
	}

	/**
	 * 获取运行状态
	 */
	isServerRunning(): boolean {
		return this.isRunning;
	}

	/**
	 * 获取连接数
	 */
	getConnectionCount(): number {
		return this.server?.getConnectionCount() ?? 0;
	}
}

// 导出单例
export const sseManager = new SSEManager();
