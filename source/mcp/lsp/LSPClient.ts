import {spawn, type ChildProcess} from 'child_process';
import {promises as fs} from 'fs';
import * as path from 'path';
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
	type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import type {
	InitializeParams,
	InitializeResult,
	ServerCapabilities,
	Position,
	Location,
	Hover,
	CompletionItem,
	DocumentSymbol,
	SymbolInformation,
	TextDocumentPositionParams,
	ReferenceParams,
	DocumentSymbolParams,
	HoverParams,
	CompletionParams,
} from 'vscode-languageserver-protocol';
import {processManager} from '../../utils/core/processManager.js';
import type {LSPServerConfig} from './LSPServerRegistry.js';

export interface LSPClientConfig extends LSPServerConfig {
	language: string;
	rootPath: string;
}

export class LSPClient {
	private process?: ChildProcess;
	private connection?: MessageConnection;
	private capabilities?: ServerCapabilities;
	private isInitialized = false;
	private isProcessAlive = false;
	private openDocuments: Set<string> = new Set();
	private documentVersions: Map<string, number> = new Map();
	private csharpSolutionLoaded = false;
	private csharpSolutionLoadPromise?: Promise<void>;
	private resolveCsharpSolutionLoad?: () => void;

	constructor(private config: LSPClientConfig) {}

	private async findCsharpSolutionFile(
		rootPath: string,
	): Promise<string | null> {
		// If caller passes a .sln path directly, respect it.
		if (rootPath.toLowerCase().endsWith('.sln')) {
			return rootPath;
		}

		try {
			const entries = await fs.readdir(rootPath, {withFileTypes: true});
			const solutions = entries
				.filter(
					entry => entry.isFile() && entry.name.toLowerCase().endsWith('.sln'),
				)
				.map(entry => entry.name)
				.sort((a, b) => a.localeCompare(b));

			if (solutions.length === 0) return null;
			if (solutions.length === 1) return path.join(rootPath, solutions[0]!);

			const preferredName = `${path.basename(rootPath)}.sln`;
			const preferred = solutions.find(s => s === preferredName);
			return path.join(rootPath, preferred ?? solutions[0]!);
		} catch {
			return null;
		}
	}

	async start(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			const args = [...this.config.args];

			if (this.config.language === 'csharp') {
				// csharp-ls: --solution/-s <solution>
				// Compatibility: if rootPath is a directory, auto-pick a .sln in it.
				const hasSolutionArg =
					args.includes('-s') || args.includes('--solution');
				if (!hasSolutionArg) {
					const slnPath = await this.findCsharpSolutionFile(
						this.config.rootPath,
					);
					if (slnPath) {
						// Pass absolute path to avoid ambiguity; csharp-ls accepts absolute.
						args.push('-s', slnPath);
					} else {
						console.log(
							`[LSP:csharp] No .sln found under rootPath=${this.config.rootPath}; skip -s and rely on fallback.`,
						);
					}
				}
			} else if (this.config.language === 'java') {
				// Keep existing behavior: pass project root for Java servers that need it.
				args.push('-s', this.config.rootPath);
			}

		this.process = spawn(this.config.command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: this.config.rootPath,
		});

		this.isProcessAlive = true;

		// Detect when the LSP server process exits unexpectedly
		this.process.on('exit', () => {
			this.isProcessAlive = false;
		});
		this.process.on('error', () => {
			this.isProcessAlive = false;
		});

		// 🔥 KEY FIX: Suppress 'error' events on stdin to prevent ERR_STREAM_DESTROYED
		// When a child process dies, Node.js destroys stdin. Subsequent writes via
		// vscode-jsonrpc's StreamMessageWriter trigger BOTH a callback error (handled
		// by the Promise) AND an 'error' event on the stream. Without this listener,
		// the 'error' event becomes an uncaught exception.
		this.process.stdin?.on('error', () => {
			this.isProcessAlive = false;
		});

		processManager.register(this.process);

		this.connection = createMessageConnection(
			new StreamMessageReader(this.process.stdout!),
			new StreamMessageWriter(this.process.stdin!),
		);

