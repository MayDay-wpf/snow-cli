// Helper function: find word boundaries (space and punctuation)
export function findWordBoundary(
	text: string,
	start: number,
	direction: 'forward' | 'backward',
): number {
	if (direction === 'forward') {
		// Skip current whitespace/punctuation
		let pos = start;
		while (pos < text.length && /[\s\p{P}]/u.test(text[pos] || '')) {
			pos++;
		}
		// Find next whitespace/punctuation
		while (pos < text.length && !/[\s\p{P}]/u.test(text[pos] || '')) {
			pos++;
		}
		return pos;
	} else {
		// Skip current whitespace/punctuation
		let pos = start;
		while (pos > 0 && /[\s\p{P}]/u.test(text[pos - 1] || '')) {
			pos--;
		}
		// Find previous whitespace/punctuation
		while (pos > 0 && !/[\s\p{P}]/u.test(text[pos - 1] || '')) {
			pos--;
		}
		return pos;
	}
}
