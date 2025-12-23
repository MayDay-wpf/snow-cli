import {spawn, type ChildProcess} from 'child_process';
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
	private openDocuments: Set<string> = new Set();
	private documentVersions: Map<string, number> = new Map();

	constructor(private config: LSPClientConfig) {}

	async start(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			// For OmniSharp and JDTLS, pass the project root as an argument
			const args = [...this.config.args];
			if (
				this.config.language === 'csharp' ||
				this.config.language === 'java'
			) {
				// OmniSharp: omnisharp --languageserver -s <project_path>
				// JDTLS: jdtls -data <workspace>
				args.push('-s', this.config.rootPath);
			}

			this.process = spawn(this.config.command, args, {
				stdio: ['pipe', 'pipe', 'pipe'],
				cwd: this.config.rootPath,
			});

			processManager.register(this.process);

			this.connection = createMessageConnection(
				new StreamMessageReader(this.process.stdout!),
				new StreamMessageWriter(this.process.stdin!),
			);

			this.connection.listen();
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
			for (const uri of this.openDocuments) {
				await this.closeDocument(uri);
			}

			await this.connection.sendRequest('shutdown', null);
			await this.connection.sendNotification('exit', null);
		} catch (error) {
			console.debug('Error during LSP shutdown:', error);
		} finally {
			await this.cleanup();
		}
	}

	private async cleanup(): Promise<void> {
		if (this.connection) {
			this.connection.dispose();
			this.connection = undefined;
		}

		if (this.process) {
			this.process.kill();
			this.process = undefined;
		}

		this.isInitialized = false;
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
		return this.isInitialized;
	}
}
