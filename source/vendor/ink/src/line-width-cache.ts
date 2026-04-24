import widestLine from 'widest-line';

const cache = new Map<string, number>();
const MAX_CACHE_SIZE = 4096;

export function cachedWidestLine(text: string): number {
	const cached = cache.get(text);
	if (cached !== undefined) return cached;

	const width = widestLine(text);

	if (cache.size >= MAX_CACHE_SIZE) {
		cache.clear();
	}

	cache.set(text, width);
	return width;
}
