import {WebSocketServer, WebSocket} from 'ws';

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
	private server: WebSocketServer | null = null;
	private clients: Set<WebSocket> = new Set();
	private port = 9527;
	private editorContext: EditorContext = {};
	private listeners: Array<(context: EditorContext) => void> = [];

	async start(): Promise<void> {
		// If already running, just return success
		if (this.server) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			try {
				this.server = new WebSocketServer({port: this.port});

				this.server.on('connection', ws => {
					// Add new client to the set (allow multiple connections)
					this.clients.add(ws);

					ws.on('message', message => {
						try {
							const data = JSON.parse(message.toString());
							this.handleMessage(data);
						} catch (error) {
							// Ignore invalid JSON
						}
					});

					ws.on('close', () => {
						this.clients.delete(ws);
					});

					ws.on('error', () => {
						// Silently handle errors
						this.clients.delete(ws);
					});
				});

				this.server.on('listening', () => {
					resolve();
				});

				this.server.on('error', error => {
					reject(error);
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	stop(): void {
		// Close all connected clients
		for (const client of this.clients) {
			client.close();
		}
		this.clients.clear();

		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}

	isConnected(): boolean {
		return (
			this.clients.size > 0 &&
			Array.from(this.clients).some(
				client => client.readyState === WebSocket.OPEN,
			)
		);
	}

	isServerRunning(): boolean {
		return this.server !== null;
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
	 * Request diagnostics for a specific file from VS Code
	 * @param filePath - The file path to get diagnostics for
	 * @returns Promise that resolves with diagnostics array
	 */
	async requestDiagnostics(filePath: string): Promise<Diagnostic[]> {
		return new Promise(resolve => {
			// Get first connected client
			const client = Array.from(this.clients).find(
				c => c.readyState === WebSocket.OPEN,
			);

			if (!client) {
				resolve([]); // Return empty array if not connected
				return;
			}

			const requestId = Math.random().toString(36).substring(7);
			const timeout = setTimeout(() => {
				cleanup();
				resolve([]); // Timeout, return empty array
			}, 5000); // 5 second timeout

			const handler = (message: any) => {
				try {
					const data = JSON.parse(message.toString());
					if (data.type === 'diagnostics' && data.requestId === requestId) {
						cleanup();
						resolve(data.diagnostics || []);
					}
				} catch (error) {
					// Ignore invalid JSON
				}
			};

			const cleanup = () => {
				clearTimeout(timeout);
				client?.removeListener('message', handler);
			};

			client.on('message', handler);
			client.send(
				JSON.stringify({
					type: 'getDiagnostics',
					requestId,
					filePath,
				}),
			);
		});
	}

	/**
	 * Request DIFF+APPLY view for file changes in VS Code
	 * @param filePath - The file path for the diff
	 * @param oldContent - Original content with line numbers
	 * @param newContent - Modified content with line numbers
	 * @returns Promise that resolves with user's approval response
	 */
	async requestDiffApply(
		filePath: string,
		oldContent: string,
		newContent: string,
	): Promise<'approve' | 'approve_always' | 'reject'> {
		return new Promise(resolve => {
			// Get first connected client
			const client = Array.from(this.clients).find(
				c => c.readyState === WebSocket.OPEN,
			);

			if (!client) {
				resolve('approve'); // If not connected, default to approve (fallback to CLI confirmation)
				return;
			}

			const requestId = Math.random().toString(36).substring(7);
			const timeout = setTimeout(() => {
				cleanup();
				resolve('approve'); // Timeout, default to approve
			}, 30000); // 30 second timeout for user decision

			const handler = (message: any) => {
				try {
					const data = JSON.parse(message.toString());
					if (data.type === 'diffApplyResult' && data.requestId === requestId) {
						cleanup();
						resolve(data.result || 'approve');
					}
				} catch (error) {
					// Ignore invalid JSON
				}
			};

			const cleanup = () => {
				clearTimeout(timeout);
				client?.removeListener('message', handler);
			};

			client.on('message', handler);
			client.send(
				JSON.stringify({
					type: 'diffApply',
					requestId,
					filePath,
					oldContent,
					newContent,
				}),
			);
		});
	}
}

export const vscodeConnection = new VSCodeConnectionManager();

export type {EditorContext, Diagnostic};
