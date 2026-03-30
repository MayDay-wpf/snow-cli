/**
 * Hashline utilities for content-hash-based line anchoring.
 *
 * Each line of a file is tagged with a short hex hash derived from its content.
 * Models reference these anchors when editing, so they never need to reproduce
 * the original text.  If the file changes between read and edit the hashes will
 * mismatch and the operation is rejected before any damage occurs.
 */

/**
 * Compute a 2-hex-char (8-bit) content hash for a single line.
 * Uses FNV-1a with the full line content (untrimmed) to detect even
 * whitespace-only mutations.
 */
export function lineHash(content: string): string {
	let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
	for (let i = 0; i < content.length; i++) {
		h ^= content.charCodeAt(i);
		h = Math.imul(h, 0x01000193); // FNV-1a 32-bit prime
	}
	return ((h >>> 0) & 0xff).toString(16).padStart(2, '0');
}

/**
 * Format a line for display with its hash anchor.
 *
 * Output: `lineNum:hash→content`
 *
 * @param lineNum - 1-indexed line number
 * @param content - Raw line content (no normalisation)
 */
export function formatLineWithHash(lineNum: number, content: string): string {
	return `${lineNum}:${lineHash(content)}→${content}`;
}

/**
 * Format a line for diff/display with its hash anchor (normalised content).
 *
 * @param lineNum - 1-indexed line number
 * @param rawContent - Original raw content (used to compute hash)
 * @param displayContent - Normalised content shown to the user
 */
export function formatLineWithHashDisplay(
	lineNum: number,
	rawContent: string,
	displayContent: string,
): string {
	return `${lineNum}:${lineHash(rawContent)}→${displayContent}`;
}

// ─── Anchor parsing & validation ────────────────────────────────────

export interface ParsedAnchor {
	lineNum: number;
	hash: string;
}

/**
 * Parse an anchor string of the form `lineNum:hash` (e.g. `42:a3`).
 * Returns null if the format is invalid.
 */
export function parseAnchor(anchor: string): ParsedAnchor | null {
	const m = anchor.match(/^(\d+):([0-9a-f]{2})$/i);
	if (!m) return null;
	return {lineNum: Number(m[1]),	hash: m[2]!.toLowerCase()};
}

/**
 * Validate that an anchor matches the current file content.
 *
 * @returns An object with `valid` (whether hash matches) and `lineNum`.
 *          Returns `valid: false` if the anchor format is bad or the line
 *          number is out of range.
 */
export function validateAnchor(
	anchor: string,
	lines: string[],
): {valid: boolean; lineNum: number; expected?: string; actual?: string} {
	const parsed = parseAnchor(anchor);
	if (!parsed) return {valid: false, lineNum: -1};

	const {lineNum, hash} = parsed;
	if (lineNum < 1 || lineNum > lines.length) {
		return {valid: false, lineNum};
	}

	const actual = lineHash(lines[lineNum - 1]!);
	return {
		valid: actual === hash,
		lineNum,
		expected: hash,
		actual,
	};
}

/**
 * Build a complete hash map for a file (for bulk validation).
 * Returns an array indexed by 0-based line index.
 */
export function buildHashMap(lines: string[]): string[] {
	return lines.map(line => lineHash(line));
}
