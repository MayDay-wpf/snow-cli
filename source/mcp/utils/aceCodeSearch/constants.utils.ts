/**
 * Constants and configuration for ACE Code Search
 */

/**
 * Index cache duration (1 minute)
 */
export const INDEX_CACHE_DURATION = 60000;

/**
 * Batch size for concurrent file processing
 */
export const BATCH_SIZE = 10;

/**
 * Binary file extensions to skip during text search
 * Used to filter out non-text files that cannot be searched
 */
export const BINARY_EXTENSIONS = new Set([
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
]);

/**
 * Directories to exclude in grep searches
 */
export const GREP_EXCLUDE_DIRS = [
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

/**
 * Recent file threshold (24 hours in milliseconds)
 */
export const RECENT_FILE_THRESHOLD = 24 * 60 * 60 * 1000;

/**
 * Maximum cache size for file content cache
 */
export const MAX_FILE_CACHE_SIZE = 50;

/**
 * Maximum cache size for file stat cache
 * Prevents recency sorting cache from growing without bound
 */
export const MAX_FILE_STAT_CACHE_SIZE = 500;

/**
 * Idle lifetime for ACE in-memory caches (2 minutes)
 * Releases symbol indexes and other transient search data when unused
 */
export const ACE_IDLE_CLEANUP_MS = 2 * 60 * 1000;

/**
 * Maximum number of files kept in the semantic symbol index
 * Prevents ace-semantic_search from exhausting memory on very large workspaces
 */
export const MAX_INDEXED_FILES = 2000;

/**
 * Maximum number of symbols indexed per file for semantic search
 * Large generated files can otherwise dominate the in-memory index
 */
export const MAX_SYMBOLS_PER_FILE = 100;

/**
 * Maximum number of unique symbol names used to build the FZF index
 * Above this threshold we fall back to manual scoring to avoid large heap spikes
 */
export const MAX_FZF_SYMBOL_NAMES = 30000;

/**
 * File size threshold for switching to chunked reading (1MB)
 * Files smaller than this are read entirely into memory
 * Files larger than this are processed in chunks to control memory usage
 */
export const LARGE_FILE_THRESHOLD = 1024 * 1024;

/**
 * Chunk size for reading large files (512KB)
 * Balances between memory usage and read efficiency
 */
export const FILE_READ_CHUNK_SIZE = 512 * 1024;

/**
 * Maximum time allowed for text search in milliseconds (30 seconds)
 * Prevents runaway searches on large codebases
 */
export const TEXT_SEARCH_TIMEOUT_MS = 30000;

/**
 * Maximum concurrent file reads during JavaScript fallback search
 * Prevents EMFILE/ENFILE errors on large directories
 */
export const MAX_CONCURRENT_FILE_READS = 20;

/**
 * Maximum regex pattern complexity score (for ReDoS protection)
 * Patterns with higher scores are rejected to prevent catastrophic backtracking
 */
export const MAX_REGEX_COMPLEXITY_SCORE = 100;
