import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ignore, {type Ignore} from 'ignore';
import chokidar from 'chokidar';
import {logger} from '../utils/core/logger.js';
import {
	CodebaseDatabase,
	type CodeChunk,
} from '../utils/codebase/codebaseDatabase.js';
import {createEmbeddings} from '../api/embedding.js';
import {
	loadCodebaseConfig,
	type CodebaseConfig,
} from '../utils/config/codebaseConfig.js';
import {withRetry} from '../utils/core/retryUtils.js';

/**
 * Progress callback for UI updates
 */
export type ProgressCallback = (progress: {
	totalFiles: number;
	processedFiles: number;
	totalChunks: number;
	currentFile: string;
	status: 'scanning' | 'indexing' | 'completed' | 'error';
	error?: string;
}) => void;

/**
 * Codebase Index Agent
 * Handles automatic code scanning, chunking, and embedding
 */
export class CodebaseIndexAgent {
	private db: CodebaseDatabase;
	private config: CodebaseConfig;
	private projectRoot: string;
	private ignoreFilter: Ignore;
	private isRunning: boolean = false;
	private shouldStop: boolean = false;
	private progressCallback?: ProgressCallback;
	private consecutiveFailures: number = 0;
	private readonly MAX_CONSECUTIVE_FAILURES = 3;
	private fileWatcher: any | null = null;
	private watchDebounceTimers: Map<string, NodeJS.Timeout> = new Map();

	// Supported code file extensions
	private static readonly CODE_EXTENSIONS = new Set([
		'.ts',
		'.tsx',
		'.js',
		'.jsx',
		'.py',
		'.java',
		'.cpp',
		'.c',
		'.h',
		'.hpp',
		'.cs',
		'.go',
		'.rs',
		'.rb',
		'.php',
		'.swift',
		'.kt',
		'.scala',
		'.m',
		'.md',
		'.mm',
		'.sh',
		'.bash',
		'.sql',
		'.graphql',
		'.proto',
		'.json',
		'.yaml',
		'.yml',
		'.toml',
		'.xml',
		'.html',
		'.css',
		'.scss',
		'.less',
		'.vue',
		'.svelte',
	]);

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
		this.config = loadCodebaseConfig();
		this.db = new CodebaseDatabase(projectRoot);
		this.ignoreFilter = ignore();

		// Load .gitignore if exists
		this.loadGitignore();

