import {promises as fs} from 'fs';
import * as path from 'path';
import {spawn} from 'child_process';
import {type FzfResultItem, AsyncFzf} from 'fzf';
// Type definitions
import type {
	CodeSymbol,
	CodeReference,
	SemanticSearchResult,
} from './types/aceCodeSearch.types.js';
// Utility functions
import {detectLanguage} from './utils/aceCodeSearch/language.utils.js';
import {
	loadExclusionPatterns,
	shouldExcludeDirectory,
	readFileWithCache,
} from './utils/aceCodeSearch/filesystem.utils.js';
import {
	parseFileSymbols,
	getContext,
} from './utils/aceCodeSearch/symbol.utils.js';
import {
	isCommandAvailable,
	parseGrepOutput,
	globToRegex,
} from './utils/aceCodeSearch/search.utils.js';

export class ACECodeSearchService {
	private basePath: string;
	private indexCache: Map<string, CodeSymbol[]> = new Map();
	private lastIndexTime: number = 0;
	private readonly INDEX_CACHE_DURATION = 60000; // 1 minute
	private fzfIndex: AsyncFzf<string[]> | undefined;
	private allIndexedFiles: Set<string> = new Set(); // 使用 Set 提高查找性能 O(1)
	private fileModTimes: Map<string, number> = new Map(); // Track file modification times
	private customExcludes: string[] = []; // Custom exclusion patterns from config files
	private excludesLoaded: boolean = false; // Track if exclusions have been loaded

	// 文件内容缓存（用于减少重复读取）
	private fileContentCache: Map<string, {content: string; mtime: number}> =
		new Map();
	// 正则表达式缓存（用于 shouldExcludeDirectory）
	private regexCache: Map<string, RegExp> = new Map();

	constructor(basePath: string = process.cwd()) {
		this.basePath = path.resolve(basePath);
	}

	/**
	 * Load custom exclusion patterns from .gitignore and .snowignore
	 */
	private async loadExclusionPatterns(): Promise<void> {
		if (this.excludesLoaded) return;
		this.customExcludes = await loadExclusionPatterns(this.basePath);
		this.excludesLoaded = true;
	}

