import { WebSocketServer, WebSocket } from 'ws';

interface EditorContext {
	activeFile?: string;
	selectedText?: string;
	cursorPosition?: { line: number; character: number };
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
	private client: WebSocket | null = null;
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
				this.server = new WebSocketServer({ port: this.port });

				this.server.on('connection', (ws) => {
					// Close old client if exists
					if (this.client && this.client !== ws) {
						this.client.close();
					}

					this.client = ws;

					ws.on('message', (message) => {
						try {
							const data = JSON.parse(message.toString());
							this.handleMessage(data);
						} catch (error) {
							// Ignore invalid JSON
						}
					});

					ws.on('close', () => {
						if (this.client === ws) {
							this.client = null;
						}
					});

					ws.on('error', () => {
						// Silently handle errors
					});
				});

				this.server.on('listening', () => {
					resolve();
				});

				this.server.on('error', (error) => {
					reject(error);
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	stop(): void {
		if (this.client) {
			this.client.close();
			this.client = null;
		}
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}

	isConnected(): boolean {
		return this.client !== null && this.client.readyState === WebSocket.OPEN;
	}

	isServerRunning(): boolean {
		return this.server !== null;
	}

	getContext(): EditorContext {
		return { ...this.editorContext };
	}

	onContextUpdate(listener: (context: EditorContext) => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	private handleMessage(data: any): void {
		if (data.type === 'context') {
			this.editorContext = {
				activeFile: data.activeFile,
				selectedText: data.selectedText,
				cursorPosition: data.cursorPosition,
				workspaceFolder: data.workspaceFolder
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
		return new Promise((resolve) => {
			if (!this.client || this.client.readyState !== WebSocket.OPEN) {
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
				this.client?.removeListener('message', handler);
			};

			this.client.on('message', handler);
			this.client.send(
				JSON.stringify({
					type: 'getDiagnostics',
					requestId,
					filePath
				})
			);
		});
	}
}

export const vscodeConnection = new VSCodeConnectionManager();
export type { EditorContext, Diagnostic };
