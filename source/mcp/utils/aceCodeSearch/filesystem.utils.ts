/**
 * Filesystem utilities for ACE Code Search
 */

import {promises as fs} from 'fs';
import * as path from 'path';

/**
 * Default exclusion directories
 */
export const DEFAULT_EXCLUDES = [
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

/**
 * Check if a directory should be excluded based on exclusion patterns
 * @param dirName - Directory name
 * @param fullPath - Full path to directory
 * @param basePath - Base path for relative path calculation
 * @param customExcludes - Custom exclusion patterns
 * @param regexCache - Cache for compiled regex patterns
 * @returns True if directory should be excluded
 */
export function shouldExcludeDirectory(
	dirName: string,
	fullPath: string,
	basePath: string,
	customExcludes: string[],
	regexCache: Map<string, RegExp>,
): boolean {
	// Check default excludes
	if (DEFAULT_EXCLUDES.includes(dirName)) {
		return true;
	}

	// Check hidden directories
	if (dirName.startsWith('.')) {
		return true;
	}

	// Check custom exclusion patterns
	const relativePath = path.relative(basePath, fullPath);
	for (const pattern of customExcludes) {
		// Simple pattern matching: exact match or glob-style wildcards
		if (pattern.includes('*')) {
			// Use cached regex to avoid recompilation
			let regex = regexCache.get(pattern);
			if (!regex) {
				const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
				regex = new RegExp(`^${regexPattern}$`);
				regexCache.set(pattern, regex);
			}
			if (regex.test(relativePath) || regex.test(dirName)) {
				return true;
			}
		} else {
			// Exact match
			if (
				relativePath === pattern ||
				dirName === pattern ||
				relativePath.startsWith(pattern + '/')
			) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Check if a file should be excluded based on exclusion patterns
 * @param fileName - File name
 * @param fullPath - Full path to file
 * @param basePath - Base path for relative path calculation
 * @param customExcludes - Custom exclusion patterns
 * @param regexCache - Cache for compiled regex patterns
 * @returns True if file should be excluded
 */
export function shouldExcludeFile(
	fileName: string,
	fullPath: string,
	basePath: string,
	customExcludes: string[],
	regexCache: Map<string, RegExp>,
): boolean {
	// Skip most hidden files (starting with .)
	// But allow common config files
	if (fileName.startsWith('.')) {
		const allowedHiddenFiles = [
			'.env',
			'.gitignore',
			'.eslintrc',
			'.prettierrc',
			'.babelrc',
			'.editorconfig',
			'.npmrc',
			'.yarnrc',
		];
		const isAllowedConfig = allowedHiddenFiles.some(
			allowed =>
				fileName === allowed ||
				fileName.startsWith(allowed + '.') ||
				fileName.endsWith('rc.js') ||
				fileName.endsWith('rc.json') ||
				fileName.endsWith('rc.yaml') ||
				fileName.endsWith('rc.yml'),
		);
		if (!isAllowedConfig) {
			return true;
		}
	}

	// Check custom exclusion patterns from .gitignore/.snowignore
	const relativePath = path.relative(basePath, fullPath);
	for (const pattern of customExcludes) {
		// Skip directory-only patterns (ending with /)
		if (pattern.endsWith('/')) {
			continue;
		}

		// Pattern matching: exact match or glob-style wildcards
		if (pattern.includes('*')) {
			// Use cached regex to avoid recompilation
			let regex = regexCache.get(pattern);
			if (!regex) {
				const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
				regex = new RegExp(`^${regexPattern}$`);
				regexCache.set(pattern, regex);
			}
			if (regex.test(relativePath) || regex.test(fileName)) {
				return true;
			}
		} else {
			// Exact match for file name or relative path
			if (relativePath === pattern || fileName === pattern) {
				return true;
			}
			// Check if file matches path prefix pattern
			if (relativePath.startsWith(pattern + '/')) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Load custom exclusion patterns from .gitignore and .snowignore
 * @param basePath - Base path to search for ignore files
 * @returns Array of exclusion patterns
 */
export async function loadExclusionPatterns(
	basePath: string,
): Promise<string[]> {
	const patterns: string[] = [];

	// Load .gitignore if exists
	const gitignorePath = path.join(basePath, '.gitignore');
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
	const snowignorePath = path.join(basePath, '.snowignore');
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

	return patterns;
}

/**
 * Read file with LRU cache to reduce repeated file system access
 * @param filePath - Path to file
 * @param fileContentCache - Cache for file contents
 * @param maxCacheSize - Maximum cache size
 * @returns File content
 */
export async function readFileWithCache(
	filePath: string,
	fileContentCache: Map<string, {content: string; mtime: number}>,
	maxCacheSize: number = 50,
): Promise<string> {
	const stats = await fs.stat(filePath);
	const mtime = stats.mtimeMs;

	// Check cache
	const cached = fileContentCache.get(filePath);
	if (cached && cached.mtime === mtime) {
		return cached.content;
	}

	// Read file
	const content = await fs.readFile(filePath, 'utf-8');

	// Manage cache size (simple LRU: remove oldest if over limit)
	if (fileContentCache.size >= maxCacheSize) {
		const firstKey = fileContentCache.keys().next().value;
		if (firstKey) {
			fileContentCache.delete(firstKey);
		}
	}

	// Cache the content
	fileContentCache.set(filePath, {content, mtime});

	return content;
}

/**
 * Check if a directory is a Git repository
 * @param directory - Directory path to check
 * @returns True if directory contains .git folder
 */
export async function isGitRepository(
	directory: string = process.cwd(),
): Promise<boolean> {
	try {
		const gitDir = path.join(directory, '.git');
		const stats = await fs.stat(gitDir);
		return stats.isDirectory();
	} catch {
		return false;
	}
}