	/**
	 * Check if a directory is a Git repository
	 */
	private async isGitRepository(
		directory: string = this.basePath,
	): Promise<boolean> {
		try {
			const gitDir = path.join(directory, '.git');
			const stats = await fs.stat(gitDir);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Build or refresh the code symbol index with incremental updates
	 */
	private async buildIndex(forceRefresh: boolean = false): Promise<void> {
		const now = Date.now();

		// Use cache if available and not expired
		if (
			!forceRefresh &&
			this.indexCache.size > 0 &&
			now - this.lastIndexTime < this.INDEX_CACHE_DURATION
		) {
			return;
		}

		// Load exclusion patterns
		await this.loadExclusionPatterns();

		// For force refresh, clear everything
		if (forceRefresh) {
			this.indexCache.clear();
			this.fileModTimes.clear();
			this.allIndexedFiles.clear();
			this.fileContentCache.clear();
		}

		const filesToProcess: string[] = [];

		const searchInDirectory = async (dirPath: string): Promise<void> => {
			try {
				const entries = await fs.readdir(dirPath, {withFileTypes: true});

				for (const entry of entries) {
					const fullPath = path.join(dirPath, entry.name);

					if (entry.isDirectory()) {
						// Use configurable exclusion check
						if (
							shouldExcludeDirectory(
								entry.name,
								fullPath,
								this.basePath,
								this.customExcludes,
								this.regexCache,
							)
						) {
							continue;
						}
						await searchInDirectory(fullPath);
					} else if (entry.isFile()) {
						const language = detectLanguage(fullPath);
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
								this.allIndexedFiles.add(fullPath);
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

		// Process files in batches for better performance
		const BATCH_SIZE = 10; // 并发处理批次大小
		const batches: string[][] = [];

		for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
			batches.push(filesToProcess.slice(i, i + BATCH_SIZE));
		}

		// Process batches concurrently
		for (const batch of batches) {
			await Promise.all(
				batch.map(async fullPath => {
					try {
						const content = await readFileWithCache(
							fullPath,
							this.fileContentCache,
						);
						const symbols = await parseFileSymbols(
							fullPath,
							content,
							this.basePath,
						);
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
				}),
			);
		}

		// Clean up deleted files from cache
		for (const cachedPath of Array.from(this.indexCache.keys())) {
			try {
				await fs.access(cachedPath);
			} catch {
				// File no longer exists, remove from cache
				this.indexCache.delete(cachedPath);
				this.fileModTimes.delete(cachedPath);
				this.allIndexedFiles.delete(cachedPath);
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
				const matchedNames = new Set(
					fzfResults.map((r: FzfResultItem<string>) => r.item),
				);

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
				const nameOrder = new Map(
					fzfResults.map((r: FzfResultItem<string>, i: number) => [r.item, i]),
				);
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
				return this.searchSymbolsManual(
					query,
					symbolType,
					language,
					maxResults,
					startTime,
				);
			}
		} else {
			// Fallback to manual scoring if fzf is not available
			return this.searchSymbolsManual(
				query,
				symbolType,
				language,
				maxResults,
				startTime,
			);
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
			const camelCaseMatch = symbolName
				.split(/(?=[A-Z])/)
				.map(s => s[0]?.toLowerCase() || '')
				.join('');
			if (camelCaseMatch.includes(queryLower)) return 40;

			// Fuzzy match
			let score = 0;
			let queryIndex = 0;
			for (
				let i = 0;
				i < nameLower.length && queryIndex < queryLower.length;
				i++
			) {
				if (nameLower[i] === queryLower[queryIndex]) {
					score += 20;
					queryIndex++;
				}
			}
			if (queryIndex === queryLower.length) return score;

			return 0;
		};

		// Search through all indexed symbols with score caching
		const symbolsWithScores: Array<{symbol: CodeSymbol; score: number}> = [];

		for (const fileSymbols of this.indexCache.values()) {
			for (const symbol of fileSymbols) {
				// Apply filters
				if (symbolType && symbol.type !== symbolType) continue;
				if (language && symbol.language !== language) continue;

				const score = calculateScore(symbol.name);
				if (score > 0) {
					symbolsWithScores.push({symbol: {...symbol}, score});
				}

				if (symbolsWithScores.length >= maxResults * 2) break; // 获取更多候选以便排序
			}
			if (symbolsWithScores.length >= maxResults * 2) break;
		}

		// Sort by score (避免重复计算)
		symbolsWithScores.sort((a, b) => b.score - a.score);

		// Extract top results
		const symbols = symbolsWithScores
			.slice(0, maxResults)
			.map(item => item.symbol);

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
	async findReferences(
		symbolName: string,
		maxResults: number = 100,
	): Promise<CodeReference[]> {
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
						const language = detectLanguage(fullPath);
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
										} else if (
											line.match(
												new RegExp(
													`(?:function|class|const|let|var)\\s+${symbolName}`,
												),
											)
										) {
											referenceType = 'definition';
										} else if (
											line.includes(':') &&
											line.includes(symbolName)
										) {
											referenceType = 'type';
										}

										references.push({
											symbol: symbolName,
											filePath: path.relative(this.basePath, fullPath),
											line: i + 1,
											column: match.index + 1,
											context: getContext(lines, i, 1),
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
	async findDefinition(
		symbolName: string,
		contextFile?: string,
	): Promise<CodeSymbol | null> {
		await this.buildIndex();

		// Search in the same file first if context is provided
		if (contextFile) {
			const fullPath = path.resolve(this.basePath, contextFile);
			const fileSymbols = this.indexCache.get(fullPath);
			if (fileSymbols) {
				const symbol = fileSymbols.find(
					s =>
						s.name === symbolName &&
						(s.type === 'function' ||
							s.type === 'class' ||
							s.type === 'variable'),
				);
				if (symbol) return symbol;
			}
		}

		// Search in all files
		for (const fileSymbols of this.indexCache.values()) {
			const symbol = fileSymbols.find(
				s =>
					s.name === symbolName &&
					(s.type === 'function' ||
						s.type === 'class' ||
						s.type === 'variable'),
			);
			if (symbol) return symbol;
		}

		return null;
	}

	/**
	 * Expand glob patterns with braces like "*.{ts,tsx}" into multiple patterns
	 */
	private expandGlobBraces(glob: string): string[] {
		// Match {a,b,c} pattern
		const braceMatch = glob.match(/^(.+)\{([^}]+)\}(.*)$/);
		if (!braceMatch || !braceMatch[1] || !braceMatch[2] || braceMatch[3] === undefined) {
			return [glob];
		}

		const prefix = braceMatch[1];
		const alternatives = braceMatch[2].split(',');
		const suffix = braceMatch[3];

		return alternatives.map(alt => `${prefix}${alt}${suffix}`);
	}

	/**
	 * Strategy 1: Use git grep for fast searching in Git repositories
	 */
	private async gitGrepSearch(
		pattern: string,
		fileGlob?: string,
		maxResults: number = 100,
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		return new Promise((resolve, reject) => {
			const args = [
				'grep',
				'--untracked',
				'-n',
				'-E',
				'--ignore-case',
				pattern,
			];

			if (fileGlob) {
				// Expand glob patterns with braces (e.g., "source/**/*.{ts,tsx}" -> ["source/**/*.ts", "source/**/*.tsx"])
				const expandedGlobs = this.expandGlobBraces(fileGlob);
				args.push('--', ...expandedGlobs);
			}

			const child = spawn('git', args, {
				cwd: this.basePath,
				windowsHide: true,
			});

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];

			child.stdout.on('data', chunk => stdoutChunks.push(chunk));
			child.stderr.on('data', chunk => stderrChunks.push(chunk));

			child.on('error', err => {
				reject(new Error(`Failed to start git grep: ${err.message}`));
			});

			child.on('close', code => {
				const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
				const stderrData = Buffer.concat(stderrChunks).toString('utf8').trim();

				if (code === 0) {
					const results = parseGrepOutput(stdoutData, this.basePath);
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
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		// Prefer ripgrep (rg) over grep if available
		const grepCommand = (await isCommandAvailable('rg')) ? 'rg' : 'grep';
		const isRipgrep = grepCommand === 'rg';

		return new Promise((resolve, reject) => {
			const args = isRipgrep
				? ['-n', '-i', '--no-heading', pattern]
				: ['-r', '-n', '-H', '-E', '-i'];

			// Add exclusion patterns
			const excludeDirs = [
				'node_modules',
				'.git',
				'dist',
				'build',
				'__pycache__',
				'target',
				'.next',
				'.nuxt',
				'coverage',
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

			child.stdout.on('data', chunk => stdoutChunks.push(chunk));
			child.stderr.on('data', chunk => {
				const stderrStr = chunk.toString();
				// Suppress common harmless stderr messages
				if (
					!stderrStr.includes('Permission denied') &&
					!/grep:.*: Is a directory/i.test(stderrStr)
				) {
					stderrChunks.push(chunk);
				}
			});

			child.on('error', err => {
				reject(new Error(`Failed to start ${grepCommand}: ${err.message}`));
			});

			child.on('close', code => {
				const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
				const stderrData = Buffer.concat(stderrChunks).toString('utf8').trim();

				if (code === 0) {
					const results = parseGrepOutput(stdoutData, this.basePath);
					resolve(results.slice(0, maxResults));
				} else if (code === 1) {
					// No matches found
					resolve([]);
				} else if (stderrData) {
					reject(
						new Error(`${grepCommand} exited with code ${code}: ${stderrData}`),
					);
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
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		const results: Array<{
			filePath: string;
			line: number;
			column: number;
			content: string;
		}> = [];

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
		const globRegex = fileGlob ? globToRegex(fileGlob) : null;

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
							'.jpg',
							'.jpeg',
							'.png',
							'.gif',
							'.bmp',
							'.ico',
							'.svg',
							'.pdf',
							'.zip',
							'.tar',
							'.gz',
							'.rar',
							'.7z',
							'.exe',
							'.dll',
							'.so',
							'.dylib',
							'.mp3',
							'.mp4',
							'.avi',
							'.mov',
							'.woff',
							'.woff2',
							'.ttf',
							'.eot',
							'.class',
							'.jar',
							'.war',
							'.o',
							'.a',
							'.lib',
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
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		// Strategy 1: Try git grep first
		if (await this.isGitRepository()) {
			try {
				const gitAvailable = await isCommandAvailable('git');
				if (gitAvailable) {
					const results = await this.gitGrepSearch(
						pattern,
						fileGlob,
						maxResults,
					);
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
			const grepAvailable =
				(await isCommandAvailable('rg')) || (await isCommandAvailable('grep'));
			if (grepAvailable) {
				const results = await this.systemGrepSearch(
					pattern,
					fileGlob,
					maxResults,
				);
				return await this.sortResultsByRecency(results);
			}
		} catch (error) {
			// Fall through to JavaScript fallback
			//console.debug('system grep failed, falling back to JavaScript search');
		}

		// Strategy 3: JavaScript fallback (always works)
		const results = await this.jsTextSearch(
			pattern,
			fileGlob,
			isRegex,
			maxResults,
		);
		return await this.sortResultsByRecency(results);
	}

	/**
	 * Sort search results by file modification time (recent files first)
	 * Files modified within last 24 hours are prioritized
	 */
	private async sortResultsByRecency(
		results: Array<{
			filePath: string;
			line: number;
			column: number;
			content: string;
		}>,
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
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

			const aIsRecent = now - aMtime < recentThreshold;
			const bIsRecent = now - bMtime < recentThreshold;

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
	 * Get code outline for a file (all symbols in the file)
	 */
	async getFileOutline(filePath: string): Promise<CodeSymbol[]> {
		const fullPath = path.resolve(this.basePath, filePath);

		try {
			const content = await fs.readFile(fullPath, 'utf-8');
			return await parseFileSymbols(fullPath, content, this.basePath);
		} catch (error) {
			throw new Error(
				`Failed to get outline for ${filePath}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
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
		const symbolResults = await this.searchSymbols(
			query,
			undefined,
			language,
			maxResults,
		);

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
			filteredSymbols = symbolResults.symbols.filter(
				s =>
					s.type === 'function' || s.type === 'class' || s.type === 'interface',
			);
		} else if (searchType === 'usage') {
			filteredSymbols = [];
		} else if (searchType === 'implementation') {
			filteredSymbols = symbolResults.symbols.filter(
				s => s.type === 'function' || s.type === 'method' || s.type === 'class',
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
		this.allIndexedFiles.clear();
		this.fileContentCache.clear();
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
				languageBreakdown[symbol.language] =
					(languageBreakdown[symbol.language] || 0) + 1;
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
		name: 'ace-search_symbols',
		description:
			'ACE Code Search: Intelligent symbol search across the codebase. Finds functions, classes, variables, and other code symbols with fuzzy matching. Supports multiple programming languages (TypeScript, JavaScript, Python, Go, Rust, Java, C#). Returns precise file locations with line numbers and context.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Symbol name to search for (supports fuzzy matching, e.g., "gfc" can match "getFileContent")',
				},
				symbolType: {
					type: 'string',
					enum: [
						'function',
						'class',
						'method',
						'variable',
						'constant',
						'interface',
						'type',
						'enum',
						'import',
						'export',
					],
					description: 'Filter by specific symbol type (optional)',
				},
				language: {
					type: 'string',
					enum: [
						'typescript',
						'javascript',
						'python',
						'go',
						'rust',
						'java',
						'csharp',
					],
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
		name: 'ace-find_definition',
		description:
			'ACE Code Search: Find the definition of a symbol (Go to Definition). Locates where a function, class, or variable is defined in the codebase. Returns precise location with full signature and context.',
		inputSchema: {
			type: 'object',
			properties: {
				symbolName: {
					type: 'string',
					description: 'Name of the symbol to find definition for',
				},
				contextFile: {
					type: 'string',
					description:
						'Current file path for context-aware search (optional, searches current file first)',
				},
			},
			required: ['symbolName'],
		},
	},
	{
		name: 'ace-find_references',
		description:
			'ACE Code Search: Find all references to a symbol (Find All References). Shows where a function, class, or variable is used throughout the codebase. Categorizes references as definition, usage, import, or type reference.',
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
		name: 'ace-semantic_search',
		description:
			'ACE Code Search: Advanced semantic search with context understanding. Searches for symbols with intelligent filtering by search type (definition, usage, implementation, all). Combines symbol search with cross-reference analysis.',
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
					description:
						'Type of search: definition (find declarations), usage (find usages), implementation (find implementations), all (comprehensive search)',
					default: 'all',
				},
				language: {
					type: 'string',
					enum: [
						'typescript',
						'javascript',
						'python',
						'go',
						'rust',
						'java',
						'csharp',
					],
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
		name: 'ace-file_outline',
		description:
			"ACE Code Search: Get complete code outline for a file. Shows all functions, classes, variables, and other symbols defined in the file with their locations. Similar to VS Code's outline view.",
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description:
						'Path to the file to get outline for (relative to workspace root)',
				},
			},
			required: ['filePath'],
		},
	},
	{
		name: 'ace-text_search',
		description:
			'ACE Code Search: Fast text search across the entire codebase using Node.js built-in features (no external dependencies required). Search for exact patterns or regex across all files. Useful for finding strings, comments, TODOs, or any text patterns. Supports glob filtering.',
		inputSchema: {
			type: 'object',
			properties: {
				pattern: {
					type: 'string',
					description:
						'Text pattern or regex to search for (e.g., "TODO:", "import.*from", "throw new Error")',
				},
				fileGlob: {
					type: 'string',
					description:
						'Glob pattern to filter files (e.g., "*.ts" for TypeScript only, "**/*.{js,ts}" for JS and TS, "src/**/*.py" for Python in src)',
				},
				isRegex: {
					type: 'boolean',
					description:
						'Whether the pattern is a regular expression (default: false for literal text search)',
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
		name: 'ace-index_stats',
		description:
			'ACE Code Search: Get statistics about the code index. Shows number of indexed files, symbols, language breakdown, and cache status. Useful for understanding search coverage.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	{
		name: 'ace-clear_cache',
		description:
			'ACE Code Search: Clear the symbol index cache and force a full re-index on next search. Use when codebase has changed significantly or search results seem stale.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
];
