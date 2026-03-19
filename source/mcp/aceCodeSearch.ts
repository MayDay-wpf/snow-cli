//Autonomous Coding Engine
import {promises as fs, createReadStream} from 'fs';
import * as path from 'path';
import {spawn} from 'child_process';
import {createInterface} from 'readline';
import {type FzfResultItem, Fzf} from 'fzf';
import {processManager} from '../utils/core/processManager.js';
import {logger} from '../utils/core/logger.js';
// SSH support for remote file operations
import {SSHClient, parseSSHUrl} from '../utils/ssh/sshClient.js';
import {
	getWorkingDirectories,
	type SSHConfig,
} from '../utils/config/workingDirConfig.js';
// Type definitions
import type {
	CodeSymbol,
	CodeReference,
	SemanticSearchResult,
	SymbolType,
} from './types/aceCodeSearch.types.js';
// Utility functions
import {detectLanguage} from './utils/aceCodeSearch/language.utils.js';
import {
	loadExclusionPatterns,
	shouldExcludeDirectory,
	shouldExcludeFile,
	readFileWithCache,
} from './utils/aceCodeSearch/filesystem.utils.js';
import {
	parseFileSymbols,
	getContext,
} from './utils/aceCodeSearch/symbol.utils.js';
import {
	isCommandAvailable,
	parseGrepOutput,
	expandGlobBraces,
	isSafeRegexPattern,
	processWithConcurrency,
} from './utils/aceCodeSearch/search.utils.js';
import {
	INDEX_CACHE_DURATION,
	BATCH_SIZE,
	BINARY_EXTENSIONS,
	GREP_EXCLUDE_DIRS,
	MAX_INDEXED_FILES,
	MAX_SYMBOLS_PER_FILE,
	MAX_FZF_SYMBOL_NAMES,
	LARGE_FILE_THRESHOLD,
	FILE_READ_CHUNK_SIZE,
	TEXT_SEARCH_TIMEOUT_MS,
	MAX_CONCURRENT_FILE_READS,
	MAX_REGEX_COMPLEXITY_SCORE,
	RECENT_FILE_THRESHOLD,
	MAX_FILE_STAT_CACHE_SIZE,
	ACE_IDLE_CLEANUP_MS,
} from './utils/aceCodeSearch/constants.utils.js';

export class ACECodeSearchService {
	private basePath: string;
	private indexCache: Map<string, CodeSymbol[]> = new Map();
	private lastIndexTime: number = 0;
	private fzfIndex: Fzf<string[]> | undefined;
	private allIndexedFiles: Set<string> = new Set(); // 使用 Set 提高查找性能 O(1)
	private fileModTimes: Map<string, number> = new Map(); // Track file modification times
	private customExcludes: string[] = []; // Custom exclusion patterns from config files
	private excludesLoaded: boolean = false; // Track if exclusions have been loaded
	private isIndexTruncated: boolean = false;

	// Serialize index rebuilds across concurrent/re-entrant tool calls
	private indexBuildQueue: Promise<void> = Promise.resolve();

	// 文件内容缓存（用于减少重复读取）
	private fileContentCache: Map<string, {content: string; mtime: number}> =
		new Map();
	// 正则表达式缓存（用于 shouldExcludeDirectory）
	private regexCache: Map<string, RegExp> = new Map();

	// 命令可用性缓存（避免重复 spawn which 进程）
	private commandAvailabilityCache: Map<string, boolean> = new Map();
	// Git 仓库状态缓存
	private isGitRepoCache: boolean | null = null;
	// 文件修改时间缓存（用于 sortResultsByRecency）
	private fileStatCache: Map<string, {mtimeMs: number; cachedAt: number}> =
		new Map();
	private static readonly STAT_CACHE_TTL = 60 * 1000; // 60秒过期
	private idleCleanupTimer: NodeJS.Timeout | undefined;
	private isDisposed = false;
	private readonly idleCleanupMs: number;

	constructor(
		basePath: string = process.cwd(),
		options?: {idleCleanupMs?: number},
	) {
		this.basePath = path.resolve(basePath);
		this.idleCleanupMs = options?.idleCleanupMs ?? ACE_IDLE_CLEANUP_MS;
		this.scheduleIdleCleanup();
	}

	private async withIndexBuildLock<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.indexBuildQueue.then(fn, fn);
		this.indexBuildQueue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	private markIndexTruncated(message: string): void {
		if (!this.isIndexTruncated) {
			logger.warn(message);
		}

		this.isIndexTruncated = true;
	}

	private ensureNotDisposed(): void {
		if (this.isDisposed) {
			throw new Error('ACECodeSearchService has been disposed');
		}
	}

	private scheduleIdleCleanup(): void {
		if (this.isDisposed || this.idleCleanupMs <= 0) {
			return;
		}

		if (this.idleCleanupTimer) {
			clearTimeout(this.idleCleanupTimer);
		}

		this.idleCleanupTimer = setTimeout(() => {
			if (this.isDisposed) {
				return;
			}

			logger.debug(
				`ACECodeSearchService idle cleanup triggered for ${this.basePath}`,
			);
			this.clearCaches({preserveExclusions: true, preserveCommandCache: true});
		}, this.idleCleanupMs);
		this.idleCleanupTimer.unref?.();
	}

