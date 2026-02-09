import initSqlJs, {type Database} from 'sql.js';
import path from 'node:path';
import fs from 'node:fs';
import {logger} from '../core/logger.js';

/**
 * sql.js singleton cache
 * Prevents loading multiple WASM instances which can cause conflicts
 */
let sqlJsStatic: any = null;
let sqlJsInitPromise: Promise<any> | null = null;

/**
 * Get sql.js static instance (singleton pattern)
 * Ensures WASM module is only loaded once per process
 */
async function getSqlJs(): Promise<any> {
	if (sqlJsStatic) {
		return sqlJsStatic;
	}

	if (sqlJsInitPromise) {
		return sqlJsInitPromise;
	}

	sqlJsInitPromise = initSqlJs().then(SQL => {
		sqlJsStatic = SQL;
		sqlJsInitPromise = null;
		logger.debug('sql.js WASM module loaded');
		return SQL;
	});

	return sqlJsInitPromise;
}

/**
 * Code chunk with embedding
 */
export interface CodeChunk {
	id?: number;
	filePath: string;
	content: string;
	startLine: number;
	endLine: number;
	embedding: number[];
	fileHash: string; // SHA-256 hash of file content for change detection
	createdAt: number;
	updatedAt: number;
}

/**
 * Indexing progress record
 */
export interface IndexProgress {
	totalFiles: number;
	processedFiles: number;
	totalChunks: number;
	status: 'idle' | 'indexing' | 'completed' | 'error';
	lastError?: string;
	lastProcessedFile?: string;
	startedAt?: number;
	completedAt?: number;
}

/**
 * Codebase SQLite database manager
 * Handles embedding storage with vector support
 */
export class CodebaseDatabase {
	private db: Database | null = null;
	private dbPath: string;
	private initialized: boolean = false;

	constructor(projectRoot: string) {
		// Store database in .snow/codebase directory
		const snowDir = path.join(projectRoot, '.snow', 'codebase');
		if (!fs.existsSync(snowDir)) {
			fs.mkdirSync(snowDir, {recursive: true});
		}
		this.dbPath = path.join(snowDir, 'embeddings.db');
	}

	/**
	 * Initialize database and create tables
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			const SQL = await getSqlJs();

			// Load existing database if it exists
			if (fs.existsSync(this.dbPath)) {
				const buffer = fs.readFileSync(this.dbPath);
				this.db = new SQL.Database(buffer);
			} else {
				this.db = new SQL.Database();
			}

			// Create tables
			this.createTables();

			this.initialized = true;
			logger.info('Codebase database initialized', {path: this.dbPath});
		} catch (error) {
			logger.error('Failed to initialize codebase database', error);
			throw error;
		}
	}

	/**
	 * Create database tables
	 */
	private createTables(): void {
		if (!this.db) throw new Error('Database not initialized');

		// Code chunks table with embeddings
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS code_chunks (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				file_path TEXT NOT NULL,
				content TEXT NOT NULL,
				start_line INTEGER NOT NULL,
				end_line INTEGER NOT NULL,
				embedding BLOB NOT NULL,
				file_hash TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_file_path ON code_chunks(file_path);
			CREATE INDEX IF NOT EXISTS idx_file_hash ON code_chunks(file_hash);
		`);

		// Indexing progress table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS index_progress (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				total_files INTEGER NOT NULL DEFAULT 0,
				processed_files INTEGER NOT NULL DEFAULT 0,
				total_chunks INTEGER NOT NULL DEFAULT 0,
				status TEXT NOT NULL DEFAULT 'idle',
				last_error TEXT,
				last_processed_file TEXT,
				started_at INTEGER,
				completed_at INTEGER,
				updated_at INTEGER NOT NULL,
				watcher_enabled INTEGER NOT NULL DEFAULT 0
			);
		`);

		// Initialize progress record if not exists
		this.db.run(
			'INSERT OR IGNORE INTO index_progress (id, updated_at) VALUES (?, ?)',
			[1, Date.now()],
		);
	}

	/**
	 * Save database to disk
	 */
	private save(): void {
		if (!this.db) return;
		const data = this.db.export();
		fs.writeFileSync(this.dbPath, data);
	}

