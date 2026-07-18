/**
 * Content fingerprint + ordered dedupe for ROLE / AGENTS inject.
 * Policy: inject global + project when both exist; drop later exact duplicates.
 */

/** Normalize for equality: trim, CRLF→LF, collapse blank runs. */
export function normalizeInjectContent(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Stable fingerprint of normalized inject body (not crypto-secure). */
export function contentFingerprint(text: string): string {
	const norm = normalizeInjectContent(text);
	if (!norm) return '';

	// FNV-1a 32-bit + length to keep collisions rare for short rule docs.
	let hash = 0x811c9dc5;
	for (let i = 0; i < norm.length; i++) {
		hash ^= norm.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${norm.length}:${(hash >>> 0).toString(16)}`;
}

export type DedupeItem<T> = T & {content: string};

/**
 * Keep first occurrence of each content fingerprint (discovery order).
 * Empty content is always dropped.
 */
export function dedupeByContentOrder<T extends {content: string}>(
	items: T[],
): {kept: T[]; dropped: T[]} {
	const seen = new Set<string>();
	const kept: T[] = [];
	const dropped: T[] = [];

	for (const item of items) {
		const fp = contentFingerprint(item.content);
		if (!fp) {
			dropped.push(item);
			continue;
		}
		if (seen.has(fp)) {
			dropped.push(item);
			continue;
		}
		seen.add(fp);
		kept.push(item);
	}

	return {kept, dropped};
}

/** True when two bodies are the same after normalize. */
export function isSameInjectContent(a: string, b: string): boolean {
	const fa = contentFingerprint(a);
	const fb = contentFingerprint(b);
	return Boolean(fa) && fa === fb;
}
