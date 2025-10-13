import {promises as fs} from 'fs';
import * as path from 'path';

/**
 * ACE Code Search Types
 */
export interface CodeSymbol {
	name: string;
	type: 'function' | 'class' | 'method' | 'variable' | 'constant' | 'interface' | 'type' | 'enum' | 'import' | 'export';
	filePath: string;
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
	signature?: string;
	scope?: string;
	language: string;
	context?: string; // Surrounding code context
}

export interface CodeReference {
	symbol: string;
	filePath: string;
	line: number;
	column: number;
	context: string;
	referenceType: 'definition' | 'usage' | 'import' | 'type';
}

export interface SemanticSearchResult {
	query: string;
	symbols: CodeSymbol[];
	references: CodeReference[];
	totalResults: number;
	searchTime: number;
}

export interface ASTNode {
	type: string;
	name?: string;
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
	children?: ASTNode[];
}

/**
 * Language-specific parsers configuration
 */
const LANGUAGE_CONFIG: Record<string, {
	extensions: string[];
	parser: string;
	symbolPatterns: {
		function: RegExp;
		class: RegExp;
		variable?: RegExp;
		import?: RegExp;
		export?: RegExp;
	};
}> = {
	typescript: {
		extensions: ['.ts', '.tsx'],
		parser: 'typescript',
		symbolPatterns: {
			function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
			class: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
			variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,
			import: /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
			export: /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/,
		},
	},
	javascript: {
		extensions: ['.js', '.jsx', '.mjs', '.cjs'],
		parser: 'javascript',
		symbolPatterns: {
			function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
			class: /(?:export\s+)?class\s+(\w+)/,
			variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,
			import: /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
			export: /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/,
		},
	},
	python: {
		extensions: ['.py', '.pyx', '.pyi'],
		parser: 'python',
		symbolPatterns: {
			function: /def\s+(\w+)\s*\(/,
			class: /class\s+(\w+)\s*[(:]/,
			variable: /(\w+)\s*=\s*[^=]/,
			import: /(?:from\s+[\w.]+\s+)?import\s+([\w, ]+)/,
			export: /^(\w+)\s*=\s*/, // Python doesn't have explicit exports
		},
	},
	go: {
		extensions: ['.go'],
		parser: 'go',
		symbolPatterns: {
			function: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,
			class: /type\s+(\w+)\s+struct/,
			variable: /(?:var|const)\s+(\w+)\s+/,
			import: /import\s+(?:"([^"]+)"|[(]([^)]+)[)])/,
			export: /^(?:func|type|var|const)\s+([A-Z]\w+)/, // Go exports start with capital letter
		},
	},
	rust: {
		extensions: ['.rs'],
		parser: 'rust',
		symbolPatterns: {
			function: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[<(]/,
			class: /(?:pub\s+)?struct\s+(\w+)|(?:pub\s+)?enum\s+(\w+)|(?:pub\s+)?trait\s+(\w+)/,
			variable: /(?:pub\s+)?(?:static|const)\s+(\w+)\s*:/,
			import: /use\s+([^;]+);/,
			export: /pub\s+(?:fn|struct|enum|trait|const|static)\s+(\w+)/,
		},
	},
	java: {
		extensions: ['.java'],
		parser: 'java',
		symbolPatterns: {
			function: /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{/,
			class: /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/,
			variable: /(?:public|private|protected|static|final|\s)+[\w<>\[\]]+\s+(\w+)\s*[=;]/,
			import: /import\s+([\w.]+);/,
			export: /public\s+(?:class|interface|enum)\s+(\w+)/,
		},
	},
	csharp: {
		extensions: ['.cs'],
		parser: 'csharp',
		symbolPatterns: {
			function: /(?:public|private|protected|internal|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{/,
			class: /(?:public|private|protected|internal)?\s*(?:abstract|sealed|static)?\s*class\s+(\w+)/,
			variable: /(?:public|private|protected|internal|static|readonly|\s)+[\w<>\[\]]+\s+(\w+)\s*[=;]/,
			import: /using\s+([\w.]+);/,
			export: /public\s+(?:class|interface|enum|struct)\s+(\w+)/,
		},
	},
};

export class ACECodeSearchService {
	private basePath: string;
	private indexCache: Map<string, CodeSymbol[]> = new Map();
	private lastIndexTime: number = 0;
	private readonly INDEX_CACHE_DURATION = 60000; // 1 minute

	constructor(basePath: string = process.cwd()) {
		this.basePath = path.resolve(basePath);
	}

	/**
	 * Detect programming language from file extension
	 */
	private detectLanguage(filePath: string): string | null {
		const ext = path.extname(filePath).toLowerCase();
		for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
			if (config.extensions.includes(ext)) {
				return lang;
			}
		}
		return null;
	}

	/**
	 * Parse file content to extract code symbols using regex patterns
	 */
	private async parseFileSymbols(filePath: string, content: string): Promise<CodeSymbol[]> {
		const symbols: CodeSymbol[] = [];
		const language = this.detectLanguage(filePath);

		if (!language || !LANGUAGE_CONFIG[language]) {
			return symbols;
		}

		const config = LANGUAGE_CONFIG[language];
		const lines = content.split('\n');

		// Parse each line for symbols
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const lineNumber = i + 1;

			// Extract functions
			if (config.symbolPatterns.function) {
				const match = line.match(config.symbolPatterns.function);
				if (match) {
					const name = match[1] || match[2] || match[3];
					if (name) {
						// Get function signature (current line + next few lines)
						const contextLines = lines.slice(i, Math.min(i + 3, lines.length));
						const signature = contextLines.join('\n').trim();

						symbols.push({
							name,
							type: 'function',
							filePath: path.relative(this.basePath, filePath),
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature,
							language,
							context: this.getContext(lines, i, 2),
						});
					}
				}
			}

			// Extract classes
			if (config.symbolPatterns.class) {
				const match = line.match(config.symbolPatterns.class);
				if (match) {
					const name = match[1] || match[2] || match[3];
					if (name) {
						symbols.push({
							name,
							type: 'class',
							filePath: path.relative(this.basePath, filePath),
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: line.trim(),
							language,
							context: this.getContext(lines, i, 2),
						});
					}
				}
			}

			// Extract variables
			if (config.symbolPatterns.variable) {
				const match = line.match(config.symbolPatterns.variable);
				if (match) {
					const name = match[1];
					if (name) {
						symbols.push({
							name,
							type: 'variable',
							filePath: path.relative(this.basePath, filePath),
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: line.trim(),
							language,
							context: this.getContext(lines, i, 1),
						});
					}
				}
			}

			// Extract imports
			if (config.symbolPatterns.import) {
				const match = line.match(config.symbolPatterns.import);
				if (match) {
					const name = match[1] || match[2];
					if (name) {
						symbols.push({
							name,
							type: 'import',
							filePath: path.relative(this.basePath, filePath),
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: line.trim(),
							language,
						});
					}
				}
			}

			// Extract exports
			if (config.symbolPatterns.export) {
				const match = line.match(config.symbolPatterns.export);
				if (match) {
					const name = match[1];
					if (name) {
						symbols.push({
							name,
							type: 'export',
							filePath: path.relative(this.basePath, filePath),
							line: lineNumber,
							column: line.indexOf(name) + 1,
							signature: line.trim(),
							language,
						});
					}
				}
			}
		}

		return symbols;
	}

	/**
	 * Get context lines around a specific line
	 */
	private getContext(lines: string[], lineIndex: number, contextSize: number): string {
		const start = Math.max(0, lineIndex - contextSize);
		const end = Math.min(lines.length, lineIndex + contextSize + 1);
		return lines.slice(start, end).filter(l => l !== undefined).join('\n').trim();
	}

	/**
	 * Build or refresh the code symbol index
	 */
	private async buildIndex(forceRefresh: boolean = false): Promise<void> {
		const now = Date.now();

		// Use cache if available and not expired
		if (!forceRefresh && this.indexCache.size > 0 && (now - this.lastIndexTime) < this.INDEX_CACHE_DURATION) {
			return;
		}

		this.indexCache.clear();

		const searchInDirectory = async (dirPath: string): Promise<void> => {
			try {
				const entries = await fs.readdir(dirPath, {withFileTypes: true});

				for (const entry of entries) {
					const fullPath = path.join(dirPath, entry.name);

					if (entry.isDirectory()) {
						// Skip common ignored directories
						if (
							entry.name === 'node_modules' ||
							entry.name === '.git' ||
							entry.name === 'dist' ||
							entry.name === 'build' ||
							entry.name === '__pycache__' ||
							entry.name === 'target' ||
							entry.name.startsWith('.')
						) {
							continue;
						}
						await searchInDirectory(fullPath);
					} else if (entry.isFile()) {
						const language = this.detectLanguage(fullPath);
						if (language) {
							try {
								const content = await fs.readFile(fullPath, 'utf-8');
								const symbols = await this.parseFileSymbols(fullPath, content);
								if (symbols.length > 0) {
									this.indexCache.set(fullPath, symbols);
								}
							} catch (error) {
								// Skip files that cannot be read
							}
						}
					}
				}
			} catch (error) {
				// Skip directories that cannot be accessed
			}
		};

		await searchInDirectory(this.basePath);
		this.lastIndexTime = now;
	}

	/**
	 * Search for symbols by name with fuzzy matching
	 */
	async searchSymbols(
		query: string,
		symbolType?: CodeSymbol['type'],
		language?: string,
		maxResults: number = 100,
	): Promise<SemanticSearchResult> {
		const startTime = Date.now();
		await this.buildIndex();

		const symbols: CodeSymbol[] = [];
		const queryLower = query.toLowerCase();

		// Fuzzy match scoring
		const calculateScore = (symbolName: string): number => {
			const nameLower = symbolName.toLowerCase();

			// Exact match
			if (nameLower === queryLower) return 100;

			// Starts with
			if (nameLower.startsWith(queryLower)) return 80;

			// Contains
			if (nameLower.includes(queryLower)) return 60;

			// Camel case match (e.g., "gfc" matches "getFileContent")
			const camelCaseMatch = symbolName.split(/(?=[A-Z])/).map(s => s[0]?.toLowerCase() || '').join('');
			if (camelCaseMatch.includes(queryLower)) return 40;

			// Fuzzy match
			let score = 0;
			let queryIndex = 0;
			for (let i = 0; i < nameLower.length && queryIndex < queryLower.length; i++) {
				if (nameLower[i] === queryLower[queryIndex]) {
					score += 20;
					queryIndex++;
				}
			}
			if (queryIndex === queryLower.length) return score;

			return 0;
		};

		// Search through all indexed symbols
		for (const fileSymbols of this.indexCache.values()) {
			for (const symbol of fileSymbols) {
				// Apply filters
				if (symbolType && symbol.type !== symbolType) continue;
				if (language && symbol.language !== language) continue;

				const score = calculateScore(symbol.name);
				if (score > 0) {
					symbols.push({...symbol});
				}

				if (symbols.length >= maxResults) break;
			}
			if (symbols.length >= maxResults) break;
		}

		// Sort by relevance
		symbols.sort((a, b) => calculateScore(b.name) - calculateScore(a.name));

		const searchTime = Date.now() - startTime;

		return {
			query,
			symbols,
			references: [], // References would be populated by findReferences
			totalResults: symbols.length,
			searchTime,
		};
	}

	/**
	 * Find all references to a symbol
	 */
	async findReferences(symbolName: string, maxResults: number = 100): Promise<CodeReference[]> {
		const references: CodeReference[] = [];

		const searchInDirectory = async (dirPath: string): Promise<void> => {
			try {
				const entries = await fs.readdir(dirPath, {withFileTypes: true});

				for (const entry of entries) {
					if (references.length >= maxResults) break;

					const fullPath = path.join(dirPath, entry.name);

					if (entry.isDirectory()) {
						if (
							entry.name === 'node_modules' ||
							entry.name === '.git' ||
							entry.name === 'dist' ||
							entry.name === 'build' ||
							entry.name.startsWith('.')
						) {
							continue;
						}
						await searchInDirectory(fullPath);
					} else if (entry.isFile()) {
						const language = this.detectLanguage(fullPath);
						if (language) {
							try {
								const content = await fs.readFile(fullPath, 'utf-8');
								const lines = content.split('\n');

								// Search for symbol usage
								for (let i = 0; i < lines.length; i++) {
									const line = lines[i];
									if (!line) continue;
									const regex = new RegExp(`\\b${symbolName}\\b`, 'g');
									let match;

									while ((match = regex.exec(line)) !== null) {
										if (references.length >= maxResults) break;

										// Determine reference type
										let referenceType: CodeReference['referenceType'] = 'usage';
										if (line.includes('import') && line.includes(symbolName)) {
											referenceType = 'import';
										} else if (line.match(new RegExp(`(?:function|class|const|let|var)\\s+${symbolName}`))) {
											referenceType = 'definition';
										} else if (line.includes(':') && line.includes(symbolName)) {
											referenceType = 'type';
										}

										references.push({
											symbol: symbolName,
											filePath: path.relative(this.basePath, fullPath),
											line: i + 1,
											column: match.index + 1,
											context: this.getContext(lines, i, 1),
											referenceType,
										});
									}
								}
							} catch (error) {
								// Skip files that cannot be read
							}
						}
					}
				}
			} catch (error) {
				// Skip directories that cannot be accessed
			}
		};

		await searchInDirectory(this.basePath);
		return references;
	}

	/**
	 * Find symbol definition (go to definition)
	 */
	async findDefinition(symbolName: string, contextFile?: string): Promise<CodeSymbol | null> {
		await this.buildIndex();

		// Search in the same file first if context is provided
		if (contextFile) {
			const fullPath = path.resolve(this.basePath, contextFile);
			const fileSymbols = this.indexCache.get(fullPath);
			if (fileSymbols) {
				const symbol = fileSymbols.find(s => s.name === symbolName && (s.type === 'function' || s.type === 'class' || s.type === 'variable'));
				if (symbol) return symbol;
			}
		}

		// Search in all files
		for (const fileSymbols of this.indexCache.values()) {
			const symbol = fileSymbols.find(s => s.name === symbolName && (s.type === 'function' || s.type === 'class' || s.type === 'variable'));
			if (symbol) return symbol;
		}

		return null;
	}

	/**
	 * Fast text search using built-in Node.js (no external dependencies)
	 * Searches for text patterns across files with glob filtering
	 */
	async textSearch(
		pattern: string,
		fileGlob?: string,
		isRegex: boolean = false,
		maxResults: number = 100,
	): Promise<Array<{filePath: string; line: number; column: number; content: string}>> {
		const results: Array<{filePath: string; line: number; column: number; content: string}> = [];

		// Compile search pattern
		let searchRegex: RegExp;
		try {
			if (isRegex) {
				searchRegex = new RegExp(pattern, 'gi');
			} else {
				// Escape special regex characters for literal search
				const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				searchRegex = new RegExp(escaped, 'gi');
			}
		} catch (error) {
			throw new Error(`Invalid regex pattern: ${pattern}`);
		}

		// Parse glob pattern if provided
		const globRegex = fileGlob ? this.globToRegex(fileGlob) : null;

		// Search recursively
		const searchInDirectory = async (dirPath: string): Promise<void> => {
			if (results.length >= maxResults) return;

			try {
				const entries = await fs.readdir(dirPath, {withFileTypes: true});

				for (const entry of entries) {
					if (results.length >= maxResults) break;

					const fullPath = path.join(dirPath, entry.name);

					if (entry.isDirectory()) {
						// Skip ignored directories
						if (
							entry.name === 'node_modules' ||
							entry.name === '.git' ||
							entry.name === 'dist' ||
							entry.name === 'build' ||
							entry.name === '__pycache__' ||
							entry.name === 'target' ||
							entry.name === '.next' ||
							entry.name === '.nuxt' ||
							entry.name === 'coverage' ||
							entry.name.startsWith('.')
						) {
							continue;
						}
						await searchInDirectory(fullPath);
					} else if (entry.isFile()) {
						// Filter by glob if specified
						if (globRegex && !globRegex.test(fullPath)) {
							continue;
						}

						// Skip binary files
						const ext = path.extname(entry.name).toLowerCase();
						const binaryExts = [
							'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg',
							'.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
							'.exe', '.dll', '.so', '.dylib',
							'.mp3', '.mp4', '.avi', '.mov',
							'.woff', '.woff2', '.ttf', '.eot',
							'.class', '.jar', '.war',
							'.o', '.a', '.lib'
						];
						if (binaryExts.includes(ext)) {
							continue;
						}

						try {
							const content = await fs.readFile(fullPath, 'utf-8');
							const lines = content.split('\n');

							for (let i = 0; i < lines.length; i++) {
								if (results.length >= maxResults) break;

								const line = lines[i];
								if (!line) continue;

								// Reset regex for each line
								searchRegex.lastIndex = 0;
								const match = searchRegex.exec(line);

								if (match) {
									results.push({
										filePath: path.relative(this.basePath, fullPath),
										line: i + 1,
										column: match.index + 1,
										content: line.trim(),
									});
								}
							}
						} catch (error) {
							// Skip files that cannot be read (binary, permissions, etc.)
						}
					}
				}
			} catch (error) {
				// Skip directories that cannot be accessed
			}
		};

		await searchInDirectory(this.basePath);
		return results;
	}

	/**
	 * Convert glob pattern to RegExp
	 * Supports: *, **, ?, [abc], {js,ts}
	 */
	private globToRegex(glob: string): RegExp {
		// Escape special regex characters except glob wildcards
		let pattern = glob
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
			.replace(/\*\*/g, '<<<DOUBLESTAR>>>') // Temporarily replace **
			.replace(/\*/g, '[^/]*')               // * matches anything except /
			.replace(/<<<DOUBLESTAR>>>/g, '.*')   // ** matches everything
			.replace(/\?/g, '[^/]');               // ? matches single char except /

		// Handle {js,ts} alternatives
		pattern = pattern.replace(/\\\{([^}]+)\\\}/g, (_, alternatives) => {
			return '(' + alternatives.split(',').join('|') + ')';
		});

		// Handle [abc] character classes (already valid regex)
		pattern = pattern.replace(/\\\[([^\]]+)\\\]/g, '[$1]');

		return new RegExp(pattern, 'i');
	}

	/**
	 * Get code outline for a file (all symbols in the file)
	 */
	async getFileOutline(filePath: string): Promise<CodeSymbol[]> {
		const fullPath = path.resolve(this.basePath, filePath);

		try {
			const content = await fs.readFile(fullPath, 'utf-8');
			return await this.parseFileSymbols(fullPath, content);
		} catch (error) {
			throw new Error(`Failed to get outline for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Search with language-specific context (cross-reference search)
	 */
	async semanticSearch(
		query: string,
		searchType: 'definition' | 'usage' | 'implementation' | 'all' = 'all',
		language?: string,
		maxResults: number = 50,
	): Promise<SemanticSearchResult> {
		const startTime = Date.now();

		// Get symbol search results
		const symbolResults = await this.searchSymbols(query, undefined, language, maxResults);

		// Get reference results if needed
		let references: CodeReference[] = [];
		if (searchType === 'usage' || searchType === 'all') {
			// Find references for the top matching symbols
			const topSymbols = symbolResults.symbols.slice(0, 5);
			for (const symbol of topSymbols) {
				const symbolRefs = await this.findReferences(symbol.name, maxResults);
				references.push(...symbolRefs);
			}
		}

		// Filter results based on search type
		let filteredSymbols = symbolResults.symbols;
		if (searchType === 'definition') {
			filteredSymbols = symbolResults.symbols.filter(s =>
				s.type === 'function' || s.type === 'class' || s.type === 'interface'
			);
		} else if (searchType === 'usage') {
			filteredSymbols = [];
		} else if (searchType === 'implementation') {
			filteredSymbols = symbolResults.symbols.filter(s =>
				s.type === 'function' || s.type === 'method' || s.type === 'class'
			);
		}

		const searchTime = Date.now() - startTime;

		return {
			query,
			symbols: filteredSymbols,
			references,
			totalResults: filteredSymbols.length + references.length,
			searchTime,
		};
	}

	/**
	 * Clear the symbol index cache
	 */
	clearCache(): void {
		this.indexCache.clear();
		this.lastIndexTime = 0;
	}

	/**
	 * Get index statistics
	 */
	getIndexStats(): {
		totalFiles: number;
		totalSymbols: number;
		languageBreakdown: Record<string, number>;
		cacheAge: number;
	} {
		let totalSymbols = 0;
		const languageBreakdown: Record<string, number> = {};

		for (const symbols of this.indexCache.values()) {
			totalSymbols += symbols.length;
			for (const symbol of symbols) {
				languageBreakdown[symbol.language] = (languageBreakdown[symbol.language] || 0) + 1;
			}
		}

		return {
			totalFiles: this.indexCache.size,
			totalSymbols,
			languageBreakdown,
			cacheAge: Date.now() - this.lastIndexTime,
		};
	}
}

// Export a default instance
export const aceCodeSearchService = new ACECodeSearchService();

// MCP Tool definitions for integration
export const mcpTools = [
	{
		name: 'ace_search_symbols',
		description: 'ACE Code Search: Intelligent symbol search across the codebase. Finds functions, classes, variables, and other code symbols with fuzzy matching. Supports multiple programming languages (TypeScript, JavaScript, Python, Go, Rust, Java, C#). Returns precise file locations with line numbers and context.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Symbol name to search for (supports fuzzy matching, e.g., "gfc" can match "getFileContent")',
				},
				symbolType: {
					type: 'string',
					enum: ['function', 'class', 'method', 'variable', 'constant', 'interface', 'type', 'enum', 'import', 'export'],
					description: 'Filter by specific symbol type (optional)',
				},
				language: {
					type: 'string',
					enum: ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp'],
					description: 'Filter by programming language (optional)',
				},
				maxResults: {
					type: 'number',
					description: 'Maximum number of results to return (default: 100)',
					default: 100,
				},
			},
			required: ['query'],
		},
	},
	{
		name: 'ace_find_definition',
		description: 'ACE Code Search: Find the definition of a symbol (Go to Definition). Locates where a function, class, or variable is defined in the codebase. Returns precise location with full signature and context.',
		inputSchema: {
			type: 'object',
			properties: {
				symbolName: {
					type: 'string',
					description: 'Name of the symbol to find definition for',
				},
				contextFile: {
					type: 'string',
					description: 'Current file path for context-aware search (optional, searches current file first)',
				},
			},
			required: ['symbolName'],
		},
	},
	{
		name: 'ace_find_references',
		description: 'ACE Code Search: Find all references to a symbol (Find All References). Shows where a function, class, or variable is used throughout the codebase. Categorizes references as definition, usage, import, or type reference.',
		inputSchema: {
			type: 'object',
			properties: {
				symbolName: {
					type: 'string',
					description: 'Name of the symbol to find references for',
				},
				maxResults: {
					type: 'number',
					description: 'Maximum number of references to return (default: 100)',
					default: 100,
				},
			},
			required: ['symbolName'],
		},
	},
	{
		name: 'ace_semantic_search',
		description: 'ACE Code Search: Advanced semantic search with context understanding. Searches for symbols with intelligent filtering by search type (definition, usage, implementation, all). Combines symbol search with cross-reference analysis.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query (symbol name or pattern)',
				},
				searchType: {
					type: 'string',
					enum: ['definition', 'usage', 'implementation', 'all'],
					description: 'Type of search: definition (find declarations), usage (find usages), implementation (find implementations), all (comprehensive search)',
					default: 'all',
				},
				language: {
					type: 'string',
					enum: ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'csharp'],
					description: 'Filter by programming language (optional)',
				},
				maxResults: {
					type: 'number',
					description: 'Maximum number of results to return (default: 50)',
					default: 50,
				},
			},
			required: ['query'],
		},
	},
	{
		name: 'ace_file_outline',
		description: 'ACE Code Search: Get complete code outline for a file. Shows all functions, classes, variables, and other symbols defined in the file with their locations. Similar to VS Code\'s outline view.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'Path to the file to get outline for (relative to workspace root)',
				},
			},
			required: ['filePath'],
		},
	},
	{
		name: 'ace_text_search',
		description: 'ACE Code Search: Fast text search across the entire codebase using Node.js built-in features (no external dependencies required). Search for exact patterns or regex across all files. Useful for finding strings, comments, TODOs, or any text patterns. Supports glob filtering.',
		inputSchema: {
			type: 'object',
			properties: {
				pattern: {
					type: 'string',
					description: 'Text pattern or regex to search for (e.g., "TODO:", "import.*from", "throw new Error")',
				},
				fileGlob: {
					type: 'string',
					description: 'Glob pattern to filter files (e.g., "*.ts" for TypeScript only, "**/*.{js,ts}" for JS and TS, "src/**/*.py" for Python in src)',
				},
				isRegex: {
					type: 'boolean',
					description: 'Whether the pattern is a regular expression (default: false for literal text search)',
					default: false,
				},
				maxResults: {
					type: 'number',
					description: 'Maximum number of results to return (default: 100)',
					default: 100,
				},
			},
			required: ['pattern'],
		},
	},
	{
		name: 'ace_index_stats',
		description: 'ACE Code Search: Get statistics about the code index. Shows number of indexed files, symbols, language breakdown, and cache status. Useful for understanding search coverage.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	{
		name: 'ace_clear_cache',
		description: 'ACE Code Search: Clear the symbol index cache and force a full re-index on next search. Use when codebase has changed significantly or search results seem stale.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
];