	/**
	 * Insert or update code chunks (batch operation)
	 */
	insertChunks(chunks: CodeChunk[]): void {
		if (!this.db) throw new Error('Database not initialized');

		for (const chunk of chunks) {
			// Convert embedding array to Buffer for storage
			const embeddingBuffer = Buffer.from(
				new Float32Array(chunk.embedding).buffer,
			);

			this.db.run(
				`INSERT INTO code_chunks (
					file_path, content, start_line, end_line,
					embedding, file_hash, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					chunk.filePath,
					chunk.content,
					chunk.startLine,
					chunk.endLine,
					embeddingBuffer,
					chunk.fileHash,
					chunk.createdAt,
					chunk.updatedAt,
				],
			);
		}

		this.save();
	}

	/**
	 * Delete chunks by file path
	 */
	deleteChunksByFile(filePath: string): void {
		if (!this.db) throw new Error('Database not initialized');

		this.db.run('DELETE FROM code_chunks WHERE file_path = ?', [filePath]);
		this.save();
	}

	/**
	 * Get chunks by file path
	 */
	getChunksByFile(filePath: string): CodeChunk[] {
		if (!this.db) throw new Error('Database not initialized');

		const results = this.db.exec(
			'SELECT * FROM code_chunks WHERE file_path = ?',
			[filePath],
		);

		if (results.length === 0) return [];

		const rows = this.resultsToObjects(results[0]!);
		return rows.map(row => this.rowToChunk(row));
	}

	/**
	 * Check if file has been indexed by hash
	 */
	hasFileHash(fileHash: string): boolean {
		if (!this.db) throw new Error('Database not initialized');

		const results = this.db.exec(
			'SELECT COUNT(*) as count FROM code_chunks WHERE file_hash = ?',
			[fileHash],
		);

		if (results.length === 0) return false;
		if (!results[0]!.values || results[0]!.values.length === 0) return false;
		const count = results[0]!.values[0]![0] as number;
		return count > 0;
	}

	/**
	 * Get total chunks count
	 */
	getTotalChunks(): number {
		if (!this.db) throw new Error('Database not initialized');

		const results = this.db.exec('SELECT COUNT(*) as count FROM code_chunks');
		if (results.length === 0) return 0;
		if (!results[0]!.values || results[0]!.values.length === 0) return 0;
		return results[0]!.values[0]![0] as number;
	}

	/**
	 * Search similar code chunks by embedding
	 * Uses cosine similarity
	 */
	searchSimilar(queryEmbedding: number[], limit: number = 10): CodeChunk[] {
		if (!this.db) throw new Error('Database not initialized');

		// Get all chunks (in production, use approximate nearest neighbor)
		const results = this.db.exec('SELECT * FROM code_chunks');
		if (results.length === 0) return [];

		const rows = this.resultsToObjects(results[0]!);

		// Calculate cosine similarity for each chunk
		const scored = rows.map(row => {
			const chunk = this.rowToChunk(row);
			const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);
			return {chunk, similarity};
		});

		// Sort by similarity and return top N
		scored.sort((a, b) => b.similarity - a.similarity);

		return scored.slice(0, limit).map(r => r.chunk);
	}

	/**
	 * Search similar code chunks by embedding with file path filter
	 * Uses cosine similarity, but only searches within specified files
	 * @param queryEmbedding - Query embedding vector
	 * @param filePaths - Array of file paths to search within
	 * @param limit - Maximum number of results
	 */
	searchSimilarInFiles(
		queryEmbedding: number[],
		filePaths: string[],
		limit: number = 10,
	): CodeChunk[] {
		if (!this.db) throw new Error('Database not initialized');

		if (filePaths.length === 0) {
			return this.searchSimilar(queryEmbedding, limit);
		}

		// Build SQL with file path filters
		const placeholders = filePaths.map(() => '?').join(',');
		const sql = `SELECT * FROM code_chunks WHERE file_path IN (${placeholders})`;
		const results = this.db.exec(sql, filePaths);

		if (results.length === 0) return [];

		const rows = this.resultsToObjects(results[0]!);

		// Calculate cosine similarity for each chunk
		const scored = rows.map(row => {
			const chunk = this.rowToChunk(row);
			const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);
			return {chunk, similarity};
		});

		// Sort by similarity and return top N
		scored.sort((a, b) => b.similarity - a.similarity);

		return scored.slice(0, limit).map(r => r.chunk);
	}

	/**
	 * Update indexing progress
	 */
	updateProgress(progress: Partial<IndexProgress>): void {
		if (!this.db || !this.initialized) {
			// Silently ignore if database is not initialized
			return;
		}

		const fields: string[] = [];
		const values: any[] = [];

		if (progress.totalFiles !== undefined) {
			fields.push('total_files = ?');
			values.push(progress.totalFiles);
		}
		if (progress.processedFiles !== undefined) {
			fields.push('processed_files = ?');
			values.push(progress.processedFiles);
		}
		if (progress.totalChunks !== undefined) {
			fields.push('total_chunks = ?');
			values.push(progress.totalChunks);
		}
		if (progress.status !== undefined) {
			fields.push('status = ?');
			values.push(progress.status);
		}
		if (progress.lastError !== undefined) {
			fields.push('last_error = ?');
			values.push(progress.lastError);
		}
		if (progress.lastProcessedFile !== undefined) {
			fields.push('last_processed_file = ?');
			values.push(progress.lastProcessedFile);
		}
		if (progress.startedAt !== undefined) {
			fields.push('started_at = ?');
			values.push(progress.startedAt);
		}
		if (progress.completedAt !== undefined) {
			fields.push('completed_at = ?');
			values.push(progress.completedAt);
		}

		fields.push('updated_at = ?');
		values.push(Date.now());

		const sql = `UPDATE index_progress SET ${fields.join(', ')} WHERE id = 1`;
		this.db.run(sql, values);
		this.save();
	}

	/**
	 * Get current indexing progress
	 */
	getProgress(): IndexProgress {
		if (!this.db) throw new Error('Database not initialized');

		const results = this.db.exec('SELECT * FROM index_progress WHERE id = 1');

		if (results.length === 0) {
			return {
				totalFiles: 0,
				processedFiles: 0,
				totalChunks: 0,
				status: 'idle',
			};
		}

		const row = this.resultsToObjects(results[0]!)[0]!;

		return {
			totalFiles: row['total_files'] as number,
			processedFiles: row['processed_files'] as number,
			totalChunks: row['total_chunks'] as number,
			status: row['status'] as IndexProgress['status'],
			lastError: row['last_error'] as string | undefined,
			lastProcessedFile: row['last_processed_file'] as string | undefined,
			startedAt: row['started_at'] as number | undefined,
			completedAt: row['completed_at'] as number | undefined,
		};
	}

	/**
	 * Set watcher enabled status
	 */
	setWatcherEnabled(enabled: boolean): void {
		if (!this.db) throw new Error('Database not initialized');

		this.db.run('UPDATE index_progress SET watcher_enabled = ? WHERE id = 1', [
			enabled ? 1 : 0,
		]);
		this.save();
	}

	/**
	 * Get watcher enabled status
	 */
	isWatcherEnabled(): boolean {
		if (!this.db) throw new Error('Database not initialized');

		const results = this.db.exec(
			'SELECT watcher_enabled FROM index_progress WHERE id = 1',
		);

		if (results.length === 0) return false;
		if (!results[0]!.values || results[0]!.values.length === 0) return false;
		return (results[0]!.values[0]![0] as number) === 1;
	}

	/**
	 * Clear all chunks and reset progress
	 */
	clear(): void {
		if (!this.db) throw new Error('Database not initialized');

		this.db.exec('DELETE FROM code_chunks');
		this.db.run(
			`UPDATE index_progress
			SET total_files = ?,
				processed_files = ?,
				total_chunks = ?,
				status = ?,
				last_error = NULL,
				last_processed_file = NULL,
				started_at = NULL,
				completed_at = NULL,
				updated_at = ?
			WHERE id = 1`,
			[0, 0, 0, 'idle', Date.now()],
		);
		this.save();
	}

	/**
	 * Close database connection
	 */
	close(): void {
		if (this.db) {
			this.save();
			this.db.close();
			this.db = null;
			this.initialized = false;
		}
	}

	/**
	 * Convert sql.js query results to objects
	 */
	private resultsToObjects(result: {
		columns: string[];
		values: any[][];
	}): Record<string, any>[] {
		return result.values.map(row => {
			const obj: Record<string, any> = {};
			for (let i = 0; i < result.columns.length; i++) {
				obj[result.columns[i]!] = row[i];
			}
			return obj;
		});
	}

	/**
	 * Convert database row to CodeChunk
	 */
	private rowToChunk(row: any): CodeChunk {
		// Convert Uint8Array back to number array
		const embeddingData = row.embedding as Uint8Array;
		const embedding = Array.from(
			new Float32Array(
				embeddingData.buffer,
				embeddingData.byteOffset,
				embeddingData.byteLength / 4,
			),
		);

		return {
			id: row.id,
			filePath: row.file_path,
			content: row.content,
			startLine: row.start_line,
			endLine: row.end_line,
			embedding,
			fileHash: row.file_hash,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error('Vectors must have same length');
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i]! * b[i]!;
			normA += a[i]! * a[i]!;
			normB += b[i]! * b[i]!;
		}

		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	}
}
