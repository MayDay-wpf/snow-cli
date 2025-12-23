import * as path from 'path';
import {ACECodeSearchService} from '../aceCodeSearch.js';
import {LSPManager} from './LSPManager.js';
import type {CodeSymbol, CodeReference} from '../types/aceCodeSearch.types.js';

export class HybridCodeSearchService {
	private lspManager: LSPManager;
	private regexSearch: ACECodeSearchService;
	private lspTimeout = 3000; // 3秒超时

	constructor(basePath: string = process.cwd()) {
		this.lspManager = new LSPManager(basePath);
		this.regexSearch = new ACECodeSearchService(basePath);
	}

	async findDefinition(
		symbolName: string,
		contextFile?: string,
		line?: number,
		column?: number,
	): Promise<CodeSymbol | null> {
		if (contextFile) {
			try {
				const lspResult = await this.findDefinitionWithLSP(
					symbolName,
					contextFile,
					line,
					column,
				);
				if (lspResult) {
					return lspResult;
				}
			} catch (error) {
				// LSP failed, fallback to regex
			}
		}

		return this.regexSearch.findDefinition(symbolName, contextFile);
	}

	private async findDefinitionWithLSP(
		symbolName: string,
		contextFile: string,
		line?: number,
		column?: number,
	): Promise<CodeSymbol | null> {
		let position: {line: number; column: number} | null = null;

		// If line and column are provided, use them directly
		if (line !== undefined && column !== undefined) {
			position = {line, column};
		} else {
			// Otherwise, find the first occurrence of the symbol in contextFile
			const fs = await import('fs/promises');
			const content = await fs.readFile(contextFile, 'utf-8');
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line) continue;

				const symbolRegex = new RegExp(`\\b${symbolName}\\b`);
				const match = symbolRegex.exec(line);

				if (match) {
					position = {line: i, column: match.index};
					break;
				}
			}
		}

		if (!position) {
			return null;
		}

		// Now ask LSP to find the definition (which may be in another file)
		const timeoutPromise = new Promise<null>(resolve =>
			setTimeout(() => resolve(null), this.lspTimeout),
		);

		const lspPromise = this.lspManager.findDefinition(
			contextFile,
			position.line,
			position.column,
		);

		const location = await Promise.race([lspPromise, timeoutPromise]);

		if (!location) {
			return null;
		}

		// Convert LSP location to CodeSymbol
		const filePath = this.uriToPath(location.uri);

		return {
			name: symbolName,
			type: 'function',
			filePath,
			line: location.range.start.line + 1,
			column: location.range.start.character + 1,
			language: this.detectLanguage(filePath),
		};
	}

	async findReferences(
		symbolName: string,
		maxResults = 100,
	): Promise<CodeReference[]> {
		return this.regexSearch.findReferences(symbolName, maxResults);
	}

	async getFileOutline(
		filePath: string,
		options?: {
			maxResults?: number;
			includeContext?: boolean;
			symbolTypes?: CodeSymbol['type'][];
		},
	): Promise<CodeSymbol[]> {
		try {
			const timeoutPromise = new Promise<null>(resolve =>
				setTimeout(() => resolve(null), this.lspTimeout),
			);

			const lspPromise = this.lspManager.getDocumentSymbols(filePath);
			const symbols = await Promise.race([lspPromise, timeoutPromise]);

			if (symbols && symbols.length > 0) {
				return this.convertLSPSymbolsToCodeSymbols(symbols, filePath);
			}
		} catch (error) {
			// LSP failed, fallback to regex
		}

		return this.regexSearch.getFileOutline(filePath, options);
	}

	private convertLSPSymbolsToCodeSymbols(
		symbols: any[],
		filePath: string,
	): CodeSymbol[] {
		const results: CodeSymbol[] = [];

		const symbolTypeMap: Record<number, CodeSymbol['type']> = {
			5: 'class',
			6: 'method',
			9: 'method',
			10: 'enum',
			11: 'interface',
			12: 'function',
			13: 'variable',
			14: 'constant',
		};

		const processSymbol = (symbol: any) => {
			const range = symbol.location?.range || symbol.range;
			if (!range) return;

			const symbolType = symbolTypeMap[symbol.kind];
			if (!symbolType) return;

			results.push({
				name: symbol.name,
				type: symbolType,
				filePath: this.uriToPath(symbol.location?.uri || filePath),
				line: range.start.line + 1,
				column: range.start.character + 1,
				language: this.detectLanguage(filePath),
			});

			if (symbol.children) {
				for (const child of symbol.children) {
					processSymbol(child);
				}
			}
		};

		for (const symbol of symbols) {
			processSymbol(symbol);
		}

		return results;
	}

	private uriToPath(uri: string): string {
		if (uri.startsWith('file://')) {
			return uri.slice(7);
		}

		return uri;
	}

	private detectLanguage(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase();
		const languageMap: Record<string, string> = {
			'.ts': 'typescript',
			'.tsx': 'typescript',
			'.js': 'javascript',
			'.jsx': 'javascript',
			'.py': 'python',
			'.go': 'go',
			'.rs': 'rust',
			'.java': 'java',
			'.cs': 'csharp',
		};

		return languageMap[ext] || 'unknown';
	}

	async textSearch(
		pattern: string,
		fileGlob?: string,
		isRegex = false,
		maxResults = 100,
	) {
		return this.regexSearch.textSearch(pattern, fileGlob, isRegex, maxResults);
	}

	async semanticSearch(
		query: string,
		searchType: 'definition' | 'usage' | 'implementation' | 'all' = 'all',
		language?: string,
		symbolType?: CodeSymbol['type'],
		maxResults = 50,
	) {
		return this.regexSearch.semanticSearch(
			query,
			searchType,
			language,
			symbolType,
			maxResults,
		);
	}

	async dispose(): Promise<void> {
		await this.lspManager.dispose();
	}
}

export const hybridCodeSearchService = new HybridCodeSearchService();