		// Handle connection-level errors and closure
		this.connection.onError(([error]) => {
			console.debug('LSP connection error:', error?.message || error);
		});
		this.connection.onClose(() => {
			this.isInitialized = false;
			this.isProcessAlive = false;
		});

		// Some servers (notably csharp-ls) will call back into the client.
		// If we don't implement these, the server may crash with RemoteMethodNotFound.
		this.connection.onRequest('window/workDoneProgress/create', () => null);
		this.connection.onRequest('client/registerCapability', () => null);
		this.connection.onRequest('workspace/configuration', () => []);
		this.connection.onNotification('window/logMessage', (params: any) => {
			const message =
				typeof params?.message === 'string' ? params.message : '';
			if (
				!this.csharpSolutionLoaded &&
				message.includes('Finished loading solution')
			) {
				this.csharpSolutionLoaded = true;
				this.resolveCsharpSolutionLoad?.();
			}
		});
		this.connection.onNotification('window/showMessage', (_params: any) => {
			// ignored
		});

		this.connection.listen();
			if (this.config.language === 'csharp') {
				this.csharpSolutionLoaded = false;
				this.csharpSolutionLoadPromise = new Promise<void>(resolve => {
					this.resolveCsharpSolutionLoad = resolve;
				});
			}
			const initParams: InitializeParams = {
				processId: process.pid,
				rootPath: this.config.rootPath,
				rootUri: this.pathToUri(this.config.rootPath),
				capabilities: {
					textDocument: {
						synchronization: {
							dynamicRegistration: false,
							willSave: false,
							willSaveWaitUntil: false,
							didSave: false,
						},
						completion: {
							dynamicRegistration: false,
							completionItem: {
								snippetSupport: false,
							},
						},
						hover: {
							dynamicRegistration: false,
						},
						definition: {
							dynamicRegistration: false,
						},
						references: {
							dynamicRegistration: false,
						},
						documentSymbol: {
							dynamicRegistration: false,
						},
					},
					workspace: {
						applyEdit: false,
						workspaceEdit: {
							documentChanges: false,
						},
					},
				},
				workspaceFolders: [
					{
						uri: this.pathToUri(this.config.rootPath),
						name: path.basename(this.config.rootPath),
					},
				],
				initializationOptions: this.config.initializationOptions,
			};

			const result = await this.connection.sendRequest<InitializeResult>(
				'initialize',
				initParams,
			);

			this.capabilities = result.capabilities;

			await this.connection.sendNotification('initialized', {});

