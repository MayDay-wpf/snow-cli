import {createServer, IncomingMessage, ServerResponse} from 'http';
import {parse as parseUrl} from 'url';

/**
 * SSE 事件类型定义
 */
export type SSEEventType =
	| 'connected'
	| 'message'
	| 'tool_call'
	| 'tool_result'
	| 'thinking'
	| 'usage'
	| 'error'
	| 'complete'
	| 'tool_confirmation_request'
	| 'user_question_request'
	| 'rollback_request'
	| 'rollback_result';

/**
 * SSE 事件数据结构
 */
export interface SSEEvent {
	type: SSEEventType;
	data: any;
	timestamp: string;
	requestId?: string; // 用于关联请求和响应
}

/**
 * 客户端输入消息结构
 */
export interface ClientMessage {
	type:
		| 'chat'
		| 'image'
		| 'tool_confirmation_response'
		| 'user_question_response'
		| 'abort' // 中断当前任务
		| 'rollback'; // 回滚会话/快照
	content?: string;
	images?: Array<{
		data: string; // base64 data URI (data:image/png;base64,...)
		mimeType: string;
	}>;
	requestId?: string; // 响应关联的请求ID
	response?: any; // 响应数据
	sessionId?: string; // 会话ID，用于连续对话
	yoloMode?: boolean; // YOLO 模式，自动批准所有工具
	rollback?: {
		messageIndex: number;
		rollbackFiles: boolean;
		selectedFiles?: string[];
		crossSessionRollback?: boolean;
		originalSessionId?: string;
	};
}

/**
 * SSE 客户端连接管理
 */
class SSEConnection {
	private response: ServerResponse;
	private connectionId: string;

	constructor(response: ServerResponse, connectionId: string) {
		this.response = response;
		this.connectionId = connectionId;

		// 设置 SSE 响应头
		this.response.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		});

		// 发送初始连接事件
		this.sendEvent({
			type: 'connected',
			data: {connectionId: this.connectionId},
			timestamp: new Date().toISOString(),
		});
	}

	/**
	 * 发送 SSE 事件
	 */
	sendEvent(event: SSEEvent): void {
		const eventData = `data: ${JSON.stringify(event)}\n\n`;
		this.response.write(eventData);
	}

	/**
	 * 关闭连接
	 */
	close(): void {
		this.response.end();
	}

	getId(): string {
		return this.connectionId;
	}
}

/**
 * SSE 服务器类
 */
export class SSEServer {
	private server: ReturnType<typeof createServer> | null = null;
	private connections: Map<string, SSEConnection> = new Map();
	private sessionConnections: Map<string, string> = new Map(); // sessionId -> connectionId 映射
	private port: number;
	private messageHandler?: (
		message: ClientMessage,
		sendEvent: (event: SSEEvent) => void,
		connectionId: string,
	) => Promise<void>;
	private logCallback?: (
		message: string,
		level?: 'info' | 'error' | 'success',
	) => void;

