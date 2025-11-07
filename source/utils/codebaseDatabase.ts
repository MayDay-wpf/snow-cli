import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import {logger} from './logger.js';

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
	private db: Database.Database | null = null;
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
	initialize(): void {
		if (this.initialized) return;

		try {
			// Open database with better-sqlite3
			this.db = new Database(this.dbPath);

			// Enable WAL mode for better concurrency
			this.db.pragma('journal_mode = WAL');

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
			
			-- Initialize progress record if not exists
			INSERT OR IGNORE INTO index_progress (id, updated_at) VALUES (1, ${Date.now()});
		`);
	}

	/**
	 * Insert or update code chunks (batch operation)
	 */
	insertChunks(chunks: CodeChunk[]): void {
		if (!this.db) throw new Error('Database not initialized');

		const insert = this.db.prepare(`
			INSERT INTO code_chunks (
				file_path, content, start_line, end_line, 
				embedding, file_hash, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const transaction = this.db.transaction((chunks: CodeChunk[]) => {
			for (const chunk of chunks) {
				// Convert embedding array to Buffer for storage
				const embeddingBuffer = Buffer.from(
					new Float32Array(chunk.embedding).buffer,
				);

				insert.run(
					chunk.filePath,
					chunk.content,
					chunk.startLine,
					chunk.endLine,
					embeddingBuffer,
					chunk.fileHash,
					chunk.createdAt,
					chunk.updatedAt,
				);
			}
		});

		transaction(chunks);
	}

	/**
	 * Delete chunks by file path
	 */
	deleteChunksByFile(filePath: string): void {
		if (!this.db) throw new Error('Database not initialized');

		const stmt = this.db.prepare('DELETE FROM code_chunks WHERE file_path = ?');
		stmt.run(filePath);
	}

	/**
	 * Get chunks by file path
	 */
	getChunksByFile(filePath: string): CodeChunk[] {
		if (!this.db) throw new Error('Database not initialized');

		const stmt = this.db.prepare(
			'SELECT * FROM code_chunks WHERE file_path = ?',
		);
		const rows = stmt.all(filePath) as any[];

		return rows.map(row => this.rowToChunk(row));
	}

	/**
	 * Check if file has been indexed by hash
	 */
	hasFileHash(fileHash: string): boolean {
		if (!this.db) throw new Error('Database not initialized');

		const stmt = this.db.prepare(
			'SELECT COUNT(*) as count FROM code_chunks WHERE file_hash = ?',
		);
		const result = stmt.get(fileHash) as {count: number};

		return result.count > 0;
	}

	/**
	 * Get total chunks count
	 */
	getTotalChunks(): number {
		if (!this.db) throw new Error('Database not initialized');

		const stmt = this.db.prepare('SELECT COUNT(*) as count FROM code_chunks');
		const result = stmt.get() as {count: number};

		return result.count;
	}

	/**
	 * Search similar code chunks by embedding
	 * Uses cosine similarity
	 */
	searchSimilar(queryEmbedding: number[], limit: number = 10): CodeChunk[] {
		if (!this.db) throw new Error('Database not initialized');

		// Get all chunks (in production, use approximate nearest neighbor)
		const stmt = this.db.prepare('SELECT * FROM code_chunks');
		const rows = stmt.all() as any[];

		// Calculate cosine similarity for each chunk
		const results = rows.map(row => {
			const chunk = this.rowToChunk(row);
			const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);
			return {chunk, similarity};
		});

		// Sort by similarity and return top N
		results.sort((a, b) => b.similarity - a.similarity);

		return results.slice(0, limit).map(r => r.chunk);
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
		this.db.prepare(sql).run(...values);
	}

	/**
	 * Get current indexing progress
	 */
	getProgress(): IndexProgress {
		if (!this.db) throw new Error('Database not initialized');

		const stmt = this.db.prepare('SELECT * FROM index_progress WHERE id = 1');
		const row = stmt.get() as any;

		return {
			totalFiles: row.total_files,
			processedFiles: row.processed_files,
			totalChunks: row.total_chunks,
			status: row.status,
			lastError: row.last_error,
			lastProcessedFile: row.last_processed_file,
			startedAt: row.started_at,
			completedAt: row.completed_at,
		};
	}

	/**
	 * Set watcher enabled status
	 */
	setWatcherEnabled(enabled: boolean): void {
		if (!this.db) throw new Error('Database not initialized');

		this.db
			.prepare('UPDATE index_progress SET watcher_enabled = ? WHERE id = 1')
			.run(enabled ? 1 : 0);
	}

	/**
	 * Get watcher enabled status
	 */
	isWatcherEnabled(): boolean {
		if (!this.db) throw new Error('Database not initialized');

		const stmt = this.db.prepare(
			'SELECT watcher_enabled FROM index_progress WHERE id = 1',
		);
		const result = stmt.get() as {watcher_enabled: number};

		return result.watcher_enabled === 1;
	}

	/**
	 * Clear all chunks and reset progress
	 */
	clear(): void {
		if (!this.db) throw new Error('Database not initialized');

		this.db.exec('DELETE FROM code_chunks');
		this.db.exec(`
			UPDATE index_progress 
			SET total_files = 0, 
				processed_files = 0, 
				total_chunks = 0, 
				status = 'idle',
				last_error = NULL,
				last_processed_file = NULL,
				started_at = NULL,
				completed_at = NULL,
				updated_at = ${Date.now()}
			WHERE id = 1
		`);
	}

	/**
	 * Close database connection
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.initialized = false;
		}
	}

	/**
	 * Convert database row to CodeChunk
	 */
	private rowToChunk(row: any): CodeChunk {
		// Convert Buffer back to number array
		const embeddingBuffer = row.embedding as Buffer;
		const embedding = Array.from(
			new Float32Array(
				embeddingBuffer.buffer,
				embeddingBuffer.byteOffset,
				embeddingBuffer.byteLength / 4,
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
