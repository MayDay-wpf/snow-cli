import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ignore, {type Ignore} from 'ignore';
import {logger} from '../utils/logger.js';
import {CodebaseDatabase, type CodeChunk} from '../utils/codebaseDatabase.js';
import {createEmbeddings} from '../api/embedding.js';
import {
	loadCodebaseConfig,
	type CodebaseConfig,
} from '../utils/codebaseConfig.js';
import {withRetry} from '../utils/retryUtils.js';

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
	private fileWatcher: fs.FSWatcher | null = null;
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

		if (!this.config.enabled) {
			logger.info('Codebase indexing is disabled');
			return;
		}

		this.isRunning = true;
		this.shouldStop = false;
		this.progressCallback = progressCallback;

		try {
			// Initialize database
			this.db.initialize();

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
	getProgress() {
		// Initialize database if not already done
		if (!this.db) {
			this.db = new CodebaseDatabase(this.projectRoot);
		}
		this.db.initialize();
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
	isWatcherEnabled(): boolean {
		try {
			this.db.initialize();
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

		if (!this.config.enabled) {
			logger.info('Codebase indexing is disabled, not starting watcher');
			return;
		}

		// Save progress callback for file change notifications
		if (progressCallback) {
			this.progressCallback = progressCallback;
		}

		try {
			this.fileWatcher = fs.watch(
				this.projectRoot,
				{recursive: true},
				(_eventType, filename) => {
					if (!filename) return;

					// Convert to absolute path
					const filePath = path.join(this.projectRoot, filename);
					const relativePath = path.relative(this.projectRoot, filePath);

					// Check if file should be ignored
					if (this.ignoreFilter.ignores(relativePath)) {
						return;
					}

					// Check if it's a code file
					const ext = path.extname(filename);
					if (!CodebaseIndexAgent.CODE_EXTENSIONS.has(ext)) {
						return;
					}

					// Check if file exists (might be deleted)
					if (!fs.existsSync(filePath)) {
						logger.debug(`File deleted, removing from index: ${relativePath}`);
						this.db.deleteChunksByFile(relativePath);
						return;
					}

					// Debounce file changes
					this.debounceFileChange(filePath, relativePath);
				},
			);

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
			const entries = fs.readdirSync(dir, {withFileTypes: true});

			for (const entry of entries) {
				if (this.shouldStop) break;

				const fullPath = path.join(dir, entry.name);
				const relativePath = path.relative(this.projectRoot, fullPath);

				// Check if should be ignored
				if (this.ignoreFilter.ignores(relativePath)) {
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
					// Extract text content for embedding
					const texts = batch.map(chunk => chunk.content);

					// Call embedding API with retry
					const response = await withRetry(
						async () => {
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
		const maxLinesPerChunk = 100; // Max lines per chunk
		const overlapLines = 10; // Overlap between chunks for context

		for (let i = 0; i < lines.length; i += maxLinesPerChunk - overlapLines) {
			const startLine = i;
			const endLine = Math.min(i + maxLinesPerChunk, lines.length);
			const chunkLines = lines.slice(startLine, endLine);
			const chunkContent = chunkLines.join('\n');

			// Skip empty chunks
			if (chunkContent.trim().length === 0) {
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
