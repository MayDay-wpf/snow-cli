import {promises as fs} from 'fs';
import * as path from 'path';
import {spawn} from 'child_process';
import {EOL} from 'os';
import {type FzfResultItem, AsyncFzf} from 'fzf';

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
	private fzfIndex: AsyncFzf<string[]> | undefined;
	private allIndexedFiles: string[] = [];
	private fileModTimes: Map<string, number> = new Map(); // Track file modification times
	private customExcludes: string[] = []; // Custom exclusion patterns from config files
	private excludesLoaded: boolean = false; // Track if exclusions have been loaded

	// Default exclusion directories
	private readonly DEFAULT_EXCLUDES = [
		'node_modules',
		'.git',
		'dist',
		'build',
		'__pycache__',
		'target',
		'.next',
		'.nuxt',
		'coverage',
		'out',
		'.cache',
		'vendor',
	];

	constructor(basePath: string = process.cwd()) {
		this.basePath = path.resolve(basePath);
	}

	/**
	 * Load custom exclusion patterns from .gitignore and .snowignore
	 */
	private async loadExclusionPatterns(): Promise<void> {
		if (this.excludesLoaded) return;

		const patterns: string[] = [];

		// Load .gitignore if exists
		const gitignorePath = path.join(this.basePath, '.gitignore');
		try {
			const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
			const lines = gitignoreContent.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				// Skip empty lines and comments
				if (trimmed && !trimmed.startsWith('#')) {
					// Remove leading slash and trailing slash
					const pattern = trimmed.replace(/^\//, '').replace(/\/$/, '');
					if (pattern) {
						patterns.push(pattern);
					}
				}
			}
		} catch {
			// .gitignore doesn't exist or cannot be read, skip
		}

		// Load .snowignore if exists
		const snowignorePath = path.join(this.basePath, '.snowignore');
		try {
			const snowignoreContent = await fs.readFile(snowignorePath, 'utf-8');
			const lines = snowignoreContent.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				// Skip empty lines and comments
				if (trimmed && !trimmed.startsWith('#')) {
					// Remove leading slash and trailing slash
					const pattern = trimmed.replace(/^\//, '').replace(/\/$/, '');
					if (pattern) {
						patterns.push(pattern);
					}
				}
			}
		} catch {
			// .snowignore doesn't exist or cannot be read, skip
		}

		this.customExcludes = patterns;
		this.excludesLoaded = true;
	}

	/**
	 * Check if a directory should be excluded based on exclusion patterns
	 */
	private shouldExcludeDirectory(dirName: string, fullPath: string): boolean {
		// Check default excludes
		if (this.DEFAULT_EXCLUDES.includes(dirName)) {
			return true;
		}

		// Check hidden directories
		if (dirName.startsWith('.')) {
			return true;
		}

		// Check custom exclusion patterns
		const relativePath = path.relative(this.basePath, fullPath);
		for (const pattern of this.customExcludes) {
			// Simple pattern matching: exact match or glob-style wildcards
			if (pattern.includes('*')) {
				// Convert simple glob to regex for matching
				const regexPattern = pattern
					.replace(/\./g, '\\.')
					.replace(/\*/g, '.*');
				const regex = new RegExp(`^${regexPattern}$`);
				if (regex.test(relativePath) || regex.test(dirName)) {
					return true;
				}
			} else {
				// Exact match
				if (relativePath === pattern || dirName === pattern || relativePath.startsWith(pattern + '/')) {
					return true;
				}
			}
		}

		return false;
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
	 * Check if a directory is a Git repository
	 */
	private async isGitRepository(directory: string = this.basePath): Promise<boolean> {
		try {
			const gitDir = path.join(directory, '.git');
			const stats = await fs.stat(gitDir);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Check if a command is available in the system PATH
	 */
	private isCommandAvailable(command: string): Promise<boolean> {
		return new Promise((resolve) => {
			try {
				let child;
				if (process.platform === 'win32') {
					// Windows: where is an executable, no shell needed
					child = spawn('where', [command], {
						stdio: 'ignore',
						windowsHide: true,
					});
				} else {
					// Unix/Linux: Use 'which' command instead of 'command -v'
					// 'which' is an external executable, not a shell builtin
					child = spawn('which', [command], {
						stdio: 'ignore',
					});
				}

				child.on('close', (code) => resolve(code === 0));
				child.on('error', () => resolve(false));
			} catch {
				resolve(false);
			}
		});
	}

	/**
	 * Parse grep output (format: filePath:lineNumber:lineContent)
	 */
	private parseGrepOutput(
		output: string,
		basePath: string,
	): Array<{filePath: string; line: number; column: number; content: string}> {
		const results: Array<{filePath: string; line: number; column: number; content: string}> = [];
		if (!output) return results;

		const lines = output.split(EOL);

		for (const line of lines) {
			if (!line.trim()) continue;

			// Find first and second colon indices
			const firstColonIndex = line.indexOf(':');
			if (firstColonIndex === -1) continue;

			const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
			if (secondColonIndex === -1) continue;

			// Extract parts
			const filePathRaw = line.substring(0, firstColonIndex);
			const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
			const lineContent = line.substring(secondColonIndex + 1);

			const lineNumber = parseInt(lineNumberStr, 10);
			if (isNaN(lineNumber)) continue;

			const absoluteFilePath = path.resolve(basePath, filePathRaw);
			const relativeFilePath = path.relative(basePath, absoluteFilePath);

			results.push({
				filePath: relativeFilePath || path.basename(absoluteFilePath),
				line: lineNumber,
				column: 1, // grep doesn't provide column info, default to 1
				content: lineContent.trim(),
			});
		}

		return results;
	}

	/**
	 * Build or refresh the code symbol index with incremental updates
	 */
	private async buildIndex(forceRefresh: boolean = false): Promise<void> {
		const now = Date.now();

		// Use cache if available and not expired
		if (!forceRefresh && this.indexCache.size > 0 && (now - this.lastIndexTime) < this.INDEX_CACHE_DURATION) {
			return;
		}

		// Load exclusion patterns
		await this.loadExclusionPatterns();

		// For force refresh, clear everything
		if (forceRefresh) {
			this.indexCache.clear();
			this.fileModTimes.clear();
			this.allIndexedFiles = [];
		}

		const filesToProcess: string[] = [];

		const searchInDirectory = async (dirPath: string): Promise<void> => {
			try {
				const entries = await fs.readdir(dirPath, {withFileTypes: true});

				for (const entry of entries) {
					const fullPath = path.join(dirPath, entry.name);

					if (entry.isDirectory()) {
						// Use configurable exclusion check
						if (this.shouldExcludeDirectory(entry.name, fullPath)) {
							continue;
						}
						await searchInDirectory(fullPath);
					} else if (entry.isFile()) {
						const language = this.detectLanguage(fullPath);
						if (language) {
							// Check if file needs to be re-indexed
							try {
								const stats = await fs.stat(fullPath);
								const currentMtime = stats.mtimeMs;
								const cachedMtime = this.fileModTimes.get(fullPath);

								// Only process if file is new or modified
								if (cachedMtime === undefined || currentMtime > cachedMtime) {
									filesToProcess.push(fullPath);
									this.fileModTimes.set(fullPath, currentMtime);
								}

								// Track all indexed files (even if not modified)
								if (!this.allIndexedFiles.includes(fullPath)) {
									this.allIndexedFiles.push(fullPath);
								}
							} catch (error) {
								// If we can't stat the file, skip it
							}
						}
					}
				}
			} catch (error) {
				// Skip directories that cannot be accessed
			}
		};

		await searchInDirectory(this.basePath);

		// Process only modified or new files
		for (const fullPath of filesToProcess) {
			try {
				const content = await fs.readFile(fullPath, 'utf-8');
				const symbols = await this.parseFileSymbols(fullPath, content);
				if (symbols.length > 0) {
					this.indexCache.set(fullPath, symbols);
				} else {
					// Remove entry if no symbols found
					this.indexCache.delete(fullPath);
				}
			} catch (error) {
				// Remove from index if file cannot be read
				this.indexCache.delete(fullPath);
				this.fileModTimes.delete(fullPath);
			}
		}

		// Clean up deleted files from cache
		for (const cachedPath of Array.from(this.indexCache.keys())) {
			try {
				await fs.access(cachedPath);
			} catch {
				// File no longer exists, remove from cache
				this.indexCache.delete(cachedPath);
				this.fileModTimes.delete(cachedPath);
				const fileIndex = this.allIndexedFiles.indexOf(cachedPath);
				if (fileIndex !== -1) {
					this.allIndexedFiles.splice(fileIndex, 1);
				}
			}
		}

		this.lastIndexTime = now;

		// Rebuild fzf index only if files were processed
		if (filesToProcess.length > 0 || forceRefresh) {
			this.buildFzfIndex();
		}
	}

	/**
	 * Build fzf index for fast fuzzy symbol name matching
	 */
	private buildFzfIndex(): void {
		const symbolNames: string[] = [];

		// Collect all unique symbol names
		for (const fileSymbols of this.indexCache.values()) {
			for (const symbol of fileSymbols) {
				symbolNames.push(symbol.name);
			}
		}

		// Remove duplicates and sort
		const uniqueNames = Array.from(new Set(symbolNames));

		// Build fzf index with adaptive algorithm selection
		// Use v1 for >20k symbols, v2 for ≤20k symbols
		const fuzzyAlgorithm = uniqueNames.length > 20000 ? 'v1' : 'v2';
		this.fzfIndex = new AsyncFzf(uniqueNames, {
			fuzzy: fuzzyAlgorithm,
		});
	}

	/**
	 * Search for symbols by name with fuzzy matching using fzf
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

		// Use fzf for fuzzy matching if available
		if (this.fzfIndex) {
			try {
				// Get fuzzy matches from fzf
				const fzfResults = await this.fzfIndex.find(query);

				// Build a set of matched symbol names for quick lookup
				const matchedNames = new Set(fzfResults.map((r: FzfResultItem<string>) => r.item));

				// Collect matching symbols with filters
				for (const fileSymbols of this.indexCache.values()) {
					for (const symbol of fileSymbols) {
						// Apply filters
						if (symbolType && symbol.type !== symbolType) continue;
						if (language && symbol.language !== language) continue;

						// Check if symbol name is in fzf matches
						if (matchedNames.has(symbol.name)) {
							symbols.push({...symbol});
						}

						if (symbols.length >= maxResults) break;
					}
					if (symbols.length >= maxResults) break;
				}

				// Sort by fzf score (already sorted by relevance from fzf.find)
				// Maintain the fzf order by using the original fzfResults order
				const nameOrder = new Map(fzfResults.map((r: FzfResultItem<string>, i: number) => [r.item, i]));
				symbols.sort((a, b) => {
					const aOrder = nameOrder.get(a.name);
					const bOrder = nameOrder.get(b.name);
					// Handle undefined cases
					if (aOrder === undefined && bOrder === undefined) return 0;
					if (aOrder === undefined) return 1;
					if (bOrder === undefined) return -1;
					// Both are numbers (TypeScript needs explicit assertion)
					return (aOrder as number) - (bOrder as number);
				});
			} catch (error) {
				// Fall back to manual scoring if fzf fails
				console.debug('fzf search failed, falling back to manual scoring');
				return this.searchSymbolsManual(query, symbolType, language, maxResults, startTime);
			}
		} else {
			// Fallback to manual scoring if fzf is not available
			return this.searchSymbolsManual(query, symbolType, language, maxResults, startTime);
		}

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
	 * Fallback symbol search using manual fuzzy matching
	 */
	private async searchSymbolsManual(
		query: string,
		symbolType?: CodeSymbol['type'],
		language?: string,
		maxResults: number = 100,
		startTime: number = Date.now(),
	): Promise<SemanticSearchResult> {
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
	 * Strategy 1: Use git grep for fast searching in Git repositories
	 */
	private async gitGrepSearch(
		pattern: string,
		fileGlob?: string,
		maxResults: number = 100,
	): Promise<Array<{filePath: string; line: number; column: number; content: string}>> {
		return new Promise((resolve, reject) => {
			const args = ['grep', '--untracked', '-n', '-E', '--ignore-case', pattern];

			if (fileGlob) {
				args.push('--', fileGlob);
			}

			const child = spawn('git', args, {
				cwd: this.basePath,
				windowsHide: true,
			});

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];

			child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
			child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

			child.on('error', (err) => {
				reject(new Error(`Failed to start git grep: ${err.message}`));
			});

			child.on('close', (code) => {
				const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
				const stderrData = Buffer.concat(stderrChunks).toString('utf8');

				if (code === 0) {
					const results = this.parseGrepOutput(stdoutData, this.basePath);
					resolve(results.slice(0, maxResults));
				} else if (code === 1) {
					// No matches found
					resolve([]);
				} else {
					reject(new Error(`git grep exited with code ${code}: ${stderrData}`));
				}
			});
		});
	}

	/**
	 * Strategy 2: Use system grep (or ripgrep if available) for fast searching
	 */
	private async systemGrepSearch(
		pattern: string,
		fileGlob?: string,
		maxResults: number = 100,
	): Promise<Array<{filePath: string; line: number; column: number; content: string}>> {
		// Prefer ripgrep (rg) over grep if available
		const grepCommand = await this.isCommandAvailable('rg') ? 'rg' : 'grep';
		const isRipgrep = grepCommand === 'rg';

		return new Promise((resolve, reject) => {
			const args = isRipgrep
				? ['-n', '-i', '--no-heading', pattern]
				: ['-r', '-n', '-H', '-E', '-i'];

			// Add exclusion patterns
			const excludeDirs = [
				'node_modules', '.git', 'dist', 'build',
				'__pycache__', 'target', '.next', '.nuxt', 'coverage'
			];

			if (isRipgrep) {
				// Ripgrep uses --glob for filtering
				excludeDirs.forEach(dir => args.push('--glob', `!${dir}/`));
				if (fileGlob) {
					args.push('--glob', fileGlob);
				}
			} else {
				// System grep uses --exclude-dir
				excludeDirs.forEach(dir => args.push(`--exclude-dir=${dir}`));
				if (fileGlob) {
					args.push(`--include=${fileGlob}`);
				}
				args.push(pattern, '.');
			}

			const child = spawn(grepCommand, args, {
				cwd: this.basePath,
				windowsHide: true,
			});

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];

			child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
			child.stderr.on('data', (chunk) => {
				const stderrStr = chunk.toString();
				// Suppress common harmless stderr messages
				if (!stderrStr.includes('Permission denied') &&
					!/grep:.*: Is a directory/i.test(stderrStr)) {
					stderrChunks.push(chunk);
				}
			});

			child.on('error', (err) => {
				reject(new Error(`Failed to start ${grepCommand}: ${err.message}`));
			});

			child.on('close', (code) => {
				const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
				const stderrData = Buffer.concat(stderrChunks).toString('utf8').trim();

				if (code === 0) {
					const results = this.parseGrepOutput(stdoutData, this.basePath);
					resolve(results.slice(0, maxResults));
				} else if (code === 1) {
					// No matches found
					resolve([]);
				} else if (stderrData) {
					reject(new Error(`${grepCommand} exited with code ${code}: ${stderrData}`));
				} else {
					// Exit code > 1 but no stderr, likely just suppressed errors
					resolve([]);
				}
			});
		});
	}

	/**
	 * Strategy 3: Pure JavaScript fallback search
	 */
	private async jsTextSearch(
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
	 * Fast text search with multi-layer strategy
	 * Strategy 1: git grep (fastest, uses git index)
	 * Strategy 2: system grep/ripgrep (fast, system-optimized)
	 * Strategy 3: JavaScript fallback (slower, but always works)
	 * Searches for text patterns across files with glob filtering
	 */
	async textSearch(
		pattern: string,
		fileGlob?: string,
		isRegex: boolean = false,
		maxResults: number = 100,
	): Promise<Array<{filePath: string; line: number; column: number; content: string}>> {
		// Strategy 1: Try git grep first
		if (await this.isGitRepository()) {
			try {
				const gitAvailable = await this.isCommandAvailable('git');
				if (gitAvailable) {
					const results = await this.gitGrepSearch(pattern, fileGlob, maxResults);
					if (results.length > 0 || !isRegex) {
						// git grep doesn't support all regex features,
						// fall back if pattern is complex regex and no results
						return await this.sortResultsByRecency(results);
					}
				}
			} catch (error) {
				// Fall through to next strategy
				//console.debug('git grep failed, falling back to system grep');
			}
		}

		// Strategy 2: Try system grep/ripgrep
		try {
			const grepAvailable = await this.isCommandAvailable('rg') ||
				await this.isCommandAvailable('grep');
			if (grepAvailable) {
				const results = await this.systemGrepSearch(pattern, fileGlob, maxResults);
				return await this.sortResultsByRecency(results);
			}
		} catch (error) {
			// Fall through to JavaScript fallback
			//console.debug('system grep failed, falling back to JavaScript search');
		}

		// Strategy 3: JavaScript fallback (always works)
		const results = await this.jsTextSearch(pattern, fileGlob, isRegex, maxResults);
		return await this.sortResultsByRecency(results);
	}

	/**
	 * Sort search results by file modification time (recent files first)
	 * Files modified within last 24 hours are prioritized
	 */
	private async sortResultsByRecency(
		results: Array<{filePath: string; line: number; column: number; content: string}>,
	): Promise<Array<{filePath: string; line: number; column: number; content: string}>> {
		if (results.length === 0) return results;

		const now = Date.now();
		const recentThreshold = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

		// Get file modification times
		const fileModTimes = new Map<string, number>();
		for (const result of results) {
			if (fileModTimes.has(result.filePath)) continue;

			try {
				const fullPath = path.resolve(this.basePath, result.filePath);
				const stats = await fs.stat(fullPath);
				fileModTimes.set(result.filePath, stats.mtimeMs);
			} catch {
				// If we can't get stats, treat as old file
				fileModTimes.set(result.filePath, 0);
			}
		}

		// Sort results: recent files first, then by original order
		return results.sort((a, b) => {
			const aMtime = fileModTimes.get(a.filePath) || 0;
			const bMtime = fileModTimes.get(b.filePath) || 0;

			const aIsRecent = (now - aMtime) < recentThreshold;
			const bIsRecent = (now - bMtime) < recentThreshold;

			// Recent files come first
			if (aIsRecent && !bIsRecent) return -1;
			if (!aIsRecent && bIsRecent) return 1;

			// Both recent or both old: sort by modification time (newer first)
			if (aIsRecent && bIsRecent) return bMtime - aMtime;

			// Both old: maintain original order (preserve relevance from grep)
			return 0;
		});
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
	 * Clear the symbol index cache and force full re-index on next search
	 */
	clearCache(): void {
		this.indexCache.clear();
		this.fileModTimes.clear();
		this.allIndexedFiles = [];
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
