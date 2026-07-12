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
	const norm1 = normalizeWhitespace(str1);
	const norm2 = normalizeWhitespace(str2);

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

	// Limit each uninterrupted batch by both rows and total matrix cells. A fixed
	// row count can still block the event loop for a long time when lines are wide.
	const rowsPerYield = Math.max(
		1,
		Math.min(batchSize, Math.floor(32_768 / Math.max(1, len2))),
	);

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

		// Yield to the event loop periodically without changing the calculation.
		if (i % rowsPerYield === 0) {
			await new Promise<void>(resolve => setImmediate(resolve));
		}
	}

	return prevRow[len2]!;
}

/**
 * Collapse whitespace to single spaces and trim surrounding whitespace.
 */
export function normalizeWhitespace(content: string): string {
	return content.replace(/\s+/g, ' ').trim();
}

/**
 * Calculate similarity for strings whose whitespace has already been normalized.
 * This avoids re-normalizing the search text and every sliding-window candidate.
 *
 * @param normalizedStr1 First normalized string
 * @param normalizedStr2 Second normalized string
 * @param threshold Similarity threshold for early exit consideration
 * @returns Promise<number> - Similarity value between 0 and 1
 */
export async function calculateNormalizedSimilarityAsync(
	normalizedStr1: string,
	normalizedStr2: string,
	threshold: number = 0,
): Promise<number> {
	const len1 = normalizedStr1.length;
	const len2 = normalizedStr2.length;

	if (len1 === 0) return len2 === 0 ? 1 : 0;
	if (len2 === 0) return 0;

	// Quick length check - if lengths differ too much, similarity can't be above threshold
	const maxLen = Math.max(len1, len2);
	const minLen = Math.min(len1, len2);
	const lengthRatio = minLen / maxLen;
	if (threshold > 0 && lengthRatio < threshold) {
		return lengthRatio; // Can't possibly meet threshold
	}

	const distance = await levenshteinDistanceAsync(
		normalizedStr1,
		normalizedStr2,
		Math.ceil(maxLen * (1 - threshold)),
	);

	return 1 - distance / maxLen;
}

export async function calculateSimilarityAsync(
	str1: string,
	str2: string,
	threshold: number = 0,
): Promise<number> {
	return calculateNormalizedSimilarityAsync(
		normalizeWhitespace(str1),
		normalizeWhitespace(str2),
		threshold,
	);
}

/**
 * Normalize whitespace for display purposes
 * Makes preview more readable by collapsing whitespace
 */
export function normalizeForDisplay(line: string): string {
	return line.replace(/\t/g, ' ').replace(/  +/g, ' ').replace(/\r/g, '');
}
