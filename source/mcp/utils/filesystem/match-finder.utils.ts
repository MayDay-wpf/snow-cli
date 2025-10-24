/**
 * Match finding utilities for fuzzy search
 */

import type {MatchCandidate} from '../../types/filesystem.types.js';
import {calculateSimilarity, normalizeForDisplay} from './similarity.utils.js';

/**
 * Find the closest matching candidates in the file content
 * Returns top N candidates sorted by similarity
 * Optimized with safe pre-filtering and early exit
 * ASYNC to prevent terminal freeze during search
 */
export async function findClosestMatches(
	searchContent: string,
	fileLines: string[],
	topN: number = 3,
): Promise<MatchCandidate[]> {
	const searchLines = searchContent.split('\n');
	const candidates: MatchCandidate[] = [];

	// Fast pre-filter: use first line as anchor (only for multi-line searches)
	const searchFirstLine = searchLines[0]?.replace(/\s+/g, ' ').trim() || '';
	const threshold = 0.5;
	const usePreFilter = searchLines.length >= 5; // Only for 5+ line searches
	const preFilterThreshold = 0.2; // Very conservative - only skip completely unrelated lines

	// Try to find candidates by sliding window with optimizations
	const maxCandidates = topN * 3; // Collect more candidates, then pick best
	const YIELD_INTERVAL = 100; // Yield control every 100 iterations

	for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
		// Yield control periodically to prevent UI freeze
		if (i % YIELD_INTERVAL === 0) {
			await new Promise(resolve => setTimeout(resolve, 0));
		}

		// Quick pre-filter: check first line similarity (only for multi-line)
		if (usePreFilter) {
			const firstLineCandidate =
				fileLines[i]?.replace(/\s+/g, ' ').trim() || '';
			const firstLineSimilarity = calculateSimilarity(
				searchFirstLine,
				firstLineCandidate,
				preFilterThreshold,
			);

			// Skip only if first line is very different
			if (firstLineSimilarity < preFilterThreshold) {
				continue;
			}
		}

		// Full candidate check
		const candidateLines = fileLines.slice(i, i + searchLines.length);
		const candidateContent = candidateLines.join('\n');

		const similarity = calculateSimilarity(
			searchContent,
			candidateContent,
			threshold,
		);

		// Only consider candidates with >50% similarity
		if (similarity > threshold) {
			candidates.push({
				startLine: i + 1,
				endLine: i + searchLines.length,
				similarity,
				preview: candidateLines
					.map((line, idx) => `${i + idx + 1}→${normalizeForDisplay(line)}`)
					.join('\n'),
			});

			// Early exit if we found a nearly perfect match
			if (similarity >= 0.95) {
				break;
			}

			// Limit candidates to avoid excessive computation
			if (candidates.length >= maxCandidates) {
				break;
			}
		}
	}

	// Sort by similarity descending and return top N
	return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}

/**
 * Generate a helpful diff message showing differences between search and actual content
 * Note: This is ONLY for display purposes. Tabs/spaces are normalized for better readability.
 */
export function generateDiffMessage(
	searchContent: string,
	actualContent: string,
	maxLines: number = 10,
): string {
	const searchLines = searchContent.split('\n');
	const actualLines = actualContent.split('\n');
	const diffLines: string[] = [];

	const maxLen = Math.max(searchLines.length, actualLines.length);

	for (let i = 0; i < Math.min(maxLen, maxLines); i++) {
		const searchLine = searchLines[i] || '';
		const actualLine = actualLines[i] || '';

		if (searchLine !== actualLine) {
			diffLines.push(`Line ${i + 1}:`);
			diffLines.push(
				`  Search: ${JSON.stringify(normalizeForDisplay(searchLine))}`,
			);
			diffLines.push(
				`  Actual: ${JSON.stringify(normalizeForDisplay(actualLine))}`,
			);
		}
	}

	if (maxLen > maxLines) {
		diffLines.push(`... (${maxLen - maxLines} more lines)`);
	}

	return diffLines.join('\n');
}