			this.isInitialized = true;
		} catch (error) {
			await this.cleanup();
			throw new Error(
				`Failed to start LSP server for ${this.config.language}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}

	async shutdown(): Promise<void> {
		if (!this.connection || !this.isInitialized) {
			return;
		}

		try {
			// Only send protocol messages if the process is still alive
			if (this.isProcessAlive) {
				for (const uri of [...this.openDocuments]) {
					try {
						await this.closeDocument(uri);
					} catch {
						// Process likely dead mid-loop, stop trying
						break;
					}
				}

				try {
					await this.connection.sendRequest('shutdown', null);
				} catch {
					// Server may already be dead
				}

				try {
					await this.connection.sendNotification('exit', null);
				} catch {
					// Server may have exited after shutdown request
				}
			}
		} catch (error) {
			console.debug('Error during LSP shutdown:', error);
		} finally {
			await this.cleanup();
		}
	}

	private async cleanup(): Promise<void> {
		if (this.connection) {
			try {
				this.connection.dispose();
			} catch {
				// Connection may already be disposed or broken
			}
			this.connection = undefined;
		}

		if (this.process) {
			try {
				this.process.kill();
			} catch {
				// Process may already be dead
			}
			this.process = undefined;
		}

		this.isInitialized = false;
		this.isProcessAlive = false;
		this.openDocuments.clear();
		this.documentVersions.clear();
	}

	async openDocument(uri: string, text: string): Promise<void> {
		if (!this.connection || !this.isInitialized) {
			throw new Error('LSP client not initialized');
		}

		if (this.openDocuments.has(uri)) {
			return;
		}

		const languageId = this.config.language;
		const version = 1;

		this.documentVersions.set(uri, version);
		this.openDocuments.add(uri);

		await this.connection.sendNotification('textDocument/didOpen', {
			textDocument: {
				uri,
				languageId,
				version,
				text,
			},
		});
	}

	async closeDocument(uri: string): Promise<void> {
		if (!this.connection || !this.isInitialized) {
			return;
		}

		if (!this.openDocuments.has(uri)) {
			return;
		}

		await this.connection.sendNotification('textDocument/didClose', {
			textDocument: {uri},
		});

		this.openDocuments.delete(uri);
		this.documentVersions.delete(uri);
	}

	async gotoDefinition(uri: string, position: Position): Promise<Location[]> {
		if (!this.connection || !this.isInitialized) {
			throw new Error('LSP client not initialized');
		}

		if (this.config.language === 'csharp' && this.csharpSolutionLoadPromise) {
			await Promise.race([
				this.csharpSolutionLoadPromise,
				new Promise<void>(resolve => setTimeout(resolve, 15000)),
			]);
		}

		if (!this.capabilities?.definitionProvider) {
			return [];
		}

		const params: TextDocumentPositionParams = {
			textDocument: {uri},
			position,
		};

		try {
			const result = await this.connection.sendRequest<
				Location | Location[] | null
			>('textDocument/definition', params);

			if (!result) {
				return [];
			}

			return Array.isArray(result) ? result : [result];
		} catch (error) {
			console.debug('LSP gotoDefinition error:', error);
			return [];
		}
	}

	async findReferences(
		uri: string,
		position: Position,
		includeDeclaration = false,
	): Promise<Location[]> {
		if (!this.connection || !this.isInitialized) {
			throw new Error('LSP client not initialized');
		}

		if (!this.capabilities?.referencesProvider) {
			return [];
		}

		const params: ReferenceParams = {
			textDocument: {uri},
			position,
			context: {includeDeclaration},
		};

		try {
			const result = await this.connection.sendRequest<Location[] | null>(
				'textDocument/references',
				params,
			);

			return result || [];
		} catch (error) {
			console.debug('LSP findReferences failed:', error);
			return [];
		}
	}

	async hover(uri: string, position: Position): Promise<Hover | null> {
		if (!this.connection || !this.isInitialized) {
			throw new Error('LSP client not initialized');
		}

		if (!this.capabilities?.hoverProvider) {
			return null;
		}

		const params: HoverParams = {
			textDocument: {uri},
			position,
		};

		try {
			const result = await this.connection.sendRequest<Hover | null>(
				'textDocument/hover',
				params,
			);

			return result;
		} catch (error) {
			console.debug('LSP hover failed:', error);
			return null;
		}
	}

	async completion(uri: string, position: Position): Promise<CompletionItem[]> {
		if (!this.connection || !this.isInitialized) {
			throw new Error('LSP client not initialized');
		}

		if (!this.capabilities?.completionProvider) {
			return [];
		}

		const params: CompletionParams = {
			textDocument: {uri},
			position,
		};

		try {
			const result = await this.connection.sendRequest<
				CompletionItem[] | {items: CompletionItem[]} | null
			>('textDocument/completion', params);

			if (!result) {
				return [];
			}

			return Array.isArray(result) ? result : result.items || [];
		} catch (error) {
			console.debug('LSP completion failed:', error);
			return [];
		}
	}

	async documentSymbol(
		uri: string,
	): Promise<DocumentSymbol[] | SymbolInformation[]> {
		if (!this.connection || !this.isInitialized) {
			throw new Error('LSP client not initialized');
		}

		if (!this.capabilities?.documentSymbolProvider) {
			return [];
		}

		const params: DocumentSymbolParams = {
			textDocument: {uri},
		};

		try {
			const result = await this.connection.sendRequest<
				DocumentSymbol[] | SymbolInformation[] | null
			>('textDocument/documentSymbol', params);

			return result || [];
		} catch (error) {
			console.debug('LSP documentSymbol failed:', error);
			return [];
		}
	}

	private pathToUri(filePath: string): string {
		const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
		return `file://${
			normalizedPath.startsWith('/') ? '' : '/'
		}${normalizedPath}`;
	}

	getCapabilities(): ServerCapabilities | undefined {
		return this.capabilities;
	}

	isReady(): boolean {
		return this.isInitialized && this.isProcessAlive;
	}
}
