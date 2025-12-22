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
