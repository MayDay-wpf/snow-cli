import * as signalR from '@microsoft/signalr';
import {
	ConnectionConfig,
	ConnectionState,
	StatusChangeCallback,
	MessageCallback,
	InFlightState,
} from './types.js';
import {StateManager} from './stateManager.js';
import {InstanceLockManager} from './instanceLock.js';
import {ConfigStore} from './configStore.js';
import {ContextManager} from './contextManager.js';
import {InteractionManager} from './interactionManager.js';
import {ProjectDataManager} from './projectData.js';

// Re-export types for backward compatibility
export type {
	ConnectionStatus,
	ConnectionConfig,
	ConnectionState,
	PendingToolConfirmation,
	PendingQuestion,
	PendingRollbackConfirmation,
	InFlightState,
} from './types.js';

class ConnectionManager {
	private connection: signalR.HubConnection | null = null;
	private config: ConnectionConfig | null = null;
	private heartbeatInterval: NodeJS.Timeout | null = null;
	private messageListenerUnsubscribe: (() => void) | null = null;
	private readonly MAX_RECONNECT_ATTEMPTS = 3;

	// Sub-managers
	private stateManager: StateManager;
	private lockManager: InstanceLockManager;
	private configStore: ConfigStore;
	private contextManager: ContextManager;
	private interactionManager: InteractionManager;
	private projectDataManager: ProjectDataManager;

	constructor() {
		this.stateManager = new StateManager();
		this.lockManager = new InstanceLockManager();
		this.configStore = new ConfigStore();
		this.contextManager = new ContextManager(this.stateManager);
		this.interactionManager = new InteractionManager(this.stateManager);
		this.projectDataManager = new ProjectDataManager();
	}

	// Set the CLI streaming state - should be called by ChatScreen when streamStatus changes
	setStreamingState(state: 'idle' | 'streaming' | 'stopping'): void {
		this.stateManager.setStreamingState(state);
	}

	// Subscribe to status changes
	onStatusChange(callback: StatusChangeCallback): () => void {
		return this.stateManager.onStatusChange(callback);
	}

