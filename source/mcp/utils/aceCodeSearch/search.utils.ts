/**
 * Search utilities for ACE Code Search
 */

import {spawn} from 'child_process';
import {EOL} from 'os';
import * as path from 'path';
import type {TextSearchResult} from '../../types/aceCodeSearch.types.js';

/**
 * Check if a command is available in the system PATH
 * @param command - Command to check
 * @returns Promise resolving to true if command is available
 */
export function isCommandAvailable(command: string): Promise<boolean> {
	return new Promise(resolve => {
		try {
			let child;
			if (process.platform === 'win32') {
				// Windows: where is an executable, no shell needed
				child = spawn('where', [command], {
					stdio: 'ignore',
					windowsHide: true,
				});
			} else {
				// Unix/Linux: Use 'which' command instead of 'command -v'
				// 'which' is an external executable, not a shell builtin
				child = spawn('which', [command], {
					stdio: 'ignore',
				});
			}

			child.on('close', code => resolve(code === 0));
			child.on('error', () => resolve(false));
		} catch {
			resolve(false);
		}
	});
}

/**
 * Parse grep output (format: filePath:lineNumber:lineContent)
 * @param output - Grep output string
 * @param basePath - Base path for relative path calculation
 * @returns Array of search results
 */
export function parseGrepOutput(
	output: string,
	basePath: string,
): TextSearchResult[] {
	const results: TextSearchResult[] = [];
	if (!output) return results;

	const lines = output.split(EOL);

	for (const line of lines) {
		if (!line.trim()) continue;

		// Find first and second colon indices
		const firstColonIndex = line.indexOf(':');
		if (firstColonIndex === -1) continue;

		const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
		if (secondColonIndex === -1) continue;

		// Extract parts
		const filePathRaw = line.substring(0, firstColonIndex);
		const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
		const lineContent = line.substring(secondColonIndex + 1);

		const lineNumber = parseInt(lineNumberStr, 10);
		if (isNaN(lineNumber)) continue;

		const absoluteFilePath = path.resolve(basePath, filePathRaw);
		const relativeFilePath = path.relative(basePath, absoluteFilePath);

		results.push({
			filePath: relativeFilePath || path.basename(absoluteFilePath),
			line: lineNumber,
			column: 1, // grep doesn't provide column info, default to 1
			content: lineContent.trim(),
		});
	}

	return results;
}

/**
 * Convert glob pattern to RegExp
 * Supports: *, **, ?, [abc], {js,ts}
 * @param glob - Glob pattern
 * @returns Regular expression
 */
export function globToRegex(glob: string): RegExp {
	// Escape special regex characters except glob wildcards
	let pattern = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
		.replace(/\*\*/g, '<<<DOUBLESTAR>>>') // Temporarily replace **
		.replace(/\*/g, '[^/]*') // * matches anything except /
		.replace(/<<<DOUBLESTAR>>>/g, '.*') // ** matches everything
		.replace(/\?/g, '[^/]'); // ? matches single char except /

	// Handle {js,ts} alternatives
	pattern = pattern.replace(/\\{([^}]+)\\}/g, (_, alternatives) => {
		return '(' + alternatives.split(',').join('|') + ')';
	});

	// Handle [abc] character classes (already valid regex)
	pattern = pattern.replace(/\\\[([^\]]+)\\\]/g, '[$1]');

	return new RegExp(pattern, 'i');
}

/**
 * Calculate fuzzy match score for symbol name
 * @param symbolName - Symbol name to score
 * @param query - Search query
 * @returns Score (0-100, higher is better)
 */
export function calculateFuzzyScore(symbolName: string, query: string): number {
	const nameLower = symbolName.toLowerCase();
	const queryLower = query.toLowerCase();

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
	for (let i = 0; i < nameLower.length && queryIndex < queryLower.length; i++) {
		if (nameLower[i] === queryLower[queryIndex]) {
			score += 20;
			queryIndex++;
		}
	}
	if (queryIndex === queryLower.length) return score;

	return 0;
}

/**
 * Expand glob patterns with braces like "*.{ts,tsx}" into multiple patterns
 * @param glob - Glob pattern with braces
 * @returns Array of expanded patterns
 */
export function expandGlobBraces(glob: string): string[] {
	// Match {a,b,c} pattern
	const braceMatch = glob.match(/^(.+)\{([^}]+)\}(.*)$/);
	if (
		!braceMatch ||
		!braceMatch[1] ||
		!braceMatch[2] ||
		braceMatch[3] === undefined
	) {
		return [glob];
	}

	const prefix = braceMatch[1];
	const alternatives = braceMatch[2].split(',');
	const suffix = braceMatch[3];

	return alternatives.map(alt => `${prefix}${alt}${suffix}`);
}

/**
 * Convert a glob pattern to a RegExp that matches full paths
 * Supports: *, **, ?, {a,b}, [abc]
 * @param globPattern - Glob pattern string
 * @returns Regular expression for matching
 */
export function globPatternToRegex(globPattern: string): RegExp {
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
 * Sort search results by file modification time (recent files first)
 * Files modified within last 24 hours are prioritized
 * @param results - Array of search results
 * @param basePath - Base path for resolving file paths
 * @param recentThreshold - Threshold in milliseconds for recent files
 * @returns Sorted array of search results
 */
export async function sortResultsByRecency(
	results: TextSearchResult[],
	basePath: string,
	recentThreshold: number = 24 * 60 * 60 * 1000,
): Promise<TextSearchResult[]> {
	if (results.length === 0) return results;

	const {promises: fs} = await import('fs');
	const now = Date.now();

	// Get unique file paths
	const uniqueFiles = Array.from(new Set(results.map(r => r.filePath)));

	// Fetch file modification times in parallel using Promise.allSettled
	const statResults = await Promise.allSettled(
		uniqueFiles.map(async filePath => {
			const fullPath = path.resolve(basePath, filePath);
			const stats = await fs.stat(fullPath);
			return {filePath, mtimeMs: stats.mtimeMs};
		}),
	);

	// Build map of file modification times
	const fileModTimes = new Map<string, number>();
	statResults.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			fileModTimes.set(result.value.filePath, result.value.mtimeMs);
		} else {
			// If we can't get stats, treat as old file
			fileModTimes.set(uniqueFiles[index]!, 0);
		}
	});

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
