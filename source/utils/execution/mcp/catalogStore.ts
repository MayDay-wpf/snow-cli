import path from 'path';
import fs from 'fs';
import {getGlobalSnowDir} from '../../core/snowContext.js';
import {logger} from '../../core/logger.js';

const log = logger.child('execution:mcp.catalogStore');
import type {MCPServiceTools} from '../mcpToolsManager.js';

export type MCPCacheEventType =
	| 'HIT_DISK_SNAPSHOT'
	| 'MISS_NOT_FOUND'
	| 'MISS_HASH_CHANGED'
	| 'MISS_CORRUPTED'
	| 'MISS_VERSION_MISMATCH'
	| 'MISS_INVALID_PAYLOAD';

export interface MCPCacheStats {
	totalRequests: number;
	hits: number;
	misses: number;
	hitRatio: number;
	lastEventType: MCPCacheEventType | null;
	lastConfigHashExpected?: string;
	lastConfigHashActual?: string;
	missReasonCounts: Record<MCPCacheEventType, number>;
}

export interface MCPCacheHints {
	/** Server-suggested cache TTL in milliseconds */
	ttlMs?: number;
	/** Cache scope: 'connection' | 'server' | 'global' */
	cacheScope?: string;
}

export interface MCPCatalogDiskFormat {
	version: number;
	configHash: string;
	lastUpdate: number;
	servicesInfo: MCPServiceTools[];
	cacheHints?: Record<string, MCPCacheHints>;
}

export class MCPCatalogStore {
	private readonly catalogFilePath: string;
	private stats: MCPCacheStats = {
		totalRequests: 0,
		hits: 0,
		misses: 0,
		hitRatio: 0,
		lastEventType: null,
		missReasonCounts: {
			HIT_DISK_SNAPSHOT: 0,
			MISS_NOT_FOUND: 0,
			MISS_HASH_CHANGED: 0,
			MISS_CORRUPTED: 0,
			MISS_VERSION_MISMATCH: 0,
			MISS_INVALID_PAYLOAD: 0,
		},
	};

	constructor(customFilePath?: string) {
		this.catalogFilePath =
			customFilePath || path.join(getGlobalSnowDir().native, 'mcp-catalog.json');
	}

	getFilePath(): string {
		return this.catalogFilePath;
	}

	getStats(): MCPCacheStats {
		return {
			...this.stats,
			missReasonCounts: {...this.stats.missReasonCounts},
		};
	}

	resetStats(): void {
		this.stats = {
			totalRequests: 0,
			hits: 0,
			misses: 0,
			hitRatio: 0,
			lastEventType: null,
			missReasonCounts: {
				HIT_DISK_SNAPSHOT: 0,
				MISS_NOT_FOUND: 0,
				MISS_HASH_CHANGED: 0,
				MISS_CORRUPTED: 0,
				MISS_VERSION_MISMATCH: 0,
				MISS_INVALID_PAYLOAD: 0,
			},
		};
	}

	private recordEvent(
		type: MCPCacheEventType,
		expectedHash?: string,
		actualHash?: string,
	): void {
		this.stats.totalRequests++;
		this.stats.lastEventType = type;
		this.stats.lastConfigHashExpected = expectedHash;
		this.stats.lastConfigHashActual = actualHash;

		if (type === 'HIT_DISK_SNAPSHOT') {
			this.stats.hits++;
		} else {
			this.stats.misses++;
			this.stats.missReasonCounts[type] =
				(this.stats.missReasonCounts[type] || 0) + 1;
		}

		this.stats.hitRatio =
			this.stats.totalRequests > 0
				? Number((this.stats.hits / this.stats.totalRequests).toFixed(4))
				: 0;
	}

	/**
	 * Load persisted catalog from disk.
	 * Returns null if file is missing, corrupted, or hash does not match expectedHash.
	 */
	load(expectedHash: string): MCPCatalogDiskFormat | null {
		try {
			if (!fs.existsSync(this.catalogFilePath)) {
				this.recordEvent('MISS_NOT_FOUND', expectedHash);
				return null;
			}
			const raw = fs.readFileSync(this.catalogFilePath, 'utf8');
			let data: MCPCatalogDiskFormat;
			try {
				data = JSON.parse(raw) as MCPCatalogDiskFormat;
			} catch (parseErr) {
				log.debug('[MCP] Failed to parse disk catalog JSON:', parseErr);
				this.recordEvent('MISS_CORRUPTED', expectedHash);
				return null;
			}

			if (data.version !== 1) {
				this.recordEvent('MISS_VERSION_MISMATCH', expectedHash);
				return null;
			}

			if (data.configHash !== expectedHash) {
				this.recordEvent('MISS_HASH_CHANGED', expectedHash, data.configHash);
				return null;
			}

			if (!Array.isArray(data.servicesInfo)) {
				this.recordEvent('MISS_INVALID_PAYLOAD', expectedHash);
				return null;
			}

			this.recordEvent('HIT_DISK_SNAPSHOT', expectedHash, data.configHash);
			log.debug('[MCP] Loaded valid external MCP catalog from disk cache');
			return data;
		} catch (error) {
			log.debug('[MCP] Failed to load disk catalog:', error);
			this.recordEvent('MISS_CORRUPTED', expectedHash);
			return null;
		}
	}

	/**
	 * Save valid catalog to disk file safely using atomic rename pattern.
	 * Writes to a unique temporary file first, then atomically renames it.
	 * Guarantees zero partial-write window even if another process reads concurrently or crash occurs.
	 */
	save(catalog: MCPCatalogDiskFormat): void {
		const tempPath = `${this.catalogFilePath}.${process.pid}.${Date.now()}.tmp`;
		try {
			const dir = path.dirname(this.catalogFilePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, {recursive: true});
			}
			const serialized = JSON.stringify(catalog, null, 2);
			fs.writeFileSync(tempPath, serialized, 'utf8');
			fs.renameSync(tempPath, this.catalogFilePath);
			log.debug('[MCP] Atomically saved external MCP catalog to disk cache');
		} catch (error) {
			log.warn('[MCP] Failed to save disk catalog atomically:', error);
			try {
				if (fs.existsSync(tempPath)) {
					fs.unlinkSync(tempPath);
				}
			} catch (e) {
				log.debug('Failed to remove temp catalog file after save error', {
					tempPath,
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
	}

	/**
	 * Invalidate/remove catalog file from disk.
	 */
	clear(): void {
		try {
			if (fs.existsSync(this.catalogFilePath)) {
				fs.unlinkSync(this.catalogFilePath);
			}
		} catch (e) {
			log.debug('Failed to clear catalog file from disk', {
				catalogFilePath: this.catalogFilePath,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}
}

export const mcpCatalogStore = new MCPCatalogStore();
