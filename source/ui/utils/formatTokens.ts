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
		return `${(n / 1000).toFixed(1)}k`;
	}
	return String(Math.round(n));
}

export function pctColorName(pct: number): 'success' | 'warning' | 'error' {
	if (pct < 50) return 'success';
	if (pct < 90) return 'warning';
	return 'error';
}
