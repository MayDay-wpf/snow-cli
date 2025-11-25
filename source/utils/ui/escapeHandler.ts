/**
 * Escape Handler Utility
 * Handles escape sequence issues in AI-generated content
 * Based on Gemini CLI's approach to handle common LLM escaping bugs
 */

/**
 * Unescapes a string that might have been overly escaped by an LLM.
 * Common issues:
 * - "\\n" should be "\n" (newline)
 * - "\\t" should be "\t" (tab)
 * - "\\`" should be "`" (backtick)
 * - "\\\\" should be "\\" (single backslash)
 * - "\\"Hello\\"" should be "\"Hello\"" (quotes)
 *
 * @param inputString - The potentially over-escaped string from AI
 * @returns The unescaped string
 *
 * @example
 * unescapeString("console.log(\\"Hello\\\\n\\")")
 * // Returns: console.log("Hello\n")
 *
 * unescapeString("const msg = \`Hello \\`\${name}\\`\`")
 * // Returns: const msg = `Hello `${name}``
 */
export function unescapeString(inputString: string): string {
	// Regex explanation:
	// \\+ : Matches one or more literal backslash characters
	// (n|t|r|'|"|`|\\|\n) : Capturing group that matches:
	//   n, t, r : Literal characters for escape sequences
	//   ', ", ` : Quote characters
	//   \\ : Literal backslash
	//   \n : Actual newline character
	// g : Global flag to replace all occurrences

	return inputString.replace(
		/\\+(n|t|r|'|"|`|\\|\n)/g,
		(match, capturedChar) => {
			// 'match' is the entire erroneous sequence, e.g., "\\n" or "\\\\`"
			// 'capturedChar' is the character that determines the true meaning

			switch (capturedChar) {
				case 'n':
					return '\n'; // Newline character
				case 't':
					return '\t'; // Tab character
				case 'r':
					return '\r'; // Carriage return
				case "'":
					return "'"; // Single quote
				case '"':
					return '"'; // Double quote
				case '`':
					return '`'; // Backtick
				case '\\':
					return '\\'; // Single backslash
				case '\n':
					return '\n'; // Clean newline (handles "\\\n" cases)
				default:
					// Fallback: return original match if unexpected character
					return match;
			}
		},
	);
}

/**
 * Checks if a string appears to be over-escaped by comparing it with its unescaped version
 *
 * @param inputString - The string to check
 * @returns True if the string contains escape sequences that would be modified by unescapeString
 *
 * @example
 * isOverEscaped("console.log(\\"Hello\\")") // Returns: true
 * isOverEscaped("console.log(\"Hello\")") // Returns: false
 */
export function isOverEscaped(inputString: string): boolean {
	return unescapeString(inputString) !== inputString;
}

/**
 * Counts occurrences of a substring in a string
 * Used to verify if unescaping helps find the correct match
 *
 * @param str - The string to search in
 * @param substr - The substring to search for
 * @returns Number of occurrences found
 */
export function countOccurrences(str: string, substr: string): number {
	if (substr === '') {
		return 0;
	}

	let count = 0;
	let pos = str.indexOf(substr);
	while (pos !== -1) {
		count++;
		pos = str.indexOf(substr, pos + substr.length);
	}

	return count;
}

/**
 * Attempts to fix a search string that doesn't match by trying unescaping
 * This is a lightweight, non-LLM approach to handle common escaping issues
 *
 * @param fileContent - The content of the file to search in
 * @param searchString - The search string that failed to match
 * @param expectedOccurrences - Expected number of matches (default: 1)
 * @returns Object with corrected string and match count, or null if correction didn't help
 *
 * @example
 * const fixed = tryUnescapeFix(fileContent, "console.log(\\"Hello\\")", 1);
 * if (fixed) {
 *   // Use fixed.correctedString for the search
 * }
 */
export function tryUnescapeFix(
	fileContent: string,
	searchString: string,
	expectedOccurrences: number = 1,
): {correctedString: string; occurrences: number} | null {
	// Check if the string appears to be over-escaped
	if (!isOverEscaped(searchString)) {
		return null;
	}

	// Try unescaping
	const unescaped = unescapeString(searchString);

	// Count occurrences with unescaped version
	const occurrences = countOccurrences(fileContent, unescaped);

	// Return result if it matches expected occurrences
	if (occurrences === expectedOccurrences) {
		return {
			correctedString: unescaped,
			occurrences,
		};
	}

	return null;
}

/**
 * Smart trimming that preserves the relationship between paired strings
 * If trimming the target string results in the expected number of matches,
 * also trim the paired string to maintain consistency
 *
 * @param targetString - The string to potentially trim
 * @param pairedString - The paired string (e.g., replacement content)
 * @param fileContent - The file content to search in
 * @param expectedOccurrences - Expected number of matches
 * @returns Object with potentially trimmed strings
 */
export function trimPairIfPossible(
	targetString: string,
	pairedString: string,
	fileContent: string,
	expectedOccurrences: number = 1,
): {target: string; paired: string} {
	const trimmedTarget = targetString.trim();

	// If trimming doesn't change the string, return as-is
	if (targetString.length === trimmedTarget.length) {
		return {target: targetString, paired: pairedString};
	}

	// Check if trimmed version matches expected occurrences
	const trimmedOccurrences = countOccurrences(fileContent, trimmedTarget);

	if (trimmedOccurrences === expectedOccurrences) {
		return {
			target: trimmedTarget,
			paired: pairedString.trim(),
		};
	}

	// Trimming didn't help, return original
	return {target: targetString, paired: pairedString};
}
