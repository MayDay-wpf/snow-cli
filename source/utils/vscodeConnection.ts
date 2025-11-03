import {WebSocket} from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface EditorContext {
	activeFile?: string;
	selectedText?: string;
	cursorPosition?: {line: number; character: number};
	workspaceFolder?: string;
}

interface Diagnostic {
	message: string;
	severity: 'error' | 'warning' | 'info' | 'hint';
	line: number;
	character: number;
	source?: string;
	code?: string | number;
}

class VSCodeConnectionManager {
	private client: WebSocket | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private reconnectAttempts = 0;
	private readonly MAX_RECONNECT_ATTEMPTS = 10;
	private readonly BASE_RECONNECT_DELAY = 2000; // 2 seconds
	private readonly MAX_RECONNECT_DELAY = 30000; // 30 seconds
	// Port ranges: VSCode uses 9527-9537, JetBrains uses 9538-9548
	private readonly VSCODE_BASE_PORT = 9527;
	private readonly VSCODE_MAX_PORT = 9537;
	private readonly JETBRAINS_BASE_PORT = 9538;
	private readonly JETBRAINS_MAX_PORT = 9548;
	private port = 9527;
	private editorContext: EditorContext = {};
	private listeners: Array<(context: EditorContext) => void> = [];
	private currentWorkingDirectory = process.cwd();
	// Connection state management
	private connectingPromise: Promise<void> | null = null;
	private connectionTimeout: NodeJS.Timeout | null = null;
	private readonly CONNECTION_TIMEOUT = 10000; // 10 seconds timeout for initial connection

	async start(): Promise<void> {
		// If already connected, just return success
		if (this.client?.readyState === WebSocket.OPEN) {
			return Promise.resolve();
		}

		// If already connecting, return the existing promise to avoid duplicate connections
		if (this.connectingPromise) {
			return this.connectingPromise;
		}

		// Try to find the correct port for this workspace
		const targetPort = this.findPortForWorkspace();

		// Create a new connection promise and store it
		this.connectingPromise = new Promise((resolve, reject) => {
			// Set connection timeout
			this.connectionTimeout = setTimeout(() => {
				this.cleanupConnection();
				reject(new Error('Connection timeout after 10 seconds'));
			}, this.CONNECTION_TIMEOUT);

			const tryConnect = (port: number) => {
				// Check both VSCode and JetBrains port ranges
				if (port > this.VSCODE_MAX_PORT && port < this.JETBRAINS_BASE_PORT) {
					// Jump from VSCode range to JetBrains range
					tryConnect(this.JETBRAINS_BASE_PORT);
					return;
				}
				if (port > this.JETBRAINS_MAX_PORT) {
					this.cleanupConnection();
					reject(
						new Error(
							`Failed to connect: no IDE server found on ports ${this.VSCODE_BASE_PORT}-${this.VSCODE_MAX_PORT} or ${this.JETBRAINS_BASE_PORT}-${this.JETBRAINS_MAX_PORT}`,
						),
					);
					return;
				}

				try {
					this.client = new WebSocket(`ws://localhost:${port}`);

					this.client.on('open', () => {
						// Reset reconnect attempts on successful connection
						this.reconnectAttempts = 0;
						this.port = port;
						// Clear connection state
						if (this.connectionTimeout) {
							clearTimeout(this.connectionTimeout);
							this.connectionTimeout = null;
						}
						this.connectingPromise = null;
						resolve();
					});

					this.client.on('message', message => {
						try {
							const data = JSON.parse(message.toString());

							// Filter messages by workspace folder
							if (this.shouldHandleMessage(data)) {
								this.handleMessage(data);
							}
						} catch (error) {
							// Ignore invalid JSON
						}
					});

					this.client.on('close', () => {
						this.client = null;
						this.scheduleReconnect();
					});

					this.client.on('error', _error => {
						// On initial connection, try next port
						if (this.reconnectAttempts === 0) {
							this.client = null;
							tryConnect(port + 1);
						}
						// For reconnections, silently handle and let close event trigger reconnect
					});
				} catch (error) {
					tryConnect(port + 1);
				}
			};

			tryConnect(targetPort);
		});

		// Return the promise and clean up state when it completes or fails
		return this.connectingPromise.finally(() => {
			this.connectingPromise = null;
			if (this.connectionTimeout) {
				clearTimeout(this.connectionTimeout);
				this.connectionTimeout = null;
			}
		});
	}

	/**
	 * Clean up connection state and resources
	 */
	private cleanupConnection(): void {
		this.connectingPromise = null;
		if (this.connectionTimeout) {
			clearTimeout(this.connectionTimeout);
			this.connectionTimeout = null;
		}
		if (this.client) {
			try {
				this.client.removeAllListeners();
				this.client.close();
			} catch (error) {
				// Ignore errors during cleanup
			}
			this.client = null;
		}
	}

	/**
	 * Normalize path for cross-platform compatibility
	 * - Converts Windows backslashes to forward slashes
	 * - Converts drive letters to lowercase for consistent comparison
	 */
	private normalizePath(filePath: string): string {
		let normalized = filePath.replace(/\\/g, '/');
		// Convert Windows drive letter to lowercase (C: -> c:)
		if (/^[A-Z]:/.test(normalized)) {
			normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
		}
		return normalized;
	}