	constructor(port: number = 3000) {
		this.port = port;
	}

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
			console.log(`[${level.toUpperCase()}] ${message}`);
		}
	}

	/**
	 * 设置消息处理器
	 */
	setMessageHandler(
		handler: (
			message: ClientMessage,
			sendEvent: (event: SSEEvent) => void,
			connectionId: string,
		) => Promise<void>,
	): void {
		this.messageHandler = handler;
	}

	/**
	 * 启动 SSE 服务器
	 */
	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = createServer(
				(req: IncomingMessage, res: ServerResponse) => {
					this.handleRequest(req, res);
				},
			);

			this.server.on('error', error => {
				reject(error);
			});

			this.server.listen(this.port, () => {
				this.log(`SSE 服务器已启动，监听端口 ${this.port}`, 'success');
				resolve();
			});
		});
	}

	/**
	 * 停止 SSE 服务器
	 */
	stop(): Promise<void> {
		return new Promise(resolve => {
			// 关闭所有连接
			this.connections.forEach(conn => {
				conn.close();
			});
			this.connections.clear();
			this.sessionConnections.clear();

			if (this.server) {
				this.server.close(() => {
					this.log('SSE 服务器已停止', 'info');
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * 绑定 session 到连接
	 */
	bindSessionToConnection(sessionId: string, connectionId: string): void {
		this.sessionConnections.set(sessionId, connectionId);
		this.log(`Session ${sessionId} 绑定到连接 ${connectionId}`, 'info');
	}

	/**
	 * 向特定 session 发送事件
	 */
	sendToSession(sessionId: string, event: SSEEvent): void {
		const connectionId = this.sessionConnections.get(sessionId);
		if (connectionId) {
			const connection = this.connections.get(connectionId);
			if (connection) {
				connection.sendEvent(event);
			}
		}
	}

	/**
	 * 向特定连接发送事件
	 */
	sendToConnection(connectionId: string, event: SSEEvent): void {
		const connection = this.connections.get(connectionId);
		if (connection) {
			connection.sendEvent(event);
		}
	}

	/**
	 * 读取 JSON 请求体
	 */
	private async readJsonBody<T = any>(req: IncomingMessage): Promise<T> {
		return new Promise((resolve, reject) => {
			let body = '';
			req.on('data', chunk => {
				body += chunk.toString();
			});
			req.on('end', () => {
				try {
					resolve(body ? (JSON.parse(body) as T) : ({} as T));
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	/**
	 * 获取一个可用连接（优先指定 connectionId）
	 */
	private getActiveConnectionId(preferred?: string): string | undefined {
		if (preferred && this.connections.has(preferred)) {
			return preferred;
		}
		const firstConnection = this.connections.values().next().value as
			| SSEConnection
			| undefined;
		return firstConnection?.getId();
	}

	/**
	 * 处理 HTTP 请求
	 */
	private handleRequest(req: IncomingMessage, res: ServerResponse): void {
		const parsedUrl = parseUrl(req.url || '', true);
		const pathname = parsedUrl.pathname;

		// 处理 CORS 预检请求
		if (req.method === 'OPTIONS') {
			res.writeHead(200, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			});
			res.end();
			return;
		}

		// SSE 连接端点
		if (pathname === '/events' && req.method === 'GET') {
			this.handleSSEConnection(req, res);
			return;
		}

		// 会话创建端点
		if (pathname === '/session/create' && req.method === 'POST') {
			this.handleSessionCreate(req, res);
			return;
		}

		// 会话加载端点
		if (pathname === '/session/load' && req.method === 'POST') {
			this.handleSessionLoad(req, res);
			return;
		}

		// 回滚点列表端点（demo 使用）
		if (pathname === '/session/rollback-points' && req.method === 'GET') {
			this.handleSessionRollbackPoints(
				res,
				parsedUrl.query as Record<string, unknown>,
			);
			return;
		}

		// 会话列表端点
		if (pathname === '/session/list' && req.method === 'GET') {
			this.handleSessionList(
				req,
				res,
				parsedUrl.query as Record<string, unknown>,
			);
			return;
		}

		// 会话删除端点
		if (pathname?.startsWith('/session/') && req.method === 'DELETE') {
			this.handleSessionDelete(req, res, pathname);
			return;
		}

		// 消息发送端点
		if (pathname === '/message' && req.method === 'POST') {
			this.handleMessage(req, res);
			return;
		}

		// 健康检查端点
		if (pathname === '/health' && req.method === 'GET') {
			res.writeHead(200, {'Content-Type': 'application/json'});
			res.end(
				JSON.stringify({
					status: 'ok',
					connections: this.connections.size,
				}),
			);
			return;
		}

		// 上下文压缩端点
		if (pathname === '/context/compress' && req.method === 'POST') {
			this.handleContextCompress(req, res);
			return;
		}

		// 未知端点
		res.writeHead(404);
		res.end('Not Found');
	}

	private handleSessionCreate(req: IncomingMessage, res: ServerResponse): void {
		void (async () => {
			try {
				const {sessionManager} = await import(
					'../utils/session/sessionManager.js'
				);

				const body = await this.readJsonBody<{connectionId?: string}>(req);
				const connectionId = this.getActiveConnectionId(body.connectionId);
				if (!connectionId) {
					res.writeHead(400, {'Content-Type': 'application/json'});
					res.end(JSON.stringify({error: 'No active connection'}));
					return;
				}

				const session = await sessionManager.createNewSession();
				this.bindSessionToConnection(session.id, connectionId);

				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({success: true, session}));
			} catch (error) {
				res.writeHead(500, {'Content-Type': 'application/json'});
				res.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Unknown error',
					}),
				);
			}
		})();
	}

	private handleSessionLoad(req: IncomingMessage, res: ServerResponse): void {
		void (async () => {
			try {
				const {sessionManager} = await import(
					'../utils/session/sessionManager.js'
				);

				const body = await this.readJsonBody<{
					sessionId?: string;
					connectionId?: string;
				}>(req);
				if (!body.sessionId) {
					res.writeHead(400, {'Content-Type': 'application/json'});
					res.end(JSON.stringify({error: 'Missing sessionId'}));
					return;
				}

				const session = await sessionManager.loadSession(body.sessionId);
				if (!session) {
					res.writeHead(404, {'Content-Type': 'application/json'});
					res.end(JSON.stringify({error: 'Session not found'}));
					return;
				}

				sessionManager.setCurrentSession(session);
				const connectionId = this.getActiveConnectionId(body.connectionId);
				if (connectionId) {
					this.bindSessionToConnection(session.id, connectionId);
				}

				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({success: true, session}));
			} catch (error) {
				res.writeHead(500, {'Content-Type': 'application/json'});
				res.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Unknown error',
					}),
				);
			}
		})();
	}

	private handleSessionRollbackPoints(
		res: ServerResponse,
		query?: Record<string, unknown>,
	): void {
		void (async () => {
			try {
				const {sessionManager} = await import(
					'../utils/session/sessionManager.js'
				);
				const {hashBasedSnapshotManager} = await import(
					'../utils/codebase/hashBasedSnapshot.js'
				);

				const sessionIdRaw = query?.['sessionId'];
				const sessionId =
					typeof sessionIdRaw === 'string' ? sessionIdRaw.trim() : '';
				if (!sessionId) {
					res.writeHead(400, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					});
					res.end(JSON.stringify({success: false, error: 'Missing sessionId'}));
					return;
				}

				const session = await sessionManager.loadSession(sessionId);
				if (!session) {
					res.writeHead(404, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					});
					res.end(JSON.stringify({success: false, error: 'Session not found'}));
					return;
				}

				const snapshots = await hashBasedSnapshotManager.listSnapshots(
					sessionId,
				);
				const snapshotByIndex = new Map<
					number,
					{timestamp: number; fileCount: number}
				>();
				for (const s of snapshots) {
					snapshotByIndex.set(s.messageIndex, {
						timestamp: s.timestamp,
						fileCount: s.fileCount,
					});
				}

				const points: Array<{
					messageIndex: number;
					role: 'user';
					timestamp: number;
					summary: string;
					hasSnapshot: boolean;
					snapshot?: {timestamp: number; fileCount: number};
					filesToRollbackCount: number;
				}> = [];

				const maxSummaryLen = 120;
				for (let i = 0; i < session.messages.length; i++) {
					const m: any = session.messages[i];
					if (!m || m.role !== 'user') continue;
					const content = typeof m.content === 'string' ? m.content : '';
					const normalized = content.replace(/\s+/g, ' ').trim();
					const summary =
						normalized.length > maxSummaryLen
							? normalized.slice(0, maxSummaryLen) + '…'
							: normalized;

					// Snapshot 的 messageIndex 和 session.messages 的索引并不总是一致。
					// 实测快照通常对应“下一条消息写入前”的索引（例如首条 user 消息后快照会落在 1）。
					const snapAtNext = snapshotByIndex.get(i + 1);
					const snapAtCurrent = snapshotByIndex.get(i);
					const snap = snapAtNext ?? snapAtCurrent;
					const rollbackIndex = snapAtNext ? i + 1 : i;

					let filesToRollbackCount = 0;
					if (snap && snap.fileCount > 0) {
						const files = await hashBasedSnapshotManager.getFilesToRollback(
							sessionId,
							rollbackIndex,
						);
						filesToRollbackCount = Array.isArray(files) ? files.length : 0;
					}

					points.push({
						messageIndex: i,
						role: 'user',
						timestamp: typeof m.timestamp === 'number' ? m.timestamp : 0,
						summary,
						hasSnapshot: !!snap && snap.fileCount > 0,
						snapshot: snap,
						filesToRollbackCount,
					});

					// 如果快照存在但落在 i+1（常见），让前端能直接用 messageIndex 作为回滚点索引。
					if (
						snapAtNext &&
						snapAtNext.fileCount > 0 &&
						i + 1 < session.messages.length
					) {
						// 这里不改变 messageIndex 的语义，仅用于确保 hasSnapshot 展示正确。
					}
				}

				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({success: true, sessionId, points}));
			} catch (error) {
				res.writeHead(500, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(
					JSON.stringify({
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
					}),
				);
			}
		})();
	}

	private handleSessionList(
		_req: IncomingMessage,
		res: ServerResponse,
		query?: Record<string, unknown>,
	): void {
		void (async () => {
			try {
				const {sessionManager} = await import(
					'../utils/session/sessionManager.js'
				);

				const pageRaw = query?.['page'];
				const pageSizeRaw = query?.['pageSize'];
				const searchQueryRaw = query?.['q'];

				const page = Math.max(
					0,
					Number.parseInt(String(pageRaw ?? '0'), 10) || 0,
				);
				const pageSize = Math.min(
					200,
					Math.max(1, Number.parseInt(String(pageSizeRaw ?? '20'), 10) || 20),
				);
				const searchQuery =
					typeof searchQueryRaw === 'string' && searchQueryRaw.trim()
						? searchQueryRaw.trim()
						: undefined;

				const result = await sessionManager.listSessionsPaginated(
					page,
					pageSize,
					searchQuery,
				);

				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(
					JSON.stringify({
						success: true,
						page,
						pageSize,
						searchQuery,
						...result,
					}),
				);
			} catch (error) {
				res.writeHead(500, {'Content-Type': 'application/json'});
				res.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Unknown error',
					}),
				);
			}
		})();
	}

	private handleSessionDelete(
		_req: IncomingMessage,
		res: ServerResponse,
		pathname: string,
	): void {
		void (async () => {
			try {
				const {sessionManager} = await import(
					'../utils/session/sessionManager.js'
				);

				const parts = pathname.split('/').filter(Boolean);
				const sessionId = parts[1];
				if (!sessionId) {
					res.writeHead(400, {'Content-Type': 'application/json'});
					res.end(JSON.stringify({error: 'Missing sessionId'}));
					return;
				}

				const deleted = await sessionManager.deleteSession(sessionId);
				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({success: true, deleted}));
			} catch (error) {
				res.writeHead(500, {'Content-Type': 'application/json'});
				res.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Unknown error',
					}),
				);
			}
		})();
	}

	/**
	 * 处理上下文压缩请求
	 * POST /context/compress
	 * Body: { messages: ChatMessage[] } 或 { sessionId: string }
	 * Response: { success: true, result: CompressionResult } 或 { success: false, error: string }
	 */
	private handleContextCompress(
		req: IncomingMessage,
		res: ServerResponse,
	): void {
		void (async () => {
			try {
				const {compressContext} = await import(
					'../utils/core/contextCompressor.js'
				);
				const {sessionManager} = await import(
					'../utils/session/sessionManager.js'
				);

				const body = await this.readJsonBody<{
					messages?: Array<{role: string; content: string; [key: string]: any}>;
					sessionId?: string;
				}>(req);

				let messages: Array<{
					role: string;
					content: string;
					[key: string]: any;
				}>;

				// 支持两种方式：直接传入 messages 或通过 sessionId 获取
				if (body.messages && Array.isArray(body.messages)) {
					messages = body.messages;
				} else if (body.sessionId) {
					const session = await sessionManager.loadSession(body.sessionId);
					if (!session) {
						res.writeHead(404, {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						});
						res.end(
							JSON.stringify({success: false, error: 'Session not found'}),
						);
						return;
					}
					messages = session.messages || [];
				} else {
					res.writeHead(400, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					});
					res.end(
						JSON.stringify({
							success: false,
							error: 'Missing required field: messages or sessionId',
						}),
					);
					return;
				}

				if (messages.length === 0) {
					res.writeHead(400, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					});
					res.end(
						JSON.stringify({success: false, error: 'No messages to compress'}),
					);
					return;
				}

				const result = await compressContext(messages as any);

				if (result === null) {
					res.writeHead(200, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					});
					res.end(
						JSON.stringify({
							success: true,
							result: null,
							message: 'Compression skipped (no history to compress)',
						}),
					);
					return;
				}

				if (result.hookFailed) {
					res.writeHead(200, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					});
					res.end(
						JSON.stringify({
							success: false,
							hookFailed: true,
							hookErrorDetails: result.hookErrorDetails,
						}),
					);
					return;
				}

				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({success: true, result}));
			} catch (error) {
				res.writeHead(500, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(
					JSON.stringify({
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
					}),
				);
			}
		})();
	}

	/**
	 * 处理 SSE 连接
	 */
	private handleSSEConnection(req: IncomingMessage, res: ServerResponse): void {
		const connectionId = `conn_${Date.now()}_${Math.random()
			.toString(36)
			.substring(7)}`;
		const connection = new SSEConnection(res, connectionId);

		this.connections.set(connectionId, connection);

		// 连接关闭时清理
		req.on('close', () => {
			this.connections.delete(connectionId);
			this.log(`SSE 连接已关闭: ${connectionId}`, 'info');
		});

		this.log(`新的 SSE 连接: ${connectionId}`, 'success');
	}

	/**
	 * 处理客户端消息
	 */
	private handleMessage(req: IncomingMessage, res: ServerResponse): void {
		let body = '';

		req.on('data', chunk => {
			body += chunk.toString();
		});

		req.on('end', async () => {
			try {
				const message: ClientMessage = JSON.parse(body);

				// 验证消息格式
				if (!message.type || (!message.content && message.type === 'chat')) {
					res.writeHead(400, {'Content-Type': 'application/json'});
					res.end(JSON.stringify({error: 'Invalid message format'}));
					return;
				}

				// 根据 sessionId 获取对应的连接ID
				let targetConnectionId: string | undefined;
				if (message.sessionId) {
					targetConnectionId = this.sessionConnections.get(message.sessionId);
					if (!targetConnectionId) {
						// Session 不存在或连接已断开，使用第一个可用连接
						const firstConnection = this.connections.values().next().value;
						if (firstConnection) {
							targetConnectionId = firstConnection.getId();
						}
					}
				} else {
					// 没有指定 sessionId，使用第一个可用连接
					const firstConnection = this.connections.values().next().value;
					if (firstConnection) {
						targetConnectionId = firstConnection.getId();
					}
				}

				if (!targetConnectionId) {
					res.writeHead(400, {'Content-Type': 'application/json'});
					res.end(JSON.stringify({error: 'No active connection'}));
					return;
				}

				// 向特定连接发送事件的函数
				const sendEvent = (event: SSEEvent) => {
					this.sendToConnection(targetConnectionId!, event);
				};

				// 调用消息处理器
				if (this.messageHandler) {
					await this.messageHandler(message, sendEvent, targetConnectionId);
				}

				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({success: true}));
			} catch (error) {
				res.writeHead(500, {'Content-Type': 'application/json'});
				res.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Unknown error',
					}),
				);
			}
		});
	}

	/**
	 * 广播事件到所有连接
	 */
	broadcast(event: SSEEvent): void {
		this.connections.forEach(conn => {
			conn.sendEvent(event);
		});
	}

	/**
	 * 获取当前连接数
	 */
	getConnectionCount(): number {
		return this.connections.size;
	}
}
