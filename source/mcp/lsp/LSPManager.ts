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

		try {
			const uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			await client.openDocument(uri, content);

			const position: Position = {line, character: column};
			const locations = await client.gotoDefinition(uri, position);

			await client.closeDocument(uri);

			return locations.length > 0 ? locations[0]! : null;
		} catch (error) {
			console.debug('LSP findDefinition error:', error);
			return null;
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

		try {
			const uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			await client.openDocument(uri, content);

			const position: Position = {line, character: column};
			const locations = await client.findReferences(uri, position, false);

			await client.closeDocument(uri);

			return locations.slice(0, maxResults);
		} catch (error) {
			console.debug('LSP findReferences error:', error);
			return [];
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

		try {
			const uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			await client.openDocument(uri, content);

			const symbols = await client.documentSymbol(uri);

			await client.closeDocument(uri);

			return symbols;
		} catch (error) {
			console.debug('LSP documentSymbol error:', error);
			return null;
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

		try {
			const uri = this.pathToUri(filePath);
			const content = await this.getDocumentContent(filePath);

			await client.openDocument(uri, content);

			const position: Position = {line, character: column};
			const hover = await client.hover(uri, position);

			await client.closeDocument(uri);

			return hover;
		} catch (error) {
			console.debug('LSP hover error:', error);
			return null;
		}
	}

	private async getDocumentContent(filePath: string): Promise<string> {
		const fullPath = path.resolve(this.basePath, filePath);

		if (this.documentCache.has(fullPath)) {
			return this.documentCache.get(fullPath)!;
		}

		try {
			const content = await fs.readFile(fullPath, 'utf-8');
			this.documentCache.set(fullPath, content);
			return content;
		} catch (error) {
			throw new Error(
				`Failed to read file ${filePath}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
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
