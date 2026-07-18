import type {LoadedSource} from './types.js';

const MIN_KEEP_CHARS = 80;

function clipToRemaining(
	source: LoadedSource,
	remaining: number,
): LoadedSource | null {
	if (remaining < MIN_KEEP_CHARS) {
		return null;
	}
	if (source.chars <= remaining) {
		return source;
	}
	const keep = Math.max(0, remaining - 20);
	const content = source.content.slice(0, keep) + '\n...(truncated)';
	return {
		...source,
		content,
		chars: content.length,
		truncated: true,
	};
}

/**
 * Greedy pack in discovery order (global → root → cwd).
 * Prefer keeping earlier/higher-level files when over budget.
 */
export function applyBudget(
	loaded: LoadedSource[],
	budgetChars: number,
): {
	kept: LoadedSource[];
	dropped: LoadedSource[];
	truncated: boolean;
} {
	if (budgetChars <= 0) {
		return {kept: [], dropped: [...loaded], truncated: loaded.length > 0};
	}

	const kept: LoadedSource[] = [];
	const dropped: LoadedSource[] = [];
	let used = 0;
	let truncated = false;

	for (const source of loaded) {
		const remaining = budgetChars - used;
		if (remaining <= 0) {
			dropped.push(source);
			truncated = true;
			continue;
		}

		const fitted = clipToRemaining(source, remaining);
		if (!fitted) {
			dropped.push(source);
			truncated = true;
			continue;
		}

		if (fitted.truncated || fitted.chars < source.chars) {
			truncated = true;
		}
		kept.push(fitted);
		used += fitted.chars;
	}

	return {kept, dropped, truncated};
}
