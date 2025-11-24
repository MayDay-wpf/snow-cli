/**
 * Similarity calculation utilities for fuzzy matching
 */

/**
 * Calculate similarity between two strings using a smarter algorithm
 * This normalizes whitespace first to avoid false negatives from spacing differences
 * Returns a value between 0 (completely different) and 1 (identical)
 */
export function calculateSimilarity(
	str1: string,
	str2: string,
	threshold: number = 0,
): number {
	// Normalize whitespace for comparison: collapse all whitespace to single spaces
	const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
	const norm1 = normalize(str1);
	const norm2 = normalize(str2);

	const len1 = norm1.length;
	const len2 = norm2.length;

	if (len1 === 0) return len2 === 0 ? 1 : 0;
	if (len2 === 0) return 0;

	// Quick length check - if lengths differ too much, similarity can't be above threshold
	const maxLen = Math.max(len1, len2);
	const minLen = Math.min(len1, len2);
	const lengthRatio = minLen / maxLen;
	if (threshold > 0 && lengthRatio < threshold) {
		return lengthRatio; // Can't possibly meet threshold
	}

	// Use Levenshtein distance for better similarity calculation
	const distance = levenshteinDistance(
		norm1,
		norm2,
		Math.ceil(maxLen * (1 - threshold)),
	);

	return 1 - distance / maxLen;
}

/**
 * Calculate Levenshtein distance between two strings with early termination
 * @param str1 First string
 * @param str2 Second string
 * @param maxDistance Maximum distance to compute (early exit if exceeded)
 * @returns Levenshtein distance, or maxDistance+1 if exceeded
 */
export function levenshteinDistance(
	str1: string,
	str2: string,
	maxDistance: number = Infinity,
): number {
	const len1 = str1.length;
	const len2 = str2.length;

	// Quick exit for identical strings
	if (str1 === str2) return 0;

	// Quick exit if length difference already exceeds maxDistance
	if (Math.abs(len1 - len2) > maxDistance) {
		return maxDistance + 1;
	}

	// Use single-row algorithm to save memory (only need previous row)
	let prevRow: number[] = Array.from({length: len2 + 1}, (_, i) => i);

	for (let i = 1; i <= len1; i++) {
		const currRow: number[] = [i];
		let minInRow = i; // Track minimum value in current row

		for (let j = 1; j <= len2; j++) {
			const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
			const val = Math.min(
				prevRow[j]! + 1, // deletion
				currRow[j - 1]! + 1, // insertion
				prevRow[j - 1]! + cost, // substitution
			);
			currRow[j] = val;
			minInRow = Math.min(minInRow, val);
		}

		// Early termination: if minimum in this row exceeds maxDistance, we can stop
		if (minInRow > maxDistance) {
			return maxDistance + 1;
		}

		prevRow = currRow;
	}

	return prevRow[len2]!;
}

/**
 * Async version of Levenshtein distance - yields to event loop periodically
 * Maintains 100% identical logic to sync version, just with async yielding
 * @param str1 First string
 * @param str2 Second string
 * @param maxDistance Maximum distance to compute (early exit if exceeded)
 * @param batchSize How many rows to process before yielding (default: 50)
 * @returns Promise<Levenshtein distance, or maxDistance+1 if exceeded>
 */
export async function levenshteinDistanceAsync(
	str1: string,
	str2: string,
	maxDistance: number = Infinity,
	batchSize: number = 50,
): Promise<number> {
	const len1 = str1.length;
	const len2 = str2.length;

	// Quick exit for identical strings
	if (str1 === str2) return 0;

	// Quick exit if length difference already exceeds maxDistance
	if (Math.abs(len1 - len2) > maxDistance) {
		return maxDistance + 1;
	}

	// Use single-row algorithm to save memory (only need previous row)
	let prevRow: number[] = Array.from({length: len2 + 1}, (_, i) => i);

	for (let i = 1; i <= len1; i++) {
		const currRow: number[] = [i];
		let minInRow = i; // Track minimum value in current row

		for (let j = 1; j <= len2; j++) {
			const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
			const val = Math.min(
				prevRow[j]! + 1, // deletion
				currRow[j - 1]! + 1, // insertion
				prevRow[j - 1]! + cost, // substitution
			);
			currRow[j] = val;
			minInRow = Math.min(minInRow, val);
		}

		// Early termination: if minimum in this row exceeds maxDistance, we can stop
		if (minInRow > maxDistance) {
			return maxDistance + 1;
		}

		prevRow = currRow;

		// Yield to event loop periodically to prevent UI freeze
		// This maintains the same computation but allows async execution
		if (i % batchSize === 0) {
			await new Promise(resolve => setImmediate(resolve));
		}
	}

	return prevRow[len2]!;
}

/**
 * Async version of calculateSimilarity - preserves 100% precision
 * Uses async Levenshtein distance to prevent UI freeze on large searches
 * @param str1 First string
 * @param str2 Second string
 * @param threshold Similarity threshold for early exit consideration
 * @returns Promise<number> - Similarity value between 0 and 1
 */
export async function calculateSimilarityAsync(
	str1: string,
	str2: string,
	threshold: number = 0,
): Promise<number> {
	// Normalize whitespace for comparison: collapse all whitespace to single spaces
	const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
	const norm1 = normalize(str1);
	const norm2 = normalize(str2);

	const len1 = norm1.length;
	const len2 = norm2.length;

	if (len1 === 0) return len2 === 0 ? 1 : 0;
	if (len2 === 0) return 0;

	// Quick length check - if lengths differ too much, similarity can't be above threshold
	const maxLen = Math.max(len1, len2);
	const minLen = Math.min(len1, len2);
	const lengthRatio = minLen / maxLen;
	if (threshold > 0 && lengthRatio < threshold) {
		return lengthRatio; // Can't possibly meet threshold
	}

	// Use async Levenshtein distance for better similarity calculation
	// This yields to event loop periodically to prevent UI freeze
	const distance = await levenshteinDistanceAsync(
		norm1,
		norm2,
		Math.ceil(maxLen * (1 - threshold)),
	);

	return 1 - distance / maxLen;
}

/**
 * Normalize whitespace for display purposes
 * Makes preview more readable by collapsing whitespace
 */
export function normalizeForDisplay(line: string): string {
	return line.replace(/\t/g, ' ').replace(/  +/g, ' ');
}
