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

export interface IDEInfo {
	name: string;
	workspace: string;
	port: number;
	matched: boolean;
}

class VSCodeConnectionManager {
	private client: WebSocket | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private reconnectAttempts = 0;
	private readonly MAX_RECONNECT_ATTEMPTS = 10;
	private readonly BASE_RECONNECT_DELAY = 2000; // 2 seconds
	private readonly MAX_RECONNECT_DELAY = 30000; // 30 seconds
	private port = 0;
	private editorContext: EditorContext = {};
	private listeners: Array<(context: EditorContext) => void> = [];
	private currentWorkingDirectory = process.cwd();
	private _userDisconnected = false;
	// In multi-root workspaces a single VSCode window serves multiple workspace folders on the same port.
	// Cache the workspace folders mapped to the connected port so we can accept context from any of them.
	private connectedWorkspaceFolders: Set<string> = new Set();
	private connectedPortHasCwdMatch = false;
	// Once we've received at least one valid context message, trust subsequent context updates from this server.
	// This is important for multi-root workspaces where the active file can move across workspace folders while
	// the terminal cwd stays fixed.
	private trustContextFromConnectedServer = false;
	// Connection state management
	private connectingPromise: Promise<void> | null = null;
	private connectionTimeout: NodeJS.Timeout | null = null;
	private readonly CONNECTION_TIMEOUT = 10000; // 10 seconds timeout for initial connection