		// Add default ignore patterns
		this.addDefaultIgnorePatterns();
	}

	/**
	 * Start indexing process
	 */
	async start(progressCallback?: ProgressCallback): Promise<void> {
		if (this.isRunning) {
			logger.warn('Indexing already in progress');
			return;
		}

		// Reload config to check if it was changed
		this.config = loadCodebaseConfig();
		if (!this.config.enabled) {
			logger.info('Codebase indexing is disabled');
			return;
		}

		// Check if .gitignore exists
		const gitignorePath = path.join(this.projectRoot, '.gitignore');
		if (!fs.existsSync(gitignorePath)) {
			// Import translations dynamically to get localized error message
			const {getCurrentLanguage} = await import(
				'../utils/config/languageConfig.js'
			);
			const {translations} = await import('../i18n/index.js');
			const currentLanguage = getCurrentLanguage();
			const t = translations[currentLanguage];
			const errorMessage = t.codebaseConfig.gitignoreNotFound;

			logger.error(errorMessage);

			if (progressCallback) {
				progressCallback({
					totalFiles: 0,
					processedFiles: 0,
					totalChunks: 0,
					currentFile: '',
					status: 'error',
					error: errorMessage,
				});
			}

			return;
		}

		this.isRunning = true;
		this.shouldStop = false;
		this.progressCallback = progressCallback;

		try {
			// Initialize database
			await this.db.initialize();

			// Check if stopped before starting
			if (this.shouldStop) {
				logger.info('Indexing cancelled before start');
				return;
			}

			// Check if we should resume or start fresh
			const progress = this.db.getProgress();
			const isResuming = progress.status === 'indexing';

			if (isResuming) {
				logger.info('Resuming previous indexing session');
			}

			// Scan files first
			this.notifyProgress({
				totalFiles: 0,
				processedFiles: 0,
				totalChunks: 0,
				currentFile: '',
				status: 'scanning',
			});

			const files = await this.scanFiles();
			logger.info(`Found ${files.length} code files to index`);

			// Reset progress if file count changed (project structure changed)
			// or if previous session was interrupted abnormally
			const shouldReset =
				isResuming &&
				(progress.totalFiles !== files.length ||
					progress.processedFiles > files.length);

			if (shouldReset) {
				logger.info(
					'File count changed or progress corrupted, resetting progress',
				);
				this.db.updateProgress({
					totalFiles: files.length,
					processedFiles: 0,
					totalChunks: this.db.getTotalChunks(),
					status: 'indexing',
					startedAt: Date.now(),
					lastProcessedFile: undefined,
				});
			} else {
				// Update status to indexing
				this.db.updateProgress({
					status: 'indexing',
					totalFiles: files.length,
					startedAt: isResuming ? progress.startedAt : Date.now(),
				});
			}

			// Check if stopped after initialization
			if (this.shouldStop) {
				logger.info('Indexing cancelled after initialization');
				return;
			}

			// Process files with concurrency control
			await this.processFiles(files);

			// Only mark as completed if not stopped by user
			if (!this.shouldStop) {
				// Mark as completed
				this.db.updateProgress({
					status: 'completed',
					completedAt: Date.now(),
				});

				this.notifyProgress({
					totalFiles: files.length,
					processedFiles: files.length,
					totalChunks: this.db.getTotalChunks(),
					currentFile: '',
					status: 'completed',
				});

				logger.info('Indexing completed successfully');
			} else {
				logger.info('Indexing paused by user, progress saved');
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';

			this.db.updateProgress({
				status: 'error',
				lastError: errorMessage,
			});

			this.notifyProgress({
				totalFiles: 0,
				processedFiles: 0,
				totalChunks: 0,
				currentFile: '',
				status: 'error',
				error: errorMessage,
			});

			logger.error('Indexing failed', error);
			throw error;
		} finally {
			this.isRunning = false;
			this.shouldStop = false;

			// Don't change status to 'idle' if indexing was stopped
			// This allows resuming when returning to chat screen
			// Status will remain as 'indexing' so it can be resumed
		}
	}

	/**
	 * Stop indexing gracefully
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		logger.info('Stopping indexing...');
		this.shouldStop = true;

		// Also stop file watcher to ensure everything is stopped
		this.stopWatching();

		// Wait for current operation to finish
		while (this.isRunning) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	/**
	 * Check if indexing is in progress
	 */
	isIndexing(): boolean {
		return this.isRunning;
	}

	/**
	 * Get current progress
	 */
	async getProgress() {
		// Initialize database if not already done
		if (!this.db) {
			this.db = new CodebaseDatabase(this.projectRoot);
		}
		await this.db.initialize();
		return this.db.getProgress();
	}

	/**
	 * Clear all indexed data
	 */
	clear(): void {
		this.db.clear();
	}

	/**
	 * Close database connection
	 */
	close(): void {
		this.stopWatching();
		this.db.close();
	}

	/**
	 * Check if watcher is enabled in database
	 */
	async isWatcherEnabled(): Promise<boolean> {
		try {
			await this.db.initialize();
			return this.db.isWatcherEnabled();
		} catch (error) {
			return false;
		}
	}

	/**
	 * Start watching for file changes
	 */
	startWatching(progressCallback?: ProgressCallback): void {
		if (this.fileWatcher) {
			logger.debug('File watcher already running');
			return;
		}

		// Reload config to check if it was changed
		this.config = loadCodebaseConfig();
		if (!this.config.enabled) {
			logger.info('Codebase indexing is disabled, not starting watcher');
			return;
		}

		// Save progress callback for file change notifications
		if (progressCallback) {
			this.progressCallback = progressCallback;
		}

		try {
			// Use chokidar for better cross-platform performance and reliability
			// Reuse existing ignoreFilter to keep consistency with scanFiles
			this.fileWatcher = chokidar.watch(this.projectRoot, {
				ignored: (filePath: string) => {
					const relativePath = path.relative(this.projectRoot, filePath);
					// Skip empty paths (the root directory itself) and check ignore filter
					if (!relativePath || relativePath === '.') {
						return false;
					}
					return this.ignoreFilter.ignores(relativePath);
				},
				ignoreInitial: true, // Don't trigger events for initial scan
				awaitWriteFinish: {
					stabilityThreshold: 1000, // Wait 1s after last change
					pollInterval: 100,
				},
				persistent: true,
			});

			// Handle file added or changed
			this.fileWatcher.on('add', (filePath: string) => {
				const ext = path.extname(filePath);
				if (!CodebaseIndexAgent.CODE_EXTENSIONS.has(ext)) {
					return;
				}

				const relativePath = path.relative(this.projectRoot, filePath);
				logger.debug(`File created, indexing: ${relativePath}`);
				this.debounceFileChange(filePath, relativePath);
			});

			this.fileWatcher.on('change', (filePath: string) => {
				const ext = path.extname(filePath);
				if (!CodebaseIndexAgent.CODE_EXTENSIONS.has(ext)) {
					return;
				}

				const relativePath = path.relative(this.projectRoot, filePath);
				logger.debug(`File modified, reindexing: ${relativePath}`);
				this.debounceFileChange(filePath, relativePath);
			});

			// Handle file deleted
			this.fileWatcher.on('unlink', (filePath: string) => {
				const ext = path.extname(filePath);
				if (!CodebaseIndexAgent.CODE_EXTENSIONS.has(ext)) {
					return;
				}

				const relativePath = path.relative(this.projectRoot, filePath);
				logger.debug(`File deleted, removing from index: ${relativePath}`);
				this.db.deleteChunksByFile(relativePath);
			});

			// Handle watcher errors
			this.fileWatcher.on('error', (error: Error) => {
				// Ignore ELOOP errors (circular symlinks) - common in some project structures
				if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
					logger.debug('Skipping circular symlink during file watching');
					return;
				}
				// Log other errors but don't crash the watcher
				logger.warn('File watcher error', error);
			});

			// Persist watcher state to database
			this.db.setWatcherEnabled(true);

			logger.info('File watcher started successfully');
		} catch (error) {
			logger.error('Failed to start file watcher', error);
		}
	}

	/**
	 * Stop watching for file changes
	 */
	stopWatching(): void {
		if (this.fileWatcher) {
			this.fileWatcher.close();
			this.fileWatcher = null;

			// Persist watcher state to database
			this.db.setWatcherEnabled(false);

			logger.info('File watcher stopped');
		}

		// Clear all pending debounce timers
		for (const timer of this.watchDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.watchDebounceTimers.clear();
	}

	/**
	 * Debounce file changes to avoid multiple rapid updates
	 */
	private debounceFileChange(filePath: string, relativePath: string): void {
		// Clear existing timer for this file
		const existingTimer = this.watchDebounceTimers.get(relativePath);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Set new timer
		const timer = setTimeout(() => {
			this.watchDebounceTimers.delete(relativePath);
			this.handleFileChange(filePath, relativePath);
		}, 5000); // 5 second debounce - optimized for AI code editing

		this.watchDebounceTimers.set(relativePath, timer);
	}

	/**
	 * Handle file change event
	 */
	private async handleFileChange(
		filePath: string,
		relativePath: string,
	): Promise<void> {
		try {
			// Notify UI that file is being reindexed
			this.notifyProgress({
				totalFiles: 0,
				processedFiles: 0,
				totalChunks: this.db.getTotalChunks(),
				currentFile: relativePath,
				status: 'indexing',
			});

			await this.processFile(filePath);

			// Notify UI that reindexing is complete
			this.notifyProgress({
				totalFiles: 0,
				processedFiles: 0,
				totalChunks: this.db.getTotalChunks(),
				currentFile: '',
				status: 'completed',
			});
		} catch (error) {
			logger.error(`Failed to reindex file: ${relativePath}`, error);
		}
	}

	/**
	 * Load .gitignore file
	 */
	private loadGitignore(): void {
		const gitignorePath = path.join(this.projectRoot, '.gitignore');
		if (fs.existsSync(gitignorePath)) {
			const content = fs.readFileSync(gitignorePath, 'utf-8');
			this.ignoreFilter.add(content);
		}
	}

	/**
	 * Add default ignore patterns
	 */
	private addDefaultIgnorePatterns(): void {
		this.ignoreFilter.add([
			'node_modules',
			'.git',
			'.snow',
			'dist',
			'build',
			'out',
			'coverage',
			'.next',
			'.nuxt',
			'.cache',
			'*.min.js',
			'*.min.css',
			'*.map',
			'package-lock.json',
			'yarn.lock',
			'pnpm-lock.yaml',
		]);
	}

	/**
	 * Scan project directory for code files
	 */
	private async scanFiles(): Promise<string[]> {
		const files: string[] = [];

		const scanDir = (dir: string) => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(dir, {withFileTypes: true});
			} catch (error: any) {
				// 处理权限不足等错误，跳过该目录而不是崩溃
				if (error.code === 'EPERM' || error.code === 'EACCES') {
					logger.warn(`跳过无权限访问的目录: ${dir}`);
					return;
				}
				// 其他错误也记录但不中断扫描
				logger.warn(`扫描目录失败 (${error.code || 'unknown'}): ${dir}`);
				return;
			}

			for (const entry of entries) {
				if (this.shouldStop) break;

				const fullPath = path.join(dir, entry.name);
				const relativePath = path.relative(this.projectRoot, fullPath);

				// Check if should be ignored
				// Skip empty paths (should not happen, but defensive check)
				if (
					relativePath &&
					relativePath !== '.' &&
					this.ignoreFilter.ignores(relativePath)
				) {
					continue;
				}

				if (entry.isDirectory()) {
					scanDir(fullPath);
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name);
					if (CodebaseIndexAgent.CODE_EXTENSIONS.has(ext)) {
						files.push(fullPath);
					}
				}
			}
		};

		scanDir(this.projectRoot);
		return files;
	}

	/**
	 * Process files with concurrency control
	 */
	private async processFiles(files: string[]): Promise<void> {
		const concurrency = this.config.batch.concurrency;

		// Process files in batches
		for (let i = 0; i < files.length; i += concurrency) {
			if (this.shouldStop) {
				logger.info('Indexing stopped by user');
				break;
			}

			const batch = files.slice(i, i + concurrency);
			const promises = batch.map(file => this.processFile(file));

			await Promise.allSettled(promises);

			// Update processed count accurately (current batch end index)
			const processedCount = Math.min(i + batch.length, files.length);
			this.db.updateProgress({
				processedFiles: processedCount,
			});
		}
	}

	/**
	 * Process single file
	 */
	private async processFile(filePath: string): Promise<void> {
		try {
			const relativePath = path.relative(this.projectRoot, filePath);

			this.notifyProgress({
				totalFiles: this.db.getProgress().totalFiles,
				processedFiles: this.db.getProgress().processedFiles,
				totalChunks: this.db.getTotalChunks(),
				currentFile: relativePath,
				status: 'indexing',
			});

			// Read file content
			const content = fs.readFileSync(filePath, 'utf-8');

			// Calculate file hash for change detection
			const fileHash = crypto
				.createHash('sha256')
				.update(content)
				.digest('hex');

			// Check if file has been indexed and unchanged
			if (this.db.hasFileHash(fileHash)) {
				logger.debug(`File unchanged, skipping: ${relativePath}`);
				return;
			}

			// Delete old chunks for this file
			this.db.deleteChunksByFile(relativePath);

			// Split content into chunks
			const chunks = this.splitIntoChunks(content, relativePath);

			if (chunks.length === 0) {
				logger.debug(`No chunks generated for: ${relativePath}`);
				return;
			}

			// Generate embeddings in batches
			const maxLines = this.config.batch.maxLines;
			const embeddingBatches: CodeChunk[][] = [];

			for (let i = 0; i < chunks.length; i += maxLines) {
				const batch = chunks.slice(i, i + maxLines);
				embeddingBatches.push(batch);
			}

			for (const batch of embeddingBatches) {
				if (this.shouldStop) break;

				try {
					// Check if codebase feature was disabled
					this.config = loadCodebaseConfig();
					if (!this.config.enabled) {
						logger.info('Codebase feature disabled, stopping indexing');
						this.shouldStop = true;
						break;
					}

					// Extract text content for embedding
					const texts = batch.map(chunk => chunk.content);

					// Check again before making API call
					if (this.shouldStop) break;

					// Call embedding API with retry
					const response = await withRetry(
						async () => {
							// Check if stopped during retry
							if (this.shouldStop) {
								throw new Error('Indexing stopped by user');
							}
							return await createEmbeddings({
								input: texts,
							});
						},
						{
							maxRetries: 3,
							baseDelay: 2000,
							onRetry: (error, attempt, nextDelay) => {
								logger.warn(
									`Embedding API failed for ${relativePath} (attempt ${attempt}/3), retrying in ${nextDelay}ms...`,
									error.message,
								);
							},
						},
					);

					// Attach embeddings to chunks
					for (let i = 0; i < batch.length; i++) {
						batch[i]!.embedding = response.data[i]!.embedding;
						batch[i]!.fileHash = fileHash;
						batch[i]!.createdAt = Date.now();
						batch[i]!.updatedAt = Date.now();
					}

					// Store chunks to database with retry
					await withRetry(
						async () => {
							this.db.insertChunks(batch);
						},
						{
							maxRetries: 2,
							baseDelay: 500,
						},
					);

					// Update total chunks count
					this.db.updateProgress({
						totalChunks: this.db.getTotalChunks(),
						lastProcessedFile: relativePath,
					});

					// Reset failure counter on success
					this.consecutiveFailures = 0;
				} catch (error) {
					this.consecutiveFailures++;
					logger.error(
						`Failed to process batch for ${relativePath} (consecutive failures: ${this.consecutiveFailures}):`,
						error,
					);

					// Stop indexing if too many consecutive failures
					if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
						logger.error(
							`Stopping indexing after ${this.MAX_CONSECUTIVE_FAILURES} consecutive failures`,
						);
						this.db.updateProgress({
							status: 'error',
							lastError: `Too many failures: ${
								error instanceof Error ? error.message : 'Unknown error'
							}`,
						});
						throw new Error(
							`Indexing stopped after ${this.MAX_CONSECUTIVE_FAILURES} consecutive failures`,
						);
					}

					// Skip this batch and continue
					continue;
				}
			}

			logger.debug(`Indexed ${chunks.length} chunks from: ${relativePath}`);
		} catch (error) {
			logger.error(`Failed to process file: ${filePath}`, error);
			// Continue with next file
		}
	}

	/**
	 * Split file content into chunks
	 */
	private splitIntoChunks(content: string, filePath: string): CodeChunk[] {
		const lines = content.split('\n');
		const chunks: CodeChunk[] = [];
		const {maxLinesPerChunk, minLinesPerChunk, minCharsPerChunk, overlapLines} =
			this.config.chunking;

		for (let i = 0; i < lines.length; i += maxLinesPerChunk - overlapLines) {
			const startLine = i;
			const endLine = Math.min(i + maxLinesPerChunk, lines.length);
			const chunkLines = lines.slice(startLine, endLine);
			const chunkContent = chunkLines.join('\n');
			const trimmedContent = chunkContent.trim();

			// Skip chunks that are too small (less than minimum lines or characters)
			// This prevents creating chunks with just a few characters or empty lines
			const actualLineCount = chunkLines.filter(
				line => line.trim().length > 0,
			).length;
			if (
				trimmedContent.length < minCharsPerChunk ||
				actualLineCount < minLinesPerChunk
			) {
				// If this is the last chunk and it's too small, try to merge with previous
				if (i > 0 && endLine >= lines.length && chunks.length > 0) {
					const lastChunk = chunks[chunks.length - 1]!;
					// Merge with previous chunk if the combined size is reasonable
					const mergedLines = lines.slice(lastChunk.startLine - 1, endLine);
					if (mergedLines.length <= maxLinesPerChunk * 1.5) {
						lastChunk.content = mergedLines.join('\n');
						lastChunk.endLine = endLine;
					}
				}
				continue;
			}

			chunks.push({
				filePath,
				content: chunkContent,
				startLine: startLine + 1, // 1-indexed
				endLine: endLine,
				embedding: [], // Will be filled later
				fileHash: '', // Will be filled later
				createdAt: 0,
				updatedAt: 0,
			});
		}

		return chunks;
	}

	/**
	 * Notify progress to callback
	 */
	private notifyProgress(progress: {
		totalFiles: number;
		processedFiles: number;
		totalChunks: number;
		currentFile: string;
		status: 'scanning' | 'indexing' | 'completed' | 'error';
		error?: string;
	}): void {
		if (this.progressCallback) {
			this.progressCallback(progress);
		}
	}
}
