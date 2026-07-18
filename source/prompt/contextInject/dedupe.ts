/**
 * AGENTS source dedupe:
 * 1) drop later sources with identical body (global → root → cwd)
 * 2) drop sources whose body already appears in ROLE inject
 */

import {
	contentFingerprint,
	dedupeByContentOrder,
} from '../shared/contentDedupe.js';
import type {LoadedSource} from './types.js';

export function dedupeLoadedSources(
	loaded: LoadedSource[],
	roleFingerprints?: Set<string>,
): {kept: LoadedSource[]; dropped: LoadedSource[]} {
	const {kept: unique, dropped: contentDupes} = dedupeByContentOrder(loaded);

	if (!roleFingerprints || roleFingerprints.size === 0) {
		return {kept: unique, dropped: contentDupes};
	}

	const kept: LoadedSource[] = [];
	const dropped = [...contentDupes];

	for (const source of unique) {
		const fp = contentFingerprint(source.content);
		if (fp && roleFingerprints.has(fp)) {
			dropped.push(source);
			continue;
		}
		kept.push(source);
	}

	return {kept, dropped};
}