	async start(): Promise<void> {
		if (this.client?.readyState === WebSocket.OPEN) {
			return Promise.resolve();
		}

		if (this.connectingPromise) {
			return this.connectingPromise;
		}

		// Only try ports whose workspace matches the current cwd
		const {matched} = this.getAvailableIDEs();
		const portsToTry = [...new Set(matched.map(ide => ide.port))];

		if (portsToTry.length === 0) {
			return Promise.reject(
				new Error('No IDE with matching workspace found for current directory'),
			);
		}

		this.connectingPromise = new Promise((resolve, reject) => {
			let isSettled = false;
			let portIndex = 0;

			this.connectionTimeout = setTimeout(() => {
				if (!isSettled) {
					isSettled = true;
					this.cleanupConnection();
					reject(new Error('Connection timeout after 10 seconds'));
				}
			}, this.CONNECTION_TIMEOUT);

			const tryNextPort = () => {
				if (isSettled) return;

				if (portIndex >= portsToTry.length) {
					if (!isSettled) {
						isSettled = true;
						this.cleanupConnection();
						reject(
							new Error('Failed to connect to any IDE with matching workspace'),
						);
					}
					return;
				}

				const port = portsToTry[portIndex]!;
				portIndex++;

				try {
					this.client = new WebSocket(`ws://localhost:${port}`);

					this.client.on('open', () => {
						if (!isSettled) {
							isSettled = true;
							this.trustContextFromConnectedServer = false;
							this.reconnectAttempts = 0;
							this.port = port;
							this.refreshConnectedWorkspaceFolders();
							if (this.connectionTimeout) {
								clearTimeout(this.connectionTimeout);
								this.connectionTimeout = null;
							}
							this.connectingPromise = null;
							resolve();
						}
					});

					this.client.on('message', message => {
						try {
							const data = JSON.parse(message.toString());
							if (this.shouldHandleMessage(data)) {
								this.handleMessage(data);
							}
						} catch {
							// Ignore invalid JSON
						}
					});

					this.client.on('close', () => {
						this.client = null;
						if (this.reconnectAttempts > 0 || isSettled) {
							this.scheduleReconnect();
						}
					});

					this.client.on('error', _error => {
						if (!isSettled) {
							this.client = null;
							setTimeout(() => tryNextPort(), 50);
						}
					});
				} catch {
					if (!isSettled) {
						setTimeout(() => tryNextPort(), 50);
					}
				}
			};

			tryNextPort();
		});

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
				// Add error handler before closing to prevent unhandled error events
				this.client.on('error', () => {
					// Silently ignore errors during cleanup
				});
				this.client.removeAllListeners('open');
				this.client.removeAllListeners('message');
				this.client.removeAllListeners('close');
				// Only close if connection is open or connecting
				if (
					this.client.readyState !== WebSocket.CLOSED &&
					this.client.readyState !== WebSocket.CLOSING
				) {
					this.client.close();
				}
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
	 * Check if we should handle this message based on workspace folder
	 */
	private shouldHandleMessage(data: any): boolean {
		// If no workspace folder in message, accept it (backwards compatibility)
		if (!data.workspaceFolder) {
			return true;
		}

		// After the first valid context update, accept further context updates even if the workspace folder differs.
		// This avoids dropping context when moving between folders in a multi-root workspace.
		if (data.type === 'context' && this.trustContextFromConnectedServer) {
			return true;
		}

		// Normalize paths for consistent comparison across platforms
		const cwd = this.normalizePath(this.currentWorkingDirectory);
		const workspaceFolder = this.normalizePath(data.workspaceFolder);

		// Exact match
		if (cwd === workspaceFolder) {
			return true;
		}

		// cwd is inside the IDE workspace
		if (workspaceFolder.length > 1 && cwd.startsWith(workspaceFolder + '/')) {
			return true;
		}

		// Multi-root workspace support: once we know this terminal's cwd belongs to the connected port,
		// accept context messages for any workspace folder that maps to the same port.
		if (
			this.connectedPortHasCwdMatch &&
			this.connectedWorkspaceFolders.size > 0 &&
			this.connectedWorkspaceFolders.has(workspaceFolder)
		) {
			return true;
		}

		return false;
	}

	private refreshConnectedWorkspaceFolders(): void {
		this.connectedWorkspaceFolders.clear();
		this.connectedPortHasCwdMatch = false;

		try {
			const portInfoPath = path.join(os.tmpdir(), 'snow-cli-ports.json');
			if (!fs.existsSync(portInfoPath)) {
				return;
			}

			const portInfo = JSON.parse(fs.readFileSync(portInfoPath, 'utf8'));
			for (const [workspace, value] of Object.entries(portInfo)) {
				const entryPort =
					typeof value === 'number'
						? value
						: typeof value === 'object' &&
						  value !== null &&
						  typeof (value as any).port === 'number'
						? (value as any).port
						: null;
				if (entryPort !== this.port) {
					continue;
				}
				const normalizedWorkspace = this.normalizePath(workspace);
				if (normalizedWorkspace) {
					this.connectedWorkspaceFolders.add(normalizedWorkspace);
				}
			}

			const cwd = this.normalizePath(this.currentWorkingDirectory);
			for (const ws of this.connectedWorkspaceFolders) {
				if (ws.length > 1 && (cwd === ws || cwd.startsWith(ws + '/'))) {
					this.connectedPortHasCwdMatch = true;
					break;
				}
			}
		} catch (error) {
			// Ignore errors; fall back to path-based matching.
			this.connectedWorkspaceFolders.clear();
			this.connectedPortHasCwdMatch = false;
		}
	}

	private scheduleReconnect(): void {
		if (this._userDisconnected) {
			return;
		}

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

		// Clear connecting promise - this is critical for restart
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

		this.trustContextFromConnectedServer = false;
		this.connectedWorkspaceFolders.clear();
		this.connectedPortHasCwdMatch = false;
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
			this.trustContextFromConnectedServer = true;
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
	 * Update the current working directory used for IDE workspace matching.
	 * Call this after process.chdir() to keep workspace matching consistent.
	 */
	setCurrentWorkingDirectory(dir: string): void {
		this.currentWorkingDirectory = dir;
		this.refreshConnectedWorkspaceFolders();
	}

	getCurrentWorkingDirectory(): string {
		return this.currentWorkingDirectory;
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

	getUserDisconnected(): boolean {
		return this._userDisconnected;
	}

	setUserDisconnected(value: boolean): void {
		this._userDisconnected = value;
	}

	/**
	 * Get all available IDEs from the port info file, categorized by workspace match.
	 */
	getAvailableIDEs(): {matched: IDEInfo[]; unmatched: IDEInfo[]} {
		const matched: IDEInfo[] = [];
		const unmatched: IDEInfo[] = [];

		try {
			const portInfoPath = path.join(os.tmpdir(), 'snow-cli-ports.json');
			if (!fs.existsSync(portInfoPath)) {
				return {matched, unmatched};
			}

			const portInfo = JSON.parse(fs.readFileSync(portInfoPath, 'utf8'));
			const cwd = this.normalizePath(this.currentWorkingDirectory);

			for (const [workspace, value] of Object.entries(portInfo)) {
				let port: number;
				let ideName: string;

				if (typeof value === 'number') {
					// Legacy format: workspace -> port
					port = value;
					ideName = 'VSCode';
				} else if (
					typeof value === 'object' &&
					value !== null &&
					typeof (value as any).port === 'number'
				) {
					// New format: workspace -> { port, ide }
					port = (value as any).port;
					ideName = (value as any).ide || 'IDE';
				} else {
					continue;
				}

				const normalizedWorkspace = this.normalizePath(workspace);

				const isMatch =
					normalizedWorkspace.length > 1 &&
					(cwd === normalizedWorkspace ||
						cwd.startsWith(normalizedWorkspace + '/'));

				const info: IDEInfo = {
					name: ideName,
					workspace,
					port,
					matched: isMatch,
				};

				if (isMatch) {
					matched.push(info);
				} else {
					unmatched.push(info);
				}
			}
		} catch {
			// Ignore errors reading port file
		}

		return {matched, unmatched};
	}

	/**
	 * Connect to a specific IDE port.
	 * Stops any existing connection first, then connects to the given port.
	 */
	async connectToPort(targetPort: number): Promise<void> {
		this.stop();
		this._userDisconnected = false;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.cleanupConnection();
				reject(new Error('Connection timeout after 10 seconds'));
			}, this.CONNECTION_TIMEOUT);

			try {
				this.client = new WebSocket(`ws://localhost:${targetPort}`);

				this.client.on('open', () => {
					this.trustContextFromConnectedServer = false;
					this.reconnectAttempts = 0;
					this.port = targetPort;
					this.refreshConnectedWorkspaceFolders();
					clearTimeout(timeout);
					resolve();
				});

				this.client.on('message', message => {
					try {
						const data = JSON.parse(message.toString());
						if (this.shouldHandleMessage(data)) {
							this.handleMessage(data);
						}
					} catch {
						// Ignore invalid JSON
					}
				});

				this.client.on('close', () => {
					this.client = null;
					this.scheduleReconnect();
				});

				this.client.on('error', _error => {
					clearTimeout(timeout);
					this.cleanupConnection();
					reject(new Error(`Failed to connect to port ${targetPort}`));
				});
			} catch (error) {
				clearTimeout(timeout);
				this.cleanupConnection();
				reject(error instanceof Error ? error : new Error('Connection failed'));
			}
		});
	}

	hasMatchingWorkspace(): boolean {
		const {matched} = this.getAvailableIDEs();
		return matched.length > 0;
	}

	/**
	 * Show diff in VSCode editor
	 * @param filePath - The file path
	 * @param originalContent - Original file content
	 * @param newContent - New file content
	 * @param label - Label for the diff view
	 * @returns Promise that resolves when diff is shown or rejects if not connected
	 */
	async showDiff(
		filePath: string,
		originalContent: string,
		newContent: string,
		label: string,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.client || this.client.readyState !== WebSocket.OPEN) {
				reject(new Error('VSCode extension not connected'));
				return;
			}

			try {
				this.client.send(
					JSON.stringify({
						type: 'showDiff',
						filePath,
						originalContent,
						newContent,
						label,
					}),
				);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Close diff view in VSCode editor
	 * @returns Promise that resolves when close command is sent or rejects if not connected
	 */
	async closeDiff(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.client || this.client.readyState !== WebSocket.OPEN) {
				reject(new Error('VSCode extension not connected'));
				return;
			}

			try {
				this.client.send(
					JSON.stringify({
						type: 'closeDiff',
					}),
				);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Show multiple file diffs in IDE for diff review
	 * @param files - Array of file diffs to show
	 * @returns Promise that resolves when all diffs are sent
	 */
	async showDiffReview(
		files: Array<{
			filePath: string;
			originalContent: string;
			newContent: string;
		}>,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.client || this.client.readyState !== WebSocket.OPEN) {
				reject(new Error('VSCode extension not connected'));
				return;
			}

			try {
				this.client.send(
					JSON.stringify({
						type: 'showDiffReview',
						files,
					}),
				);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Show git diff for a file in VSCode
	 * Displays the diff between working tree and HEAD for the specified file
	 * @param filePath - Absolute path to the file
	 * @returns Promise that resolves when diff is shown or rejects if not connected
	 */
	async showGitDiff(filePath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.client || this.client.readyState !== WebSocket.OPEN) {
				reject(new Error('VSCode extension not connected'));
				return;
			}

			try {
				this.client.send(
					JSON.stringify({
						type: 'showGitDiff',
						filePath,
					}),
				);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}
}

export const vscodeConnection = new VSCodeConnectionManager();

export type {EditorContext, Diagnostic};
