/**
 * Shared token/number formatters for TUI panels and status line.
 */

export function formatTokens(n: number, compact = false): string {
	if (!Number.isFinite(n) || n < 0) return '0';
	if (n >= 1_000_000) {
		return compact
			? `${(n / 1_000_000).toFixed(1)}M`
			: `${(n / 1_000_000).toFixed(2)}M`;
	}
	if (n >= 1000) {
		return compact ? `${Math.round(n / 1000)}k` : `${(n / 1000).toFixed(1)}k`;
	}
	return String(Math.round(n));
}

export function formatTokenBar(
	pct: number,
	width: number,
	fillChar = '█',
	emptyChar = '░',
): string {
	const clamped = Math.max(0, Math.min(100, pct));
	const filled = Math.round((clamped / 100) * width);
	return (
		fillChar.repeat(filled) + emptyChar.repeat(Math.max(0, width - filled))
	);
}

export function pctColorName(
	pct: number,
): 'success' | 'warning' | 'error' {
	if (pct < 50) return 'success';
	if (pct < 90) return 'warning';
	return 'error';
}