	// Subscribe to specific message types
	onMessage(type: string, callback: MessageCallback): () => void {
		return this.stateManager.onMessage(type, callback);
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
				this.stateManager.updateState({token: data.token, error: undefined});
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
		if (!this.config || !this.stateManager.getState().token) {
			return {success: false, message: 'Please login first'};
		}

		if (this.connection?.state === signalR.HubConnectionState.Connected) {
			return {success: true, message: 'Already connected'};
		}

		// Check if instance ID is already locked by another process
		if (this.lockManager.isLocked(this.config.instanceId)) {
			return {
				success: false,
				message: `Instance ID "${this.config.instanceId}" is already in use by another process`,
			};
		}

		this.stateManager.updateState({status: 'connecting', error: undefined});

		try {
			const baseUrl = this.config.apiUrl.replace(/\/api$/, '');
			const hubUrl = `${baseUrl}/hubs/instance`;

			this.connection = new signalR.HubConnectionBuilder()
				.withUrl(hubUrl, {
					accessTokenFactory: () => this.stateManager.getState().token!,
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

			// Update interaction manager with connection reference
			this.interactionManager.setConnection(this.connection);

			// Handle reconnection events
			this.connection.onreconnecting(error => {
				this.stateManager.updateState({
					status: 'reconnecting',
					error: error?.message,
				});
				this.stateManager.notifyMessage('system', {
					type: 'reconnecting',
					message: `Reconnecting...`,
				});
			});

			this.connection.onreconnected(() => {
				this.stateManager.updateState({status: 'connected'});
				this.stateManager.notifyMessage('system', {
					type: 'reconnected',
					message: 'Reconnected successfully',
				});
				// Re-register instance after reconnection
				void this.registerInstance();
			});

			this.connection.onclose(() => {
				this.stopHeartbeat();
				this.cleanupMessageListener();
				this.stateManager.clearInFlightInteractions();
				this.stateManager.updateState({status: 'disconnected'});
				this.stateManager.notifyMessage('system', {
					type: 'closed',
					message: 'Connection closed',
				});
			});

			// Setup all SignalR message handlers
			this.setupSignalRHandlers();

			await this.connection.start();

			// Register instance
			await this.registerInstance();

			// Start heartbeat
			this.startHeartbeat();

			// Setup message listener for auto-push
			void this.setupMessageListener();

			// Lock instance ID after successful connection
			this.lockManager.lock(this.config.instanceId);

			this.stateManager.updateState({
				status: 'connected',
				instanceId: this.config.instanceId,
				instanceName: this.config.instanceName,
			});

			return {success: true, message: 'Connected successfully'};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Connection error';
			this.stateManager.updateState({status: 'disconnected', error: message});
			return {success: false, message: `Connection failed: ${message}`};
		}
	}

	// Setup SignalR message handlers
	private setupSignalRHandlers(): void {
		if (!this.connection) return;

		// Handle server-initiated client methods
		this.connection.on('instanceconnected', (message: unknown) => {
			this.stateManager.notifyMessage('system', {
				type: 'instance_connected',
				message:
					typeof message === 'string'
						? message
						: 'Instance connected to server',
			});
		});

		// Handle instance disconnected from server
		this.connection.on('instancedisconnected', (message: unknown) => {
			this.stateManager.notifyMessage('system', {
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
				const contextInfo = await this.contextManager.getContextInfo();
				await this.connection!.invoke('SendContextInfo', contextInfo);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to send context info';
				this.stateManager.notifyMessage('system', {
					type: 'error',
					message: `Context info error: ${message}`,
				});
			}
		});

		// Handle receiving context info from other instances (broadcast from server)
		this.connection.on('receivecontextinfo', (contextData: string) => {
			try {
				const data = JSON.parse(contextData);
				this.stateManager.notifyMessage('system', {
					type: 'context_info_received',
					message: `Received context from another instance`,
					data: data,
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to parse context info';
				this.stateManager.notifyMessage('system', {
					type: 'error',
					message: `Context info parse error: ${message}`,
				});
			}
		});

		// Handle receiving message from Web client (via server)
		this.connection.on('receivemessage', (message: string) => {
			this.stateManager.notifyMessage('remote_message', {
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
				this.stateManager.removePendingToolConfirmation(result.toolCallId);
				this.stateManager.notifyMessage('tool_confirmation_result', {
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
				this.stateManager.removePendingQuestion(result.toolCallId);
				this.stateManager.notifyMessage('user_question_result', {
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
				this.stateManager.clearInFlightInteractions();
				this.stateManager.notifyMessage('message_processing_completed', {
					type: 'message_processing_completed',
					instanceId,
					timestamp: new Date().toISOString(),
				});
			},
		);

		// Handle interrupt signal from Web client (via server)
		this.connection.on('receiveinterruptmessageprocessing', () => {
			this.stateManager.clearInFlightInteractions();
			this.stateManager.notifyMessage('interrupt_message_processing', {
				type: 'interrupt_message_processing',
				timestamp: new Date().toISOString(),
			});
		});

		// Handle clear-session signal from Web client (via server)
		this.connection.on('receiveclearsession', () => {
			this.stateManager.clearInFlightInteractions();
			this.stateManager.notifyMessage('clear_session', {
				type: 'clear_session',
				timestamp: new Date().toISOString(),
			});
		});

		// Handle force-offline signal from Web client (via server)
		this.connection.on('receiveforceoffline', async () => {
			this.stateManager.notifyMessage('force_offline', {
				type: 'force_offline',
				message: 'Received force-offline signal from server',
				timestamp: new Date().toISOString(),
			});
			await this.disconnect();
		});

		// Handle rollback signal from Web client (via server)
		this.connection.on('receiverollbackmessage', (userMessageOrder: number) => {
			// 新回滚流程开始前清空旧交互状态，避免把历史 pending 带入新上下文
			this.stateManager.clearInFlightInteractions();
			this.stateManager.notifyMessage('rollback_message', {
				type: 'rollback_message',
				userMessageOrder,
				timestamp: new Date().toISOString(),
			});
		});

		// Handle resume-session signal from Web client (via server)
		this.connection.on('receiveresumesession', (sessionId: string) => {
			this.stateManager.notifyMessage('resume_session', {
				type: 'resume_session',
				sessionId,
				timestamp: new Date().toISOString(),
			});
		});

		// Handle rollback confirmation result from Web client (via server)
		this.connection.on(
			'receiverollbackconfirmationresult',
			(result: {rollbackFiles?: boolean | null; rollbackMode?: string; selectedFiles?: string[]}) => {
				// 回滚确认已给出，必须立即清理待确认状态，避免后续上下文持续携带旧状态
				this.stateManager.setPendingRollbackConfirmation(null);
				this.stateManager.notifyMessage('rollback_confirmation_result', {
					type: 'rollback_confirmation_result',
					...result,
					timestamp: new Date().toISOString(),
				});
			},
		);

		// Handle file list request from Web client (via server)
		this.connection.on('receivefilelistrequest', async (requestId: string) => {
			try {
				const files = await this.projectDataManager.getFileList();
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
		});

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
					const result = await this.projectDataManager.getSessionList(
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

		// Handle compact request from Web client (via server)
		this.connection.on('receivecompactrequest', () => {
			this.stateManager.notifyMessage('compact_request', {
				type: 'compact_request',
				timestamp: new Date().toISOString(),
			});
		});
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
			this.stateManager.notifyMessage('system', {
				type: 'registered',
				message: `Instance registered: ${this.config.instanceName} (${this.config.instanceId})`,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Registration error';
			this.stateManager.notifyMessage('system', {
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
					this.stateManager.notifyMessage('system', {
						type: 'heartbeat_error',
						message,
					});
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

	// Setup message listener to auto-push updates
	private async setupMessageListener(): Promise<void> {
		// Avoid duplicate listeners on reconnect
		this.cleanupMessageListener();
		this.messageListenerUnsubscribe =
			await this.contextManager.setupMessageListener(async () => {
				await this.pushContextInfo();
			});
	}

	// Cleanup message listener
	private cleanupMessageListener(): void {
		if (this.messageListenerUnsubscribe) {
			this.messageListenerUnsubscribe();
			this.messageListenerUnsubscribe = null;
		}
	}

	// Push context info to server (called when messages change)
	private async pushContextInfo(): Promise<void> {
		if (!this.connection || !this.stateManager.isConnected()) {
			return;
		}

		try {
			const contextInfo = await this.contextManager.getContextInfo();
			await this.connection.invoke('SendContextInfo', contextInfo);
		} catch {
			// Silently fail - don't spam errors for push failures
		}
	}

	// Disconnect
	async disconnect(): Promise<{success: boolean; message: string}> {
		this.stopHeartbeat();
		this.cleanupMessageListener();
		this.stateManager.clearInFlightInteractions();

		// Unlock instance ID
		if (this.config?.instanceId) {
			this.lockManager.unlock(this.config.instanceId);
		}

		if (this.connection) {
			try {
				await this.connection.stop();
			} catch {
				// Ignore disconnection errors
			}
			this.connection = null;
			this.interactionManager.setConnection(null);
		}

		this.stateManager.updateState({
			status: 'disconnected',
			instanceId: undefined,
			instanceName: undefined,
			token: undefined,
			error: undefined,
		});
		return {success: true, message: 'Disconnected'};
	}

	// Save connection config to file
	async saveConnectionConfig(config: ConnectionConfig): Promise<void> {
		return this.configStore.save(config);
	}

	// Load connection config from file
	loadConnectionConfig(): ConnectionConfig | null {
		return this.configStore.load();
	}

	// Check if saved connection config exists
	hasSavedConnection(): boolean {
		return this.configStore.hasSavedConfig();
	}

	// Clear saved connection config
	clearSavedConnection(): void {
		return this.configStore.clear();
	}

	// Get current state
	getState(): ConnectionState {
		return this.stateManager.getState();
	}

	getInFlightState(): InFlightState {
		return this.stateManager.getInFlightState();
	}

	// Check if connected
	isConnected(): boolean {
		return this.stateManager.isConnected();
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
		return this.interactionManager.notifyToolConfirmationNeeded(
			toolName,
			toolArguments,
			toolCallId,
			allTools,
		);
	}

	// Notify server that user interaction (ask_question) is needed
	async notifyUserInteractionNeeded(
		question: string,
		options: string[],
		toolCallId: string,
		multiSelect?: boolean,
	): Promise<void> {
		return this.interactionManager.notifyUserInteractionNeeded(
			question,
			options,
			toolCallId,
			multiSelect,
		);
	}

	// Notify server that rollback confirmation is needed
	async notifyRollbackConfirmationNeeded(payload: {
		filePaths: string[];
		notebookCount?: number;
	}): Promise<void> {
		return this.interactionManager.notifyRollbackConfirmationNeeded(payload);
	}

	// Send tool confirmation result (when user approves/rejects)
	async sendToolConfirmationResult(
		toolCallId: string,
		result: 'approve' | 'approve_always' | 'reject' | 'reject_with_reply',
		reason?: string,
	): Promise<void> {
		return this.interactionManager.sendToolConfirmationResult(
			toolCallId,
			result,
			reason,
		);
	}

	// Send user question result (when user answers)
	async sendUserQuestionResult(
		toolCallId: string,
		selected: string | string[],
		customInput?: string,
		cancelled?: boolean,
	): Promise<void> {
		return this.interactionManager.sendUserQuestionResult(
			toolCallId,
			selected,
			customInput,
			cancelled,
		);
	}

	// Notify server that current message processing is completed
	async notifyMessageProcessingCompleted(): Promise<void> {
		return this.interactionManager.notifyMessageProcessingCompleted();
	}

	// Notify server that compact operation started
	async notifyCompactStarted(): Promise<void> {
		if (!this.connection || !this.stateManager.isConnected()) {
			return;
		}
		try {
			await this.connection.invoke('NotifyCompactStarted');
		} catch {
			// Silently fail
		}
	}

	// Notify server that compact operation completed
	async notifyCompactCompleted(result: {
		success: boolean;
		messageCount?: number;
		error?: string;
	}): Promise<void> {
		if (!this.connection || !this.stateManager.isConnected()) {
			return;
		}
		try {
			await this.connection.invoke(
				'NotifyCompactCompleted',
				JSON.stringify(result),
			);
		} catch {
			// Silently fail
		}
	}
}

// Export singleton instance
export const connectionManager = new ConnectionManager();
export default connectionManager;
