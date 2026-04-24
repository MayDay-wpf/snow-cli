import widestLine from 'widest-line';

const MAX_CACHE_SIZE = 2048;
const cache = new Map<string, Output>();

type Output = {
	width: number;
	height: number;
};

const measureText = (text: string): Output => {
	if (text.length === 0) {
		return {
			width: 0,
			height: 0,
		};
	}

	const cachedDimensions = cache.get(text);
	if (cachedDimensions) {
		return cachedDimensions;
	}

	const width = widestLine(text);
	const height = text.split('\n').length;
	const result = {width, height};

	if (cache.size >= MAX_CACHE_SIZE) {
		cache.clear();
	}

	cache.set(text, result);
	return result;
};

export default measureText;
