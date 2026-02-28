import * as signalR from '@microsoft/signalr';
import * as fs from 'fs';
import * as path from 'path';

export type ConnectionStatus =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'reconnecting';

export interface ConnectionConfig {
	apiUrl: string;
	username: string;
	password: string;
	instanceId: string;
	instanceName: string;
}

export interface ConnectionState {
	status: ConnectionStatus;
	instanceId?: string;
	instanceName?: string;
	token?: string;
	error?: string;
}

type StatusChangeCallback = (state: ConnectionState) => void;
type MessageCallback = (message: unknown) => void;

class ConnectionManager {
	private connection: signalR.HubConnection | null = null;
	private state: ConnectionState = {status: 'disconnected'};
	private statusCallbacks: StatusChangeCallback[] = [];
	private messageCallbacks: Map<string, MessageCallback[]> = new Map();
	private heartbeatInterval: NodeJS.Timeout | null = null;
	private config: ConnectionConfig | null = null;
	private messageListenerUnsubscribe: (() => void) | null = null;
	private readonly MAX_RECONNECT_ATTEMPTS = 3;
	// CLI streaming state - directly reflects the CLI's streamStatus ('idle' | 'streaming' | 'stopping')
	private streamingState: 'idle' | 'streaming' | 'stopping' = 'idle';
	private pendingToolConfirmations = new Map<
		string,
		{toolName: string; toolArguments: string; toolCallId: string}
	>();
	private pendingQuestions = new Map<
		string,
		{
			question: string;
			options: string[];
			toolCallId: string;
			multiSelect: boolean;
		}
	>();
	private pendingRollbackConfirmation: {
		filePaths: string[];
		notebookCount: number;
	} | null = null;

	private hasPendingInteractions(): boolean {
		return (
			this.pendingToolConfirmations.size > 0 ||
			this.pendingQuestions.size > 0 ||
			this.pendingRollbackConfirmation !== null
		);
	}

	private clearInFlightInteractions(): void {
		this.pendingToolConfirmations.clear();
		this.pendingQuestions.clear();
		this.pendingRollbackConfirmation = null;
	}

	// Set the CLI streaming state - should be called by ChatScreen when streamStatus changes
	setStreamingState(state: 'idle' | 'streaming' | 'stopping'): void {
		this.streamingState = state;
	}

	// Subscribe to status changes
	onStatusChange(callback: StatusChangeCallback): () => void {
		this.statusCallbacks.push(callback);
		// Immediately notify current state
		callback(this.state);
		return () => {
			const index = this.statusCallbacks.indexOf(callback);
			if (index > -1) {
				this.statusCallbacks.splice(index, 1);
			}
		};
	}

	// Subscribe to specific message types
	onMessage(type: string, callback: MessageCallback): () => void {
		if (!this.messageCallbacks.has(type)) {
			this.messageCallbacks.set(type, []);
		}
		this.messageCallbacks.get(type)!.push(callback);
		return () => {
			const callbacks = this.messageCallbacks.get(type);
			if (callbacks) {
				const index = callbacks.indexOf(callback);
				if (index > -1) {
					callbacks.splice(index, 1);
				}
			}
		};
	}

	private updateState(newState: Partial<ConnectionState>): void {
		this.state = {...this.state, ...newState};
		this.statusCallbacks.forEach(callback => callback(this.state));
	}

	private notifyMessage(type: string, message: unknown): void {
		const callbacks = this.messageCallbacks.get(type);
		if (callbacks) {
			callbacks.forEach(callback => callback(message));
		}
	}