	private markActivity(): void {
		this.ensureNotDisposed();
		this.scheduleIdleCleanup();
	}

	private trimFileStatCache(): void {
		const overflow = this.fileStatCache.size - MAX_FILE_STAT_CACHE_SIZE;
		if (overflow <= 0) {
			return;
		}

		const entries = Array.from(this.fileStatCache.entries()).sort(
			(a, b) => a[1].cachedAt - b[1].cachedAt,
		);
		for (let i = 0; i < overflow; i++) {
			const filePath = entries[i]?.[0];
			if (filePath) {
				this.fileStatCache.delete(filePath);
			}
		}
	}

	private clearCaches(options?: {
		preserveExclusions?: boolean;
		preserveCommandCache?: boolean;
	}): void {
		this.indexCache.clear();
		this.fileModTimes.clear();
		this.allIndexedFiles.clear();
		this.fileContentCache.clear();
		this.fileStatCache.clear();
		this.fzfIndex = undefined;
		this.lastIndexTime = 0;
		this.isIndexTruncated = false;
		this.indexBuildQueue = Promise.resolve();

		if (!options?.preserveExclusions) {
			this.customExcludes = [];
			this.excludesLoaded = false;
			this.regexCache.clear();
		}

		if (!options?.preserveCommandCache) {
			this.commandAvailabilityCache.clear();
			this.isGitRepoCache = null;
		}
	}

	dispose(): void {
		if (this.idleCleanupTimer) {
			clearTimeout(this.idleCleanupTimer);
			this.idleCleanupTimer = undefined;
		}

		this.clearCaches();
		this.isDisposed = true;
	}

	/**
	 * Check if a path is a remote SSH URL
	 * @param filePath - Path to check
	 * @returns True if the path is an SSH URL
	 */
	private isSSHPath(filePath: string): boolean {
		return filePath.startsWith('ssh://');
	}

	/**
	 * Get SSH config for a remote path from working directories
	 * @param sshUrl - SSH URL to find config for
	 * @returns SSH config if found, null otherwise
	 */
	private async getSSHConfigForPath(sshUrl: string): Promise<SSHConfig | null> {
		const workingDirs = await getWorkingDirectories();
		for (const dir of workingDirs) {
			if (dir.isRemote && dir.sshConfig && sshUrl.startsWith(dir.path)) {
				return dir.sshConfig;
			}
		}
		// Try to match by host/user
		const parsed = parseSSHUrl(sshUrl);
		if (parsed) {
			for (const dir of workingDirs) {
				if (dir.isRemote && dir.sshConfig) {
					const dirParsed = parseSSHUrl(dir.path);
					if (
						dirParsed &&
						dirParsed.host === parsed.host &&
						dirParsed.username === parsed.username &&
						dirParsed.port === parsed.port
					) {
						return dir.sshConfig;
					}
				}
			}
		}
		return null;
	}