	/**
	 * Find the correct port for the current workspace
	 */
	private findPortForWorkspace(): number {
		try {
			const portInfoPath = path.join(os.tmpdir(), 'snow-cli-ports.json');
			if (fs.existsSync(portInfoPath)) {
				const portInfo = JSON.parse(fs.readFileSync(portInfoPath, 'utf8'));

				// Normalize cwd for consistent comparison
				const cwd = this.normalizePath(this.currentWorkingDirectory);

				// Direct match
				if (portInfo[cwd]) {
					return portInfo[cwd];
				}

				// Check if cwd is within any of the workspace folders
				for (const [workspace, port] of Object.entries(portInfo)) {
					const normalizedWorkspace = this.normalizePath(workspace);
					if (cwd.startsWith(normalizedWorkspace)) {
						return port as number;
					}
				}
			}
		} catch (error) {
			// Ignore errors, will fall back to VSCODE_BASE_PORT
		}

		// Start with VSCode port range by default
		return this.VSCODE_BASE_PORT;
	}

	/**
	 * Check if we should handle this message based on workspace folder
	 */
	private shouldHandleMessage(data: any): boolean {
		// If no workspace folder in message, accept it (backwards compatibility)
		if (!data.workspaceFolder) {
			return true;
		}

		// Normalize paths for consistent comparison across platforms
		const cwd = this.normalizePath(this.currentWorkingDirectory);
		const workspaceFolder = this.normalizePath(data.workspaceFolder);

		// Bidirectional check: either cwd is within IDE workspace, or IDE workspace is within cwd
		const cwdInWorkspace = cwd.startsWith(workspaceFolder);
		const workspaceInCwd = workspaceFolder.startsWith(cwd);
		const matches = cwdInWorkspace || workspaceInCwd;

		return matches;
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}

		this.reconnectAttempts++;
		if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
			return;
		}

		const delay = Math.min(
			this.BASE_RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts - 1),
			this.MAX_RECONNECT_DELAY,
		);

		this.reconnectTimer = setTimeout(() => {
			this.start().catch(() => {
				// Silently handle reconnection failures
			});
		}, delay);
	}

	stop(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		// Clear connection timeout
		if (this.connectionTimeout) {
			clearTimeout(this.connectionTimeout);
			this.connectionTimeout = null;
		}

		// Clear connecting promise
		this.connectingPromise = null;

		if (this.client) {
			try {
				this.client.removeAllListeners();
				this.client.close();
			} catch (error) {
				// Ignore errors during cleanup
			}
			this.client = null;
		}

		this.reconnectAttempts = 0;
	}

	isConnected(): boolean {
		return this.client?.readyState === WebSocket.OPEN;
	}

	isClientRunning(): boolean {
		return this.client !== null;
	}

	getContext(): EditorContext {
		return {...this.editorContext};
	}

	onContextUpdate(listener: (context: EditorContext) => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter(l => l !== listener);
		};
	}

	private handleMessage(data: any): void {
		if (data.type === 'context') {
			this.editorContext = {
				activeFile: data.activeFile,
				selectedText: data.selectedText,
				cursorPosition: data.cursorPosition,
				workspaceFolder: data.workspaceFolder,
			};

			this.notifyListeners();
		}
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			listener(this.editorContext);
		}
	}

	getPort(): number {
		return this.port;
	}

	/**
	 * Request diagnostics for a specific file from IDE
	 * @param filePath - The file path to get diagnostics for
	 * @returns Promise that resolves with diagnostics array
	 */
	async requestDiagnostics(filePath: string): Promise<Diagnostic[]> {
		return new Promise(resolve => {
			if (!this.client || this.client.readyState !== WebSocket.OPEN) {
				resolve([]); // Return empty array if not connected
				return;
			}

			const requestId = Math.random().toString(36).substring(7);
			let isResolved = false;

			const timeout = setTimeout(() => {
				if (!isResolved) {
					cleanup();
					resolve([]); // Timeout, return empty array
				}
			}, 2000); // Reduce timeout from 5s to 2s to avoid long blocking

			const handler = (message: any) => {
				try {
					const data = JSON.parse(message.toString());
					if (data.type === 'diagnostics' && data.requestId === requestId) {
						if (!isResolved) {
							cleanup();
							resolve(data.diagnostics || []);
						}
					}
				} catch (error) {
					// Ignore invalid JSON
				}
			};

			const cleanup = () => {
				isResolved = true;
				clearTimeout(timeout);
				if (this.client) {
					this.client.off('message', handler);
				}
			};

			this.client.on('message', handler);

			// Add error handling for send operation
			try {
				this.client.send(
					JSON.stringify({
						type: 'getDiagnostics',
						requestId,
						filePath,
					}),
				);
			} catch (error) {
				cleanup();
				resolve([]); // If send fails, return empty array
			}
		});
	}

	/**
	 * Reset reconnection attempts (e.g., when user manually triggers reconnect)
	 */
	resetReconnectAttempts(): void {
		this.reconnectAttempts = 0;
	}
}

export const vscodeConnection = new VSCodeConnectionManager();

export type {EditorContext, Diagnostic};