	// Login to get token
	async login(
		config: ConnectionConfig,
	): Promise<{success: boolean; message: string}> {
		this.config = config;
		try {
			const response = await fetch(`${config.apiUrl}/auth/login`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					username: config.username,
					password: config.password,
				}),
			});

			const data = await response.json();

			if (data.success && data.token) {
				this.updateState({token: data.token, error: undefined});
				return {
					success: true,
					message: `Login successful: ${
						data.user?.username || config.username
					}`,
				};
			} else {
				return {success: false, message: `Login failed: ${data.message}`};
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Login error';
			return {success: false, message: `Login error: ${message}`};
		}
	}

	// Connect to SignalR hub
	async connect(): Promise<{success: boolean; message: string}> {
		if (!this.config || !this.state.token) {
			return {success: false, message: 'Please login first'};
		}

		if (this.connection?.state === signalR.HubConnectionState.Connected) {
			return {success: true, message: 'Already connected'};
		}

		// Check if instance ID is already locked by another process
		if (this.isInstanceLocked(this.config.instanceId)) {
			return {
				success: false,
				message: `Instance ID "${this.config.instanceId}" is already in use by another process`,
			};
		}

		this.updateState({status: 'connecting', error: undefined});

		try {
			const baseUrl = this.config.apiUrl.replace(/\/api$/, '');
			const hubUrl = `${baseUrl}/hubs/instance`;

			this.connection = new signalR.HubConnectionBuilder()
				.withUrl(hubUrl, {
					accessTokenFactory: () => this.state.token!,
					skipNegotiation: true,
					transport: signalR.HttpTransportType.WebSockets,
				})
				.withAutomaticReconnect({
					nextRetryDelayInMilliseconds: retryContext => {
						// 指数退避：1s, 2s, 4s，最多重试3次
						if (
							retryContext.previousRetryCount >= this.MAX_RECONNECT_ATTEMPTS
						) {
							return null; // 停止重试
						}
						return Math.pow(2, retryContext.previousRetryCount) * 1000;
					},
				})
				.configureLogging(signalR.LogLevel.None)
				.build();

			// Handle reconnection events
			this.connection.onreconnecting(error => {
				this.updateState({status: 'reconnecting', error: error?.message});
				this.notifyMessage('system', {
					type: 'reconnecting',
					message: `Reconnecting...`,
				});
			});

			this.connection.onreconnected(() => {
				this.updateState({status: 'connected'});
				this.notifyMessage('system', {
					type: 'reconnected',
					message: 'Reconnected successfully',
				});
				// Re-register instance after reconnection
				void this.registerInstance();
			});

			this.connection.onclose(() => {
				this.stopHeartbeat();
				this.cleanupMessageListener();
				this.clearInFlightInteractions();
				this.updateState({status: 'disconnected'});
				this.notifyMessage('system', {
					type: 'closed',
					message: 'Connection closed',
				});
			});

			// Handle server-initiated client methods
			this.connection.on('instanceconnected', (message: unknown) => {
				this.notifyMessage('system', {
					type: 'instance_connected',
					message:
						typeof message === 'string'
							? message
							: 'Instance connected to server',
				});
			});

			// Handle instance disconnected from server
			this.connection.on('instancedisconnected', (message: unknown) => {
				this.notifyMessage('system', {
					type: 'instance_disconnected',
					message:
						typeof message === 'string'
							? message
							: 'Instance disconnected from server',
				});
			});

			// Handle context info request from server
			this.connection.on('requestcontextinfo', async () => {
				try {
					const contextInfo = await this.getContextInfo();
					await this.connection!.invoke('SendContextInfo', contextInfo);
				} catch (error) {
					const message =
						error instanceof Error
							? error.message
							: 'Failed to send context info';
					this.notifyMessage('system', {
						type: 'error',
						message: `Context info error: ${message}`,
					});
				}
			});

			// Handle receiving context info from other instances (broadcast from server)
			this.connection.on('receivecontextinfo', (contextData: string) => {
				try {
					const data = JSON.parse(contextData);
					this.notifyMessage('system', {
						type: 'context_info_received',
						message: `Received context from another instance`,
						data: data,
					});
				} catch (error) {
					const message =
						error instanceof Error
							? error.message
							: 'Failed to parse context info';
					this.notifyMessage('system', {
						type: 'error',
						message: `Context info parse error: ${message}`,
					});
				}
			});

			// Handle receiving message from Web client (via server)
			this.connection.on('receivemessage', (message: string) => {
				this.notifyMessage('remote_message', {
					type: 'remote_message',
					message: message,
					timestamp: new Date().toISOString(),
				});
			});

			// Handle tool confirmation result from Web client (via server)
			this.connection.on(
				'receivetoolconfirmationresult',
				(result: {
					toolCallId: string;
					result: 'approve' | 'approve_always' | 'reject' | 'reject_with_reply';
					reason?: string;
				}) => {
					this.pendingToolConfirmations.delete(result.toolCallId);
					this.notifyMessage('tool_confirmation_result', {
						type: 'tool_confirmation_result',
						...result,
						timestamp: new Date().toISOString(),
					});
				},
			);

			// Handle user question result from Web client (via server)
			this.connection.on(
				'receiveuserquestionresult',
				(result: {
					toolCallId: string;
					selected: string;
					customInput?: string;
					cancelled?: boolean;
				}) => {
					this.pendingQuestions.delete(result.toolCallId);
					this.notifyMessage('user_question_result', {
						type: 'user_question_result',
						...result,
						timestamp: new Date().toISOString(),
					});
				},
			);

			// Handle message processing completed from instance (via server)
			this.connection.on(
				'receivemessageprocessingcompleted',
				(instanceId: string) => {
					this.clearInFlightInteractions();
					this.notifyMessage('message_processing_completed', {
						type: 'message_processing_completed',
						instanceId,
						timestamp: new Date().toISOString(),
					});
				},
			);

			// Handle interrupt signal from Web client (via server)
			this.connection.on('receiveinterruptmessageprocessing', () => {
				this.clearInFlightInteractions();
				this.notifyMessage('interrupt_message_processing', {
					type: 'interrupt_message_processing',
					timestamp: new Date().toISOString(),
				});
			});

			// Handle clear-session signal from Web client (via server)
			this.connection.on('receiveclearsession', () => {
				this.clearInFlightInteractions();
				this.notifyMessage('clear_session', {
					type: 'clear_session',
					timestamp: new Date().toISOString(),
				});
			});

			// Handle force-offline signal from Web client (via server)
			this.connection.on('receiveforceoffline', async () => {
				this.notifyMessage('force_offline', {
					type: 'force_offline',
					message: 'Received force-offline signal from server',
					timestamp: new Date().toISOString(),
				});
				await this.disconnect();
			});

			// Handle rollback signal from Web client (via server)
			this.connection.on(
				'receiverollbackmessage',
				(userMessageOrder: number) => {
					// 新回滚流程开始前清空旧交互状态，避免把历史 pending 带入新上下文
					this.clearInFlightInteractions();
					this.notifyMessage('rollback_message', {
						type: 'rollback_message',
						userMessageOrder,
						timestamp: new Date().toISOString(),
					});
				},
			);

			// Handle resume-session signal from Web client (via server)
			this.connection.on('receiveresumesession', (sessionId: string) => {
				this.notifyMessage('resume_session', {
					type: 'resume_session',
					sessionId,
					timestamp: new Date().toISOString(),
				});
			});

			// Handle rollback confirmation result from Web client (via server)
			this.connection.on(
				'receiverollbackconfirmationresult',
				(result: {rollbackFiles: boolean | null; selectedFiles?: string[]}) => {
					// 回滚确认已给出，必须立即清理待确认状态，避免后续上下文持续携带旧状态
					this.pendingRollbackConfirmation = null;
					this.notifyMessage('rollback_confirmation_result', {
						type: 'rollback_confirmation_result',
						...result,
						timestamp: new Date().toISOString(),
					});
				},
			);

			// Handle file list request from Web client (via server)
			this.connection.on(
				'receivefilelistrequest',
				async (requestId: string) => {
					try {
						const files = await this.getProjectFileList();
						await this.connection!.invoke(
							'SendFileListResult',
							requestId,
							JSON.stringify(files),
						);
					} catch {
						await this.connection!.invoke(
							'SendFileListResult',
							requestId,
							JSON.stringify([]),
						).catch(() => {
							// Silently fail
						});
					}
				},
			);

			// Handle session list request from Web client (via server)
			this.connection.on(
				'receivesessionlistrequest',
				async (
					requestId: string,
					page: number,
					pageSize: number,
					searchQuery: string,
				) => {
					try {
						const result = await this.getProjectSessionList(
							page,
							pageSize,
							searchQuery,
						);
						await this.connection!.invoke(
							'SendSessionListResult',
							requestId,
							JSON.stringify(result),
						);
					} catch {
						await this.connection!.invoke(
							'SendSessionListResult',
							requestId,
							JSON.stringify({sessions: [], total: 0, hasMore: false}),
						).catch(() => {
							// Silently fail
						});
					}
				},
			);

			await this.connection.start();

			// Register instance
			await this.registerInstance();

			// Start heartbeat
			this.startHeartbeat();

			// Setup message listener for auto-push
			this.setupMessageListener();

			// Lock instance ID after successful connection
			this.lockInstance(this.config.instanceId);

			this.updateState({
				status: 'connected',
				instanceId: this.config.instanceId,
				instanceName: this.config.instanceName,
			});

			return {success: true, message: 'Connected successfully'};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Connection error';
			this.updateState({status: 'disconnected', error: message});
			return {success: false, message: `Connection failed: ${message}`};
		}
	}

	// Register instance with the server
	private async registerInstance(): Promise<void> {
		if (!this.connection || !this.config) return;

		try {
			await this.connection.invoke(
				'RegisterInstance',
				this.config.instanceId,
				this.config.instanceName,
			);
			this.notifyMessage('system', {
				type: 'registered',
				message: `Instance registered: ${this.config.instanceName} (${this.config.instanceId})`,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Registration error';
			this.notifyMessage('system', {
				type: 'error',
				message: `Registration failed: ${message}`,
			});
		}
	}

	// Start heartbeat
	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatInterval = setInterval(async () => {
			if (this.connection?.state === signalR.HubConnectionState.Connected) {
				try {
					await this.connection.invoke('Heartbeat');
				} catch (error) {
					const message =
						error instanceof Error ? error.message : 'Heartbeat error';
					this.notifyMessage('system', {type: 'heartbeat_error', message});
				}
			}
		}, 30000);
	}

	// Stop heartbeat
	private stopHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	// Disconnect
	async disconnect(): Promise<{success: boolean; message: string}> {
		this.stopHeartbeat();
		this.cleanupMessageListener();
		this.clearInFlightInteractions();

		// Unlock instance ID
		if (this.config?.instanceId) {
			this.unlockInstance(this.config.instanceId);
		}

		if (this.connection) {
			try {
				await this.connection.stop();
			} catch (error) {
				// Ignore disconnection errors
			}
			this.connection = null;
		}

		this.updateState({
			status: 'disconnected',
			instanceId: undefined,
			instanceName: undefined,
			token: undefined,
			error: undefined,
		});

		return {success: true, message: 'Disconnected'};
	}

	// Get current conversation messages (real-time chat history)
	private async getContextInfo(): Promise<string> {
		try {
			// Import sessionManager dynamically to avoid circular dependency
			const {sessionManager} = await import('../session/sessionManager.js');

			const currentSession = sessionManager.getCurrentSession();

			if (!currentSession) {
				return JSON.stringify({
					error: 'No active conversation session',
					timestamp: new Date().toISOString(),
				});
			}

			// Get conversation messages
			const messages = currentSession.messages.map(msg => ({
				role: msg.role,
				content:
					typeof msg.content === 'string'
						? msg.content
						: JSON.stringify(msg.content),
				timestamp: msg.timestamp,
				// Include tool calls if present
				...(msg.tool_calls && {tool_calls: msg.tool_calls}),
				...(msg.tool_call_id && {tool_call_id: msg.tool_call_id}),
			}));

			return JSON.stringify({
				sessionId: currentSession.id,
				sessionTitle: currentSession.title,
				messageCount: currentSession.messageCount,
				messages: messages,
				inFlightState: this.getInFlightState(),
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
				timestamp: new Date().toISOString(),
			});
		}
	}

	// Push context info to server (called when messages change)
	private async pushContextInfo(): Promise<void> {
		if (!this.connection || this.state.status !== 'connected') {
			return;
		}

		try {
			const contextInfo = await this.getContextInfo();
			await this.connection.invoke('SendContextInfo', contextInfo);
		} catch (error) {
			// Silently fail - don't spam errors for push failures
		}
	}

	// Setup message listener to auto-push updates
	private setupMessageListener(): void {
		// Avoid duplicate listeners on reconnect
		if (this.messageListenerUnsubscribe) {
			this.messageListenerUnsubscribe();
			this.messageListenerUnsubscribe = null;
		}

		// Import sessionManager and setup listener for all message changes
		import('../session/sessionManager.js')
			.then(({sessionManager}) => {
				// Listen for all message list changes (add, truncate, switch session, clear, etc.)
				this.messageListenerUnsubscribe = sessionManager.onMessagesChanged(
					() => {
						// Push context info when messages change
						void this.pushContextInfo();
					},
				);
			})
			.catch(() => {
				// Ignore errors during setup
			});
	}

	// Cleanup message listener
	private cleanupMessageListener(): void {
		if (this.messageListenerUnsubscribe) {
			this.messageListenerUnsubscribe();
			this.messageListenerUnsubscribe = null;
		}
	}
	// Get connection config file path (project root/.snow/connection.json)
	private getConfigPath(): string {
		return path.join(process.cwd(), '.snow', 'connection.json');
	}

	// Get instance lock file path (project root/.snow/locks/{instanceId}.lock)
	private getInstanceLockPath(instanceId: string): string {
		return path.join(process.cwd(), '.snow', 'locks', `${instanceId}.lock`);
	}

	// Ensure .snow/locks directory exists
	private ensureLocksDir(): void {
		const locksDir = path.join(process.cwd(), '.snow', 'locks');
		if (!fs.existsSync(locksDir)) {
			fs.mkdirSync(locksDir, {recursive: true});
		}
	}

	// Check if instance ID is already locked by another process
	private isInstanceLocked(instanceId: string): boolean {
		try {
			const lockPath = this.getInstanceLockPath(instanceId);
			if (!fs.existsSync(lockPath)) {
				return false;
			}

			// Read lock file to get PID
			const lockContent = fs.readFileSync(lockPath, 'utf-8');
			const lockData = JSON.parse(lockContent) as {
				pid: number;
				timestamp: number;
			};

			// Check if the process is still running
			try {
				// On Windows, process.kill(0) throws if process doesn't exist
				// On Unix, it returns false
				process.kill(lockData.pid, 0);
				return true; // Process is still running
			} catch {
				// Process doesn't exist anymore, stale lock
				fs.unlinkSync(lockPath);
				return false;
			}
		} catch {
			return false;
		}
	}

	// Lock instance ID for current process
	private lockInstance(instanceId: string): boolean {
		try {
			this.ensureLocksDir();
			const lockPath = this.getInstanceLockPath(instanceId);

			// Double-check lock
			if (this.isInstanceLocked(instanceId)) {
				return false;
			}

			// Create lock file with current PID and timestamp
			const lockData = {
				pid: process.pid,
				timestamp: Date.now(),
			};
			fs.writeFileSync(lockPath, JSON.stringify(lockData), 'utf-8');
			return true;
		} catch {
			return false;
		}
	}

	// Unlock instance ID
	private unlockInstance(instanceId: string): void {
		try {
			const lockPath = this.getInstanceLockPath(instanceId);
			if (fs.existsSync(lockPath)) {
				fs.unlinkSync(lockPath);
			}
		} catch {
			// Ignore unlock errors
		}
	}

	// Ensure .snow directory exists
	private ensureSnowDir(): void {
		const snowDir = path.join(process.cwd(), '.snow');
		if (!fs.existsSync(snowDir)) {
			fs.mkdirSync(snowDir, {recursive: true});
		}
	}

	// Save connection config to file
	async saveConnectionConfig(config: ConnectionConfig): Promise<void> {
		try {
			this.ensureSnowDir();
			const configPath = this.getConfigPath();
			// Save full config including password
			fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
		} catch {
			// Ignore save errors
		}
	}

	// Load connection config from file
	loadConnectionConfig(): ConnectionConfig | null {
		try {
			const configPath = this.getConfigPath();
			if (!fs.existsSync(configPath)) {
				return null;
			}
			const content = fs.readFileSync(configPath, 'utf-8');
			const config = JSON.parse(content) as ConnectionConfig;
			return config;
		} catch {
			return null;
		}
	}

	// Check if saved connection config exists
	hasSavedConnection(): boolean {
		try {
			const configPath = this.getConfigPath();
			return fs.existsSync(configPath);
		} catch {
			return false;
		}
	}

	// Clear saved connection config
	clearSavedConnection(): void {
		try {
			const configPath = this.getConfigPath();
			if (fs.existsSync(configPath)) {
				fs.unlinkSync(configPath);
			}
		} catch {
			// Ignore clear errors
		}
	}

	// Get current state
	getState(): ConnectionState {
		return {...this.state};
	}

	getInFlightState(): {
		isMessageProcessing: boolean;
		pendingToolConfirmations: Array<{
			toolName: string;
			toolArguments: string;
			toolCallId: string;
		}>;
		pendingQuestions: Array<{
			question: string;
			options: string[];
			toolCallId: string;
			multiSelect: boolean;
		}>;
		pendingRollbackConfirmation: {
			filePaths: string[];
			notebookCount: number;
		} | null;
	} {
		return {
			// Use CLI streaming state directly instead of local variable
			isMessageProcessing:
				this.streamingState === 'streaming' ||
				this.streamingState === 'stopping' ||
				this.hasPendingInteractions(),
			pendingToolConfirmations: Array.from(
				this.pendingToolConfirmations.values(),
			),
			pendingQuestions: Array.from(this.pendingQuestions.values()),
			pendingRollbackConfirmation: this.pendingRollbackConfirmation
				? {
						filePaths: [...this.pendingRollbackConfirmation.filePaths],
						notebookCount: this.pendingRollbackConfirmation.notebookCount,
				  }
				: null,
		};
	}

	// Check if connected
	isConnected(): boolean {
		return this.state.status === 'connected';
	}

	// Send message to server (for future use)
	async sendMessage(method: string, ...args: unknown[]): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			throw new Error('Not connected');
		}

		await this.connection.invoke(method, ...args);
	}

	// Notify server that tool confirmation is needed
	async notifyToolConfirmationNeeded(
		toolName: string,
		toolArguments: string,
		toolCallId: string,
		allTools?: Array<{name: string; arguments: string}>,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return; // Silently fail if not connected
		}

		this.pendingToolConfirmations.set(toolCallId, {
			toolName,
			toolArguments,
			toolCallId,
		});

		try {
			await this.connection.invoke(
				'NotifyToolConfirmationNeeded',
				toolName,
				toolArguments,
				toolCallId,
				allTools ? JSON.stringify(allTools) : null,
			);
		} catch {
			// Silently fail - don't block CLI functionality
		}
	}

	// Notify server that user interaction (ask_question) is needed
	async notifyUserInteractionNeeded(
		question: string,
		options: string[],
		toolCallId: string,
		multiSelect?: boolean,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return; // Silently fail if not connected
		}

		this.pendingQuestions.set(toolCallId, {
			question,
			options,
			toolCallId,
			multiSelect: multiSelect ?? false,
		});

		try {
			await this.connection.invoke(
				'NotifyUserInteractionNeeded',
				question,
				JSON.stringify(options),
				toolCallId,
				multiSelect ?? false,
			);
		} catch {
			// Silently fail - don't block CLI functionality
		}
	}

	// Notify server that rollback confirmation is needed
	async notifyRollbackConfirmationNeeded(payload: {
		filePaths: string[];
		notebookCount?: number;
	}): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		this.pendingRollbackConfirmation = {
			filePaths: payload.filePaths || [],
			notebookCount: payload.notebookCount ?? 0,
		};

		try {
			await this.connection.invoke(
				'NotifyRollbackConfirmationNeeded',
				JSON.stringify(payload.filePaths || []),
				payload.notebookCount ?? 0,
			);
		} catch {
			// Silently fail - do not block local rollback flow
		}
	}

	// Send tool confirmation result (when user approves/rejects)
	async sendToolConfirmationResult(
		toolCallId: string,
		result: 'approve' | 'approve_always' | 'reject' | 'reject_with_reply',
		reason?: string,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		this.pendingToolConfirmations.delete(toolCallId);

		try {
			await this.connection.invoke(
				'SendToolConfirmationResult',
				toolCallId,
				result,
				reason ?? null,
			);
		} catch {
			// Silently fail
		}
	}

	// Send user question result (when user answers)
	async sendUserQuestionResult(
		toolCallId: string,
		selected: string | string[],
		customInput?: string,
		cancelled?: boolean,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		this.pendingQuestions.delete(toolCallId);

		try {
			await this.connection.invoke(
				'SendUserQuestionResult',
				toolCallId,
				Array.isArray(selected) ? JSON.stringify(selected) : selected,
				customInput ?? null,
				cancelled ?? false,
			);
		} catch {
			// Silently fail
		}
	}

	private async getProjectFileList(): Promise<string[]> {
		const result: string[] = [];
		const maxFiles = 500;
		const rootDir = process.cwd();
		const ignoreDirs = new Set([
			'node_modules',
			'dist',
			'build',
			'coverage',
			'.git',
			'.vscode',
			'.idea',
			'bin',
			'obj',
			'target',
		]);

		const walk = async (dir: string): Promise<void> => {
			if (result.length >= maxFiles) {
				return;
			}
			const entries = await fs.promises.readdir(dir, {withFileTypes: true});
			for (const entry of entries) {
				if (result.length >= maxFiles) {
					return;
				}
				if (entry.name.startsWith('.') && entry.name !== '.snow') {
					continue;
				}
				if (ignoreDirs.has(entry.name)) {
					continue;
				}
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(fullPath);
					continue;
				}
				const relativePath = path
					.relative(rootDir, fullPath)
					.replace(/\\/g, '/');
				result.push(
					relativePath.startsWith('.') ? relativePath : `./${relativePath}`,
				);
			}
		};

		await walk(rootDir);
		return result;
	}

	private async getProjectSessionList(
		page = 0,
		pageSize = 20,
		searchQuery = '',
	): Promise<{
		sessions: Array<{
			id: string;
			title: string;
			updatedAt: number;
			messageCount: number;
		}>;
		total: number;
		hasMore: boolean;
	}> {
		const {sessionManager} = await import('../session/sessionManager.js');
		const safePage = Math.max(0, Number.isFinite(page) ? page : 0);
		const safePageSize = Math.min(
			100,
			Math.max(1, Number.isFinite(pageSize) ? pageSize : 20),
		);
		const result = await sessionManager.listSessionsPaginated(
			safePage,
			safePageSize,
			searchQuery || '',
		);
		return {
			sessions: result.sessions.map(session => ({
				id: session.id,
				title: session.title,
				updatedAt: session.updatedAt,
				messageCount: session.messageCount,
			})),
			total: result.total,
			hasMore: result.hasMore,
		};
	}

	// Notify server that current message processing is completed
	async notifyMessageProcessingCompleted(): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		try {
			await this.connection.invoke('SendMessageProcessingCompleted');
		} catch {
			// Silently fail - should not break CLI flow
		}
	}
}

// Export singleton instance
export const connectionManager = new ConnectionManager();
export default connectionManager;