	/**
	 * Read file content from remote SSH server
	 * @param sshUrl - SSH URL of the file
	 * @returns File content as string
	 */
	private async readRemoteFile(sshUrl: string): Promise<string> {
		const parsed = parseSSHUrl(sshUrl);
		if (!parsed) {
			throw new Error(`Invalid SSH URL: ${sshUrl}`);
		}

		const sshConfig = await this.getSSHConfigForPath(sshUrl);
		if (!sshConfig) {
			throw new Error(`No SSH configuration found for: ${sshUrl}`);
		}

		const client = new SSHClient();
		const connectResult = await client.connect(sshConfig);
		if (!connectResult.success) {
			throw new Error(`SSH connection failed: ${connectResult.error}`);
		}

		try {
			const content = await client.readFile(parsed.path);
			return content;
		} finally {
			client.disconnect();
		}
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
	 * Check if a command is available (with caching)
	 */
	private async isCommandAvailableCached(command: string): Promise<boolean> {
		const cached = this.commandAvailabilityCache.get(command);
		if (cached !== undefined) {
			return cached;
		}
		const available = await isCommandAvailable(command);
		this.commandAvailabilityCache.set(command, available);
		return available;
	}

	/**
	 * Check if a directory is a Git repository (with caching)
	 */
	private async isGitRepository(
		directory: string = this.basePath,
	): Promise<boolean> {
		// Only cache for basePath
		if (directory === this.basePath && this.isGitRepoCache !== null) {
			return this.isGitRepoCache;
		}
		try {
			const gitDir = path.join(directory, '.git');
			const stats = await fs.stat(gitDir);
			const isRepo = stats.isDirectory();
			if (directory === this.basePath) {
				this.isGitRepoCache = isRepo;
			}
			return isRepo;
		} catch {
			if (directory === this.basePath) {
				this.isGitRepoCache = false;
			}
			return false;
		}
	}

	/**
	 * Build or refresh the code symbol index with incremental updates
	 */
	private async buildIndex(forceRefresh: boolean = false): Promise<void> {
		this.markActivity();

		return this.withIndexBuildLock(async () => {
			const now = Date.now();

			// Use cache if available and not expired
			if (
				!forceRefresh &&
				this.indexCache.size > 0 &&
				now - this.lastIndexTime < INDEX_CACHE_DURATION
			) {
				return;
			}

			// Load exclusion patterns
			await this.loadExclusionPatterns();

			// For force refresh, clear everything
			if (forceRefresh) {
				this.clearCaches({
					preserveExclusions: true,
					preserveCommandCache: true,
				});
			}

			const filesToProcess: string[] = [];

			const searchInDirectory = async (dirPath: string): Promise<void> => {
				try {
					const entries = await fs.readdir(dirPath, {withFileTypes: true});

					for (const entry of entries) {
						const fullPath = path.join(dirPath, entry.name);

						if (entry.isDirectory()) {
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
							continue;
						}

						if (!entry.isFile()) {
							continue;
						}

						const language = detectLanguage(fullPath);
						if (!language) {
							continue;
						}

						const isAlreadyIndexed = this.allIndexedFiles.has(fullPath);
						if (
							!isAlreadyIndexed &&
							this.allIndexedFiles.size >= MAX_INDEXED_FILES
						) {
							this.markIndexTruncated(
								`ACE symbol index reached the ${MAX_INDEXED_FILES} file safety limit; skipping remaining files to avoid excessive memory usage`,
							);
							continue;
						}

						try {
							const stats = await fs.stat(fullPath);
							const currentMtime = stats.mtimeMs;
							const cachedMtime = this.fileModTimes.get(fullPath);

							if (cachedMtime === undefined || currentMtime > cachedMtime) {
								filesToProcess.push(fullPath);
								this.fileModTimes.set(fullPath, currentMtime);
							}

							this.allIndexedFiles.add(fullPath);
						} catch {
							// If we can't stat the file, skip it
						}
					}
				} catch {
					// Skip directories that cannot be accessed
				}
			};

			await searchInDirectory(this.basePath);

			const batches: string[][] = [];
			for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
				batches.push(filesToProcess.slice(i, i + BATCH_SIZE));
			}

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
								{
									includeContext: false,
									includeSignature: false,
									maxSymbols: MAX_SYMBOLS_PER_FILE,
								},
							);

							if (symbols.length >= MAX_SYMBOLS_PER_FILE) {
								this.markIndexTruncated(
									`ACE symbol index capped files at ${MAX_SYMBOLS_PER_FILE} symbols each to avoid excessive memory usage`,
								);
							}

							if (symbols.length > 0) {
								this.indexCache.set(fullPath, symbols);
							} else {
								this.indexCache.delete(fullPath);
							}
						} catch {
							this.indexCache.delete(fullPath);
							this.fileModTimes.delete(fullPath);
							this.fileContentCache.delete(fullPath);
						}
					}),
				);
			}

			for (const cachedPath of Array.from(this.indexCache.keys())) {
				try {
					await fs.access(cachedPath);
				} catch {
					this.indexCache.delete(cachedPath);
					this.fileModTimes.delete(cachedPath);
					this.allIndexedFiles.delete(cachedPath);
					this.fileContentCache.delete(cachedPath);
				}
			}

			this.lastIndexTime = now;

			if (filesToProcess.length > 0 || forceRefresh) {
				this.buildFzfIndex();
			}
		});
	}

	/**
	 * Build fzf index for fast fuzzy symbol name matching
	 */
	private buildFzfIndex(): void {
		const uniqueNames = new Set<string>();

		for (const fileSymbols of this.indexCache.values()) {
			for (const symbol of fileSymbols) {
				uniqueNames.add(symbol.name);
				if (uniqueNames.size > MAX_FZF_SYMBOL_NAMES) {
					this.fzfIndex = undefined;
					this.markIndexTruncated(
						`ACE fuzzy index exceeded ${MAX_FZF_SYMBOL_NAMES} unique symbol names; falling back to manual scoring to keep memory bounded`,
					);
					return;
				}
			}
		}

		const symbolNames = Array.from(uniqueNames);
		const fuzzyAlgorithm = symbolNames.length > 20000 ? 'v1' : 'v2';

		// Use sync Fzf to avoid AsyncFzf cancellation/race issues under concurrent tool calls
		this.fzfIndex = new Fzf(symbolNames, {
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
		this.markActivity();
		const startTime = Date.now();
		await this.buildIndex();
		await this.indexBuildQueue;

		const symbols: CodeSymbol[] = [];

		// Use fzf for fuzzy matching if available
		if (this.fzfIndex) {
			try {
				// Get fuzzy matches from fzf
				const fzfResults = this.fzfIndex.find(query);

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
				logger.info(
					`fzf search failed, falling back to manual scoring: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
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
		this.markActivity();
		const references: CodeReference[] = [];

		// Load exclusion patterns
		await this.loadExclusionPatterns();

		// Escape special regex characters to prevent ReDoS
		const escapedSymbol = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		// 使用标记来控制递归提前终止
		let shouldStop = false;

		const searchInDirectory = async (dirPath: string): Promise<void> => {
			// 提前终止检查
			if (shouldStop || references.length >= maxResults) {
				shouldStop = true;
				return;
			}

			try {
				const entries = await fs.readdir(dirPath, {withFileTypes: true});

				for (const entry of entries) {
					// 每次循环都检查是否应该停止
					if (shouldStop || references.length >= maxResults) {
						shouldStop = true;
						return;
					}

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
						// 使用配置化的文件排除检查（支持 .gitignore/.snowignore）
						if (
							shouldExcludeFile(
								entry.name,
								fullPath,
								this.basePath,
								this.customExcludes,
								this.regexCache,
							)
						) {
							continue;
						}

						const language = detectLanguage(fullPath);
						if (language) {
							try {
								// 使用缓存读取文件（避免重复读取）
								const content = await readFileWithCache(
									fullPath,
									this.fileContentCache,
								);
								const lines = content.split('\n');

								// Search for symbol usage with escaped symbol name
								const regex = new RegExp(`\\b${escapedSymbol}\\b`, 'g');

								for (let i = 0; i < lines.length; i++) {
									// 内层循环也检查限制
									if (references.length >= maxResults) {
										shouldStop = true;
										return;
									}

									const line = lines[i];
									if (!line) continue;

									// Reset regex for each line
									regex.lastIndex = 0;
									let match;

									while ((match = regex.exec(line)) !== null) {
										// 每找到一个匹配都检查
										if (references.length >= maxResults) {
											shouldStop = true;
											return;
										}

										// Determine reference type
										let referenceType: CodeReference['referenceType'] = 'usage';
										if (line.includes('import') && line.includes(symbolName)) {
											referenceType = 'import';
										} else if (
											new RegExp(
												`(?:function|class|const|let|var)\\s+${escapedSymbol}`,
											).test(line)
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
		this.markActivity();
		await this.buildIndex();
		await this.indexBuildQueue;

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
	 * Strategy 1: Use git grep for fast searching in Git repositories
	 * Enhanced with timeout protection to prevent hanging
	 */
	private async gitGrepSearch(
		pattern: string,
		fileGlob?: string,
		maxResults: number = 100,
		isRegex: boolean = true,
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		this.markActivity();
		const timeoutMs = 15000;

		return new Promise((resolve, reject) => {
			const args = ['grep', '--untracked', '-n', '--ignore-case'];

			if (isRegex) {
				args.push('-E');
			} else {
				args.push('--fixed-strings');
			}

			args.push(pattern);

			if (fileGlob) {
				let gitGlob = fileGlob.replace(/\\/g, '/');
				gitGlob = gitGlob.replace(/\*\*/g, '*');
				const expandedGlobs = expandGlobBraces(gitGlob);
				args.push('--', ...expandedGlobs);
			}

			const child = spawn('git', args, {
				cwd: this.basePath,
				windowsHide: true,
			});
			processManager.register(child);

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			let isCompleted = false;

			const finalize = (
				handler: () => void,
				killProcess: boolean = false,
			): void => {
				if (isCompleted) {
					return;
				}

				isCompleted = true;
				clearTimeout(timeoutId);
				child.stdout.removeAllListeners();
				child.stderr.removeAllListeners();
				child.removeAllListeners('error');
				child.removeAllListeners('close');

				if (killProcess && !child.killed) {
					child.kill('SIGTERM');
				}

				handler();
				stdoutChunks.length = 0;
				stderrChunks.length = 0;
			};

			const timeoutId = setTimeout(() => {
				finalize(() => {
					logger.warn(
						`git grep timed out after ${timeoutMs}ms, killing process`,
					);
					reject(new Error(`git grep timed out after ${timeoutMs}ms`));
				}, true);
			}, timeoutMs);
			timeoutId.unref?.();

			child.stdout.on('data', chunk => stdoutChunks.push(chunk));
			child.stderr.on('data', chunk => stderrChunks.push(chunk));

			child.once('error', err => {
				finalize(() => {
					reject(new Error(`Failed to start git grep: ${err.message}`));
				});
			});

			child.once('close', code => {
				const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
				const stderrData = Buffer.concat(stderrChunks).toString('utf8').trim();

				finalize(() => {
					if (code === 0) {
						const results = parseGrepOutput(stdoutData, this.basePath);
						resolve(results.slice(0, maxResults));
					} else if (code === 1) {
						resolve([]);
					} else {
						reject(
							new Error(`git grep exited with code ${code}: ${stderrData}`),
						);
					}
				});
			});
		});
	}

	/**
	 * Strategy 2: Use system grep (or ripgrep if available) for fast searching
	 * Enhanced with timeout protection to prevent hanging on Windows
	 */
	private async systemGrepSearch(
		pattern: string,
		fileGlob?: string,
		maxResults: number = 100,
		grepCommand: 'rg' | 'grep' = 'grep',
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		this.markActivity();
		const isRipgrep = grepCommand === 'rg';
		const timeoutMs = 15000;

		return new Promise((resolve, reject) => {
			const args = isRipgrep
				? ['-n', '-i', '--no-heading']
				: ['-r', '-n', '-H', '-E', '-i'];

			if (isRipgrep) {
				GREP_EXCLUDE_DIRS.forEach(dir => args.push('--glob', `!${dir}/`));
				if (fileGlob) {
					const normalizedGlob = fileGlob.replace(/\\/g, '/');
					const expandedGlobs = expandGlobBraces(normalizedGlob);
					expandedGlobs.forEach(glob => args.push('--glob', glob));
				}
			} else {
				GREP_EXCLUDE_DIRS.forEach(dir => args.push(`--exclude-dir=${dir}`));
				if (fileGlob) {
					const normalizedGlob = fileGlob.replace(/\\/g, '/');
					const expandedGlobs = expandGlobBraces(normalizedGlob);
					expandedGlobs.forEach(glob => args.push(`--include=${glob}`));
				}
			}
			args.push(pattern, '.');

			const child = spawn(grepCommand, args, {
				cwd: this.basePath,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			processManager.register(child);

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			let isCompleted = false;

			const finalize = (
				handler: () => void,
				killProcess: boolean = false,
			): void => {
				if (isCompleted) {
					return;
				}

				isCompleted = true;
				clearTimeout(timeoutId);
				child.stdout.removeAllListeners();
				child.stderr.removeAllListeners();
				child.removeAllListeners('error');
				child.removeAllListeners('close');

				if (killProcess && !child.killed) {
					child.kill('SIGTERM');
				}

				handler();
				stdoutChunks.length = 0;
				stderrChunks.length = 0;
			};

			const timeoutId = setTimeout(() => {
				finalize(() => {
					logger.warn(
						`${grepCommand} timed out after ${timeoutMs}ms, killing process`,
					);
					reject(new Error(`${grepCommand} timed out after ${timeoutMs}ms`));
				}, true);
			}, timeoutMs);
			timeoutId.unref?.();

			child.stdout.on('data', chunk => stdoutChunks.push(chunk));
			child.stderr.on('data', chunk => {
				const stderrStr = chunk.toString();
				if (
					!stderrStr.includes('Permission denied') &&
					!/grep:.*: Is a directory/i.test(stderrStr)
				) {
					stderrChunks.push(chunk);
				}
			});

			child.once('error', err => {
				finalize(() => {
					reject(new Error(`Failed to start ${grepCommand}: ${err.message}`));
				});
			});

			child.once('close', code => {
				const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
				const stderrData = Buffer.concat(stderrChunks).toString('utf8').trim();

				finalize(() => {
					if (code === 0) {
						const results = parseGrepOutput(stdoutData, this.basePath);
						resolve(results.slice(0, maxResults));
					} else if (code === 1) {
						resolve([]);
					} else if (stderrData) {
						reject(
							new Error(
								`${grepCommand} exited with code ${code}: ${stderrData}`,
							),
						);
					} else {
						resolve([]);
					}
				});
			});
		});
	}

	/**
	 * Convert a glob pattern to a RegExp that matches full paths
	 * Supports: *, **, ?, {a,b}, [abc]
	 */
	private globPatternToRegex(globPattern: string): RegExp {
		// Normalize path separators
		const normalizedGlob = globPattern.replace(/\\/g, '/');

		// First, temporarily replace glob special patterns with placeholders
		// to prevent them from being escaped
		let regexStr = normalizedGlob
			.replace(/\*\*/g, '\x00DOUBLESTAR\x00') // ** -> placeholder
			.replace(/\*/g, '\x00STAR\x00') // * -> placeholder
			.replace(/\?/g, '\x00QUESTION\x00'); // ? -> placeholder

		// Now escape all special regex characters
		regexStr = regexStr.replace(/[.+^${}()|[\]\\]/g, '\\$&');

		// Replace placeholders with actual regex patterns
		regexStr = regexStr
			.replace(/\x00DOUBLESTAR\x00/g, '.*') // ** -> .* (match any path segments)
			.replace(/\x00STAR\x00/g, '[^/]*') // * -> [^/]* (match within single segment)
			.replace(/\x00QUESTION\x00/g, '.'); // ? -> . (match single character)

		return new RegExp(regexStr, 'i');
	}

	/**
	 * Strategy 3: Pure JavaScript fallback search
	 * Enhanced with performance protections:
	 * - File size limits (skip files > 5MB)
	 * - Timeout protection (30s max)
	 * - ReDoS protection (regex complexity check)
	 * - Concurrent read limiting
	 */
	private async jsTextSearch(
		pattern: string,
		fileGlob?: string,
		isRegex: boolean = true,
		maxResults: number = 100,
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		this.markActivity();
		const results: Array<{
			filePath: string;
			line: number;
			column: number;
			content: string;
		}> = [];

		// Track if search should be aborted
		let isAborted = false;
		const startTime = Date.now();

		// Check timeout periodically
		const checkTimeout = (): void => {
			if (Date.now() - startTime > TEXT_SEARCH_TIMEOUT_MS) {
				isAborted = true;
				logger.warn(`Text search timeout after ${TEXT_SEARCH_TIMEOUT_MS}ms`);
			}
		};

		// Load exclusion patterns
		await this.loadExclusionPatterns();

		// Compile search pattern with ReDoS protection
		let searchRegex: RegExp;
		try {
			if (isRegex) {
				// Check for ReDoS vulnerabilities
				const safety = isSafeRegexPattern(pattern, MAX_REGEX_COMPLEXITY_SCORE);
				if (!safety.isSafe) {
					throw new Error(`Potentially unsafe regex pattern: ${safety.reason}`);
				}
				searchRegex = new RegExp(pattern, 'gi');
			} else {
				// Escape special regex characters for literal search
				const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				searchRegex = new RegExp(escaped, 'gi');
			}
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`Invalid regex pattern: ${pattern}`);
		}

		// Parse glob pattern if provided using improved glob parser
		const globRegex = fileGlob ? this.globPatternToRegex(fileGlob) : null;

		// Collect all files to search first
		interface FileToSearch {
			fullPath: string;
			relativePath: string;
		}
		const filesToSearch: FileToSearch[] = [];

		// Search recursively to collect files
		const collectFiles = async (dirPath: string): Promise<void> => {
			if (isAborted || filesToSearch.length >= maxResults * 10) return;
			checkTimeout();

			try {
				const entries = await fs.readdir(dirPath, {withFileTypes: true});

				for (const entry of entries) {
					if (isAborted || filesToSearch.length >= maxResults * 10) break;

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
						await collectFiles(fullPath);
					} else if (entry.isFile()) {
						// Filter by glob if specified
						const relativePath = path
							.relative(this.basePath, fullPath)
							.replace(/\\/g, '/');

						if (globRegex && !globRegex.test(relativePath)) {
							continue;
						}

						// Skip binary files (using Set for fast lookup)
						const ext = path.extname(entry.name).toLowerCase();
						if (BINARY_EXTENSIONS.has(ext)) {
							continue;
						}

						filesToSearch.push({fullPath, relativePath});
					}
				}
			} catch (error) {
				// Skip directories that cannot be accessed
			}
		};

		await collectFiles(this.basePath);

		// Process files with limited concurrency
		const processFile = async (fileInfo: FileToSearch): Promise<void> => {
			if (isAborted || results.length >= maxResults) return;
			checkTimeout();

			try {
				// Check file size to decide reading strategy
				const stats = await fs.stat(fileInfo.fullPath);

				if (stats.size <= LARGE_FILE_THRESHOLD) {
					// Small file: read entirely for better performance
					const content = await fs.readFile(fileInfo.fullPath, 'utf-8');
					const lines = content.split('\n');

					for (let i = 0; i < lines.length; i++) {
						if (isAborted || results.length >= maxResults) break;

						const line = lines[i];
						if (!line) continue;

						// Reset regex for each line
						searchRegex.lastIndex = 0;
						const match = searchRegex.exec(line);

						if (match) {
							results.push({
								filePath: fileInfo.relativePath,
								line: i + 1,
								column: match.index + 1,
								content: line.trim(),
							});
						}
					}
				} else {
					// Large file: use streaming to control memory
					logger.info(
						`Streaming large file (${stats.size} bytes): ${fileInfo.relativePath}`,
					);
					await this.searchInLargeFile(
						fileInfo,
						searchRegex,
						results,
						maxResults,
						() => isAborted,
					);
				}
			} catch (error) {
				// Skip files that cannot be read (binary, permissions, etc.)
			}
		};

		// Process files with concurrency limit
		await processWithConcurrency(
			filesToSearch,
			processFile,
			MAX_CONCURRENT_FILE_READS,
		);

		if (isAborted) {
			logger.warn(
				`Text search aborted after ${Date.now() - startTime}ms, returning ${
					results.length
				} partial results`,
			);
		}

		return results;
	}

	/**
	 * Search within a large file using streaming to control memory usage.
	 * Processes the file line by line without loading entire content into memory.
	 */
	private async searchInLargeFile(
		fileInfo: {fullPath: string; relativePath: string},
		searchRegex: RegExp,
		results: Array<{
			filePath: string;
			line: number;
			column: number;
			content: string;
		}>,
		maxResults: number,
		isAborted: () => boolean,
	): Promise<void> {
		this.markActivity();

		return new Promise(resolve => {
			const stream = createReadStream(fileInfo.fullPath, {
				highWaterMark: FILE_READ_CHUNK_SIZE,
				encoding: 'utf-8',
			});

			const rl = createInterface({
				input: stream,
				crlfDelay: Infinity,
			});

			let lineNumber = 0;
			let isResolved = false;

			const finalize = (): void => {
				if (isResolved) {
					return;
				}

				isResolved = true;
				rl.removeAllListeners();
				stream.removeAllListeners();
				stream.destroy();
				resolve();
			};

			rl.on('line', (line: string) => {
				if (isAborted() || results.length >= maxResults) {
					rl.close();
					return;
				}

				lineNumber++;
				if (!line) return;

				searchRegex.lastIndex = 0;
				const match = searchRegex.exec(line);
				if (match) {
					results.push({
						filePath: fileInfo.relativePath,
						line: lineNumber,
						column: match.index + 1,
						content: line.trim(),
					});
				}
			});

			rl.once('close', finalize);
			rl.once('error', (err: Error) => {
				logger.info(
					`Error reading large file ${fileInfo.relativePath}: ${err.message}`,
				);
				finalize();
			});

			stream.once('error', (err: Error) => {
				logger.info(
					`Stream error for ${fileInfo.relativePath}: ${err.message}`,
				);
				finalize();
			});
		});
	}

	/**
	 * Fast text search with multi-layer strategy
	 * Strategy 1: git grep (fastest, uses git index)
	 * Strategy 2: system grep/ripgrep (fast, system-optimized)
	 * Strategy 3: JavaScript fallback (slower, but always works)
	 * Searches for text patterns across files with glob filtering
	 *
	 * Enhanced with global timeout protection to prevent runaway searches
	 */
	async textSearch(
		pattern: string,
		fileGlob?: string,
		isRegex: boolean = true,
		maxResults: number = 100,
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		this.markActivity();
		const timeoutMs = TEXT_SEARCH_TIMEOUT_MS;

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(
					new Error(
						`Text search exceeded ${timeoutMs}ms timeout. Try using a more specific pattern or fileGlob filter.`,
					),
				);
			}, timeoutMs);
			timeoutId.unref?.();

			this.executeTextSearch(pattern, fileGlob, isRegex, maxResults)
				.then(result => {
					clearTimeout(timeoutId);
					resolve(result);
				})
				.catch(error => {
					clearTimeout(timeoutId);
					reject(error);
				});
		});
	}

	/**
	 * Internal text search implementation (separated for timeout wrapping)
	 *
	 * Strategy priority:
	 * 1. git grep (fastest, works in git repos)
	 * 2. system grep (reliable on all platforms, especially Windows)
	 * 3. ripgrep (fast but can hang on Windows)
	 * 4. JavaScript fallback (always works)
	 */
	private async executeTextSearch(
		pattern: string,
		fileGlob?: string,
		isRegex: boolean = true,
		maxResults: number = 100,
	): Promise<
		Array<{filePath: string; line: number; column: number; content: string}>
	> {
		this.markActivity();
		// Check command availability once (cached)
		const [isGitRepo, gitAvailable, rgAvailable, grepAvailable] =
			await Promise.all([
				this.isGitRepository(),
				this.isCommandAvailableCached('git'),
				this.isCommandAvailableCached('rg'),
				this.isCommandAvailableCached('grep'),
			]);

		// Strategy 1: Try git grep first (fastest in git repos)
		if (isGitRepo && gitAvailable) {
			try {
				const results = await this.gitGrepSearch(
					pattern,
					fileGlob,
					maxResults,
					isRegex,
				);
				if (results.length > 0) {
					return await this.sortResultsByRecency(results);
				}
			} catch (error) {
				// Fall through to next strategy
			}
		}

		// Strategy 2: Try ripgrep (fast and reliable, with timeout protection)
		if (rgAvailable) {
			try {
				const results = await this.systemGrepSearch(
					pattern,
					fileGlob,
					maxResults,
					'rg',
				);
				return await this.sortResultsByRecency(results);
			} catch (error) {
				logger.info('Ripgrep failed, trying next strategy');
				// Fall through to system grep or JavaScript fallback
			}
		}

		// Strategy 3: Try system grep as fallback
		if (grepAvailable) {
			try {
				const results = await this.systemGrepSearch(
					pattern,
					fileGlob,
					maxResults,
					'grep',
				);
				return await this.sortResultsByRecency(results);
			} catch (error) {
				logger.info('System grep failed, falling back to JavaScript search');
				// Fall through to JavaScript fallback
			}
		}

		// Strategy 4: JavaScript fallback (always works)
		logger.info('Using JavaScript fallback for text search');
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
	 * Uses cached stat calls for better performance
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
		const recentThreshold = RECENT_FILE_THRESHOLD;

		// Get unique file paths
		const uniqueFiles = Array.from(new Set(results.map(r => r.filePath)));

		// Fetch file modification times with caching
		const fileModTimes = new Map<string, number>();
		const uncachedFiles: string[] = [];

		// Check cache first
		for (const filePath of uniqueFiles) {
			const cached = this.fileStatCache.get(filePath);
			if (
				cached &&
				now - cached.cachedAt < ACECodeSearchService.STAT_CACHE_TTL
			) {
				fileModTimes.set(filePath, cached.mtimeMs);
			} else {
				uncachedFiles.push(filePath);
			}
		}

		// Fetch uncached files in parallel
		if (uncachedFiles.length > 0) {
			const statResults = await Promise.allSettled(
				uncachedFiles.map(async filePath => {
					const fullPath = path.resolve(this.basePath, filePath);
					const stats = await fs.stat(fullPath);
					return {filePath, mtimeMs: stats.mtimeMs};
				}),
			);

			statResults.forEach((result, index) => {
				const filePath = uncachedFiles[index]!;
				if (result.status === 'fulfilled') {
					const mtimeMs = result.value.mtimeMs;
					fileModTimes.set(filePath, mtimeMs);
					this.fileStatCache.set(filePath, {mtimeMs, cachedAt: now});
					this.trimFileStatCache();
				} else {
					// If we can't get stats, treat as old file
					fileModTimes.set(filePath, 0);
				}
			});
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
	 * Supports both local files and remote SSH files (ssh://user@host:port/path)
	 */
	async getFileOutline(
		filePath: string,
		options?: {
			maxResults?: number;
			includeContext?: boolean;
			symbolTypes?: SymbolType[];
		},
	): Promise<CodeSymbol[]> {
		this.markActivity();
		// Check if this is a remote SSH path
		const isRemote = this.isSSHPath(filePath);
		let content: string;
		let effectivePath: string;

		try {
			if (isRemote) {
				// Read from remote SSH server
				content = await this.readRemoteFile(filePath);
				// Extract the file path from SSH URL for symbol parsing
				const parsed = parseSSHUrl(filePath);
				effectivePath = parsed?.path || filePath;
			} else {
				// Read from local filesystem
				effectivePath = path.resolve(this.basePath, filePath);
				content = await fs.readFile(effectivePath, 'utf-8');
			}

			let symbols = await parseFileSymbols(
				effectivePath,
				content,
				this.basePath,
			);

			// Filter by symbol types if specified
			if (options?.symbolTypes && options.symbolTypes.length > 0) {
				symbols = symbols.filter(s => options.symbolTypes!.includes(s.type));
			}

			// Prioritize important symbols (function, class, interface, method)
			const importantTypes: SymbolType[] = [
				'function',
				'class',
				'interface',
				'method',
			];
			symbols.sort((a, b) => {
				const aImportant = importantTypes.includes(a.type);
				const bImportant = importantTypes.includes(b.type);
				if (aImportant && !bImportant) return -1;
				if (!aImportant && bImportant) return 1;
				return 0;
			});

			// Limit results
			if (options?.maxResults && options.maxResults > 0) {
				symbols = symbols.slice(0, options.maxResults);
			}

			// Remove context if not needed
			if (options?.includeContext === false) {
				symbols = symbols.map(s => ({...s, context: undefined}));
			}

			return symbols;
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
		symbolType?: CodeSymbol['type'],
		maxResults: number = 50,
	): Promise<SemanticSearchResult> {
		this.markActivity();
		const startTime = Date.now();

		// Get symbol search results
		const symbolResults = await this.searchSymbols(
			query,
			symbolType,
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
}

// Export a default instance
export const aceCodeSearchService = new ACECodeSearchService();

// MCP Tool definitions for integration
export const mcpTools = [
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
				line: {
					type: 'number',
					description:
						'Line number where the symbol appears in contextFile (0-indexed, optional). Required by some LSP servers like OmniSharp for accurate definition lookup.',
				},
				column: {
					type: 'number',
					description:
						'Column number where the symbol appears in contextFile (0-indexed, optional). Required by some LSP servers like OmniSharp for accurate definition lookup.',
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
			'ACE Code Search: Intelligent symbol search and semantic analysis. Supports multiple search modes: (1) definition - find symbol definitions (functions/classes/interfaces); (2) usage - find symbol reference locations; (3) implementation - find specific implementations; (4) all - comprehensive search. Supports fuzzy matching and filtering by language and symbol type. 💡 Tip: If you only need to view the symbol outline of a single file, use ace-file_outline for faster access.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Search Query (symbol name or pattern, supports fuzzy matching such as "gfc" matching "getFileContent")',
				},
				searchType: {
					type: 'string',
					enum: ['definition', 'usage', 'implementation', 'all'],
					description:
						'Search Types: definition (search for declarations), usage (search for usages), implementation (search for implementations), all (full search)',
					default: 'all',
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
					description:
						'Optionally, filter by symbol type (function, class, variable, etc.).',
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
					description: 'Optional: Filter by programming language',
				},
				maxResults: {
					type: 'number',
					description: 'Maximum number of returned results (default: 50)',
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
				maxResults: {
					type: 'number',
					description:
						'Maximum number of symbols to return (default: unlimited). Important symbols (function, class, interface, method) are prioritized.',
				},
				includeContext: {
					type: 'boolean',
					description:
						'Whether to include surrounding code context (default: true). Set to false to reduce output size significantly.',
					default: true,
				},
				symbolTypes: {
					type: 'array',
					items: {
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
					},
					description:
						'Filter by specific symbol types (optional). If not specified, all symbol types are returned.',
				},
			},
			required: ['filePath', 'maxResults', 'includeContext'],
		},
	},
	{
		name: 'ace-text_search',
		description:
			'ACE Code Search: Literal text/regex pattern matching (grep-style search). Best for finding exact strings: TODOs, comments, log messages, error strings, string constants. NOT recommended for code understanding or exploring functionality - use semantic search tools for that. Use when you know the exact text pattern you are looking for.',
		inputSchema: {
			type: 'object',
			properties: {
				pattern: {
					type: 'string',
					description:
						'Text pattern or regex to search for. Examples: "TODO:" (literal), "import.*from" (regex), "tool_call|toolCall" (regex with OR). By default, pattern is treated as regex. Set isRegex to false for literal string search.',
				},
				fileGlob: {
					type: 'string',
					description:
						'Glob pattern to filter files (e.g., "*.ts" for TypeScript only, "**/*.{js,ts}" for JS and TS, "src/**/*.py" for Python in src)',
				},
				isRegex: {
					type: 'boolean',
					description:
						'Whether to force regex mode. If not specified, the tool defaults to regex mode. Set to false to use literal string search.',
					default: true,
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
];
