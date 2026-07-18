import {promises as fs} from 'fs';
import * as path from 'path';
import type {Position, Location} from 'vscode-languageserver-protocol';
import {LSPClient} from './LSPClient.js';
import {LSPServerRegistry} from './LSPServerRegistry.js';

export class LSPManager {
	private clients: Map<string, LSPClient> = new Map();
	private documentCache: Map<string, string> = new Map();

	constructor(private basePath: string) {}

	async getClient(language: string): Promise<LSPClient | null> {
		if (this.clients.has(language)) {
			const client = this.clients.get(language)!;
			if (client.isReady()) {
				return client;
			}
			// Client is dead or not initialized, clean it up before recreating
			try {
				await client.shutdown();
			} catch {
				// Ignore cleanup errors for dead clients
			}
			this.clients.delete(language);
		}

		const config = LSPServerRegistry.getConfig(language);
		if (!config) {
			return null;
		}

		const installed = await LSPServerRegistry.isServerInstalled(language);
		if (!installed) {
			return null;
		}

		try {
			const client = new LSPClient({
				...config,
				language,
				rootPath: this.basePath,
			});

			await client.start();
			this.clients.set(language, client);
			return client;
		} catch (error) {
			return null;
		}
	}

	async findDefinition(
		filePath: string,
		line: number,
		column: number,
	): Promise<Location | null> {
		const serverInfo = LSPServerRegistry.getServerForFile(filePath);
		if (!serverInfo) {
			return null;
		}

		const client = await this.getClient(serverInfo.language);
		if (!client) {
			return null;
		}

		let uri: string | undefined;
		try {
			uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			if (!content) {
				return null;
			}

			await client.openDocument(uri, content);

			if (!client.isReady()) {
				return null;
			}

			const position: Position = {line, character: column};
			const locations = await client.gotoDefinition(uri, position);

			return locations.length > 0 ? locations[0]! : null;
		} catch (error) {
			console.debug('LSP findDefinition error:', error);
			return null;
		} finally {
			if (uri) {
				try {
					await client.closeDocument(uri);
				} catch {
					// Suppress close errors — the server may already be dead
				}
			}
		}
	}

	async findReferences(
		filePath: string,
		line: number,
		column: number,
		maxResults = 100,
	): Promise<Location[]> {
		const serverInfo = LSPServerRegistry.getServerForFile(filePath);
		if (!serverInfo) {
			return [];
		}

		const client = await this.getClient(serverInfo.language);
		if (!client) {
			return [];
		}

		let uri: string | undefined;
		try {
			uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			if (!content) {
				return [];
			}

			await client.openDocument(uri, content);

			if (!client.isReady()) {
				return [];
			}

			const position: Position = {line, character: column};
			const locations = await client.findReferences(uri, position, false);

			return locations.slice(0, maxResults);
		} catch (error) {
			console.debug('LSP findReferences error:', error);
			return [];
		} finally {
			if (uri) {
				try {
					await client.closeDocument(uri);
				} catch {
					// Suppress close errors — the server may already be dead
				}
			}
		}
	}

	async getDocumentSymbols(filePath: string) {
		const serverInfo = LSPServerRegistry.getServerForFile(filePath);
		if (!serverInfo) {
			return null;
		}

		const client = await this.getClient(serverInfo.language);
		if (!client) {
			return null;
		}

		let uri: string | undefined;
		try {
			uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			if (!content) {
				return null;
			}

			await client.openDocument(uri, content);

			if (!client.isReady()) {
				return null;
			}

			const symbols = await client.documentSymbol(uri);

			return symbols;
		} catch (error) {
			console.debug('LSP documentSymbol error:', error);
			return null;
		} finally {
			if (uri) {
				try {
					await client.closeDocument(uri);
				} catch {
					// Suppress close errors — the server may already be dead
				}
			}
		}
	}

	async getHoverInfo(filePath: string, line: number, column: number) {
		const serverInfo = LSPServerRegistry.getServerForFile(filePath);
		if (!serverInfo) {
			return null;
		}

		const client = await this.getClient(serverInfo.language);
		if (!client) {
			return null;
		}

		let uri: string | undefined;
		try {
			uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			if (!content) {
				return null;
			}

			await client.openDocument(uri, content);

			if (!client.isReady()) {
				return null;
			}

			const position: Position = {line, character: column};
			const hover = await client.hover(uri, position);

			return hover;
		} catch (error) {
			console.debug('LSP hover error:', error);
			return null;
		} finally {
			if (uri) {
				try {
					await client.closeDocument(uri);
				} catch {
					// Suppress close errors — the server may already be dead
				}
			}
		}
	}

	private async getDocumentContent(filePath: string): Promise<string | null> {
		const fullPath = path.resolve(this.basePath, filePath);

		if (this.documentCache.has(fullPath)) {
			return this.documentCache.get(fullPath)!;
		}

		try {
			const content = await fs.readFile(fullPath, 'utf-8');
			this.documentCache.set(fullPath, content);
			return content;
		} catch (error) {
			return null;
		}
	}

	private pathToUri(filePath: string): string {
		const normalizedPath = path.resolve(this.basePath, filePath);
		const finalPath = normalizedPath.replace(/\\/g, '/');
		return `file://${finalPath.startsWith('/') ? '' : '/'}${finalPath}`;
	}

	async dispose(): Promise<void> {
		for (const client of this.clients.values()) {
			await client.shutdown();
		}

		this.clients.clear();
		this.documentCache.clear();
	}

	clearDocumentCache(): void {
		this.documentCache.clear();
	}
}
