import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {
	buildContextBreakdown,
	type ContextBreakdown,
	type ContextBucket,
	type ContextBucketId,
	type ContextCategory,
	type ContextCategoryId,
} from '../../../utils/core/contextBreakdown.js';

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function bar(
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

/** Dot-grid visualization similar to the screenshot reference. */
function dotGrid(
	categories: ContextCategory[],
	totalDots: number,
): Array<{id: ContextCategoryId; char: string}> {
	const dots: Array<{id: ContextCategoryId; char: string}> = [];
	const usable = categories.filter(c => c.tokens > 0 || c.synthetic);
	let assigned = 0;
	for (let i = 0; i < usable.length; i++) {
		const cat = usable[i]!;
		const isLast = i === usable.length - 1;
		const count = isLast
			? Math.max(0, totalDots - assigned)
			: Math.max(
					cat.percentage > 0 ? 1 : 0,
					Math.round((cat.percentage / 100) * totalDots),
			  );
		const capped = Math.min(count, totalDots - assigned);
		for (let d = 0; d < capped; d++) {
			dots.push({id: cat.id, char: '●'});
		}
		assigned += capped;
		if (assigned >= totalDots) break;
	}
	while (dots.length < totalDots) {
		dots.push({id: 'free', char: '○'});
	}
	return dots;
}

function pctColor(
	pct: number,
	theme: {colors: {success: string; warning: string; error: string}},
): string {
	if (pct < 50) return theme.colors.success;
	if (pct < 90) return theme.colors.warning;
	return theme.colors.error;
}

function categoryColor(
	id: ContextCategoryId,
	theme: {
		colors: {
			success: string;
			warning: string;
			error: string;
			menuInfo: string;
			menuSecondary: string;
			cyan: string;
			diffModified: string;
		};
	},
): string {
	switch (id) {
		case 'system':
			return theme.colors.menuInfo;
		case 'tools':
			return theme.colors.cyan;
		case 'memory':
			return theme.colors.warning;
		case 'skills':
			return theme.colors.diffModified || theme.colors.menuInfo;
		case 'messages':
			return theme.colors.success;
		case 'free':
			return theme.colors.menuSecondary;
		case 'autocompact':
			return theme.colors.warning;
		default:
			return theme.colors.menuSecondary;
	}
}

function pad(text: string, width: number): string {
	if (text.length >= width) return text.slice(0, width);
	return text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
	if (text.length >= width) return text.slice(0, width);
	return ' '.repeat(width - text.length) + text;
}

type Row =
	| {
			kind: 'category';
			key: string;
			category: ContextCategory;
			canExpand: boolean;
	  }
	| {
			kind: 'bucket';
			key: string;
			bucket: ContextBucket;
			canExpand: boolean;
	  }
	| {
			kind: 'file';
			key: string;
			bucketId: ContextBucketId;
			label: string;
			tokens: number;
			included: boolean;
			truncated?: boolean;
			note?: string;
	  }
	| {
			kind: 'meta';
			key: string;
			text: string;
	  };

export default function ContextPanel() {
	const {t} = useI18n();
	const {theme} = useTheme();
	const {columns: terminalWidth, rows: terminalHeight} = useTerminalSize();
	const [data, setData] = useState<ContextBreakdown | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [cursor, setCursor] = useState(0);
	// Only show selection cursor after user presses keys (view-first UX)
	const [navActive, setNavActive] = useState(false);
	const [scrollOffset, setScrollOffset] = useState(0);
	// Default: collapsed summary (screenshot style). Expand on demand.
	const [expanded, setExpanded] = useState<Record<string, boolean>>({
		system: false,
		role: false,
		agents: false,
		hooks: false,
		tools: false,
		skills: false,
		messages: false,
		// category-level expand keys
		'cat-system': false,
		'cat-tools': false,
		'cat-memory': false,
		'cat-skills': false,
		'cat-messages': false,
	});

	const tp = (t as any).contextPanel || {};

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			try {
				// Fast estimate by default for snappy open
				const breakdown = await buildContextBreakdown({precise: false});
				if (!cancelled) {
					setData(breakdown);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const bucketById = useMemo(() => {
		const map = new Map<ContextBucketId, ContextBucket>();
		if (!data) return map;
		for (const b of data.buckets) map.set(b.id, b);
		return map;
	}, [data]);

	const rows: Row[] = useMemo(() => {
		if (!data) return [];
		const out: Row[] = [];

		for (const category of data.categories) {
			const sourceIds = category.sourceBucketIds || [];
			const canExpand =
				!category.synthetic &&
				sourceIds.some(id => {
					const b = bucketById.get(id);
					return Boolean(b && ((b.files && b.files.length > 0) || b.meta));
				});
			out.push({
				kind: 'category',
				key: `c-${category.id}`,
				category,
				canExpand,
			});

			const catOpen = expanded[`cat-${category.id}`] ?? false;
			if (!canExpand || !catOpen) continue;

			for (const bucketId of sourceIds) {
				const bucket = bucketById.get(bucketId);
				if (!bucket) continue;
				const bucketCanExpand = Boolean(
					bucket.files && bucket.files.length > 0,
				);
				out.push({
					kind: 'bucket',
					key: `b-${bucket.id}`,
					bucket,
					canExpand: bucketCanExpand,
				});

				const isOpen = expanded[bucket.id] ?? false;
				if (bucketCanExpand && isOpen && bucket.files) {
					if (bucket.meta) {
						out.push({
							kind: 'meta',
							key: `m-${bucket.id}`,
							text: bucket.meta,
						});
					}
					for (const file of bucket.files) {
						out.push({
							kind: 'file',
							key: `f-${bucket.id}-${file.label}`,
							bucketId: bucket.id,
							label: file.label,
							tokens: file.tokens,
							included: file.included,
							truncated: file.truncated,
							note: file.note,
						});
					}
				} else if (!isOpen && bucket.meta) {
					out.push({
						kind: 'meta',
						key: `m-${bucket.id}-closed`,
						text: bucket.meta + (bucket.detail ? ` · ${bucket.detail}` : ''),
					});
				}
			}
		}
		return out;
	}, [data, expanded, bucketById]);

	// Keep cursor in range when rows change
	useEffect(() => {
		if (cursor >= rows.length) {
			setCursor(Math.max(0, rows.length - 1));
		}
	}, [rows.length, cursor]);

	const panelWidth = Math.min(Math.max(terminalWidth - 4, 56), 96);
	const labelWidth = 22;
	const tokenWidth = 8;
	const pctWidth = 7;

	// Header takes ~10 lines (title + model + grid + footer); leave room for hint
	const visibleRows = Math.max(8, Math.min(terminalHeight - 16, 22));

	// Keep cursor visible in scroll window only when navigating
	useEffect(() => {
		if (!navActive) return;
		if (cursor < scrollOffset) setScrollOffset(cursor);
		else if (cursor >= scrollOffset + visibleRows) {
			setScrollOffset(cursor - visibleRows + 1);
		}
	}, [cursor, scrollOffset, visibleRows, navActive]);

	const toggleKey = (id: string) => {
		setExpanded(prev => ({
			...prev,
			[id]: !Boolean(prev[id]),
		}));
	};

	const expandAll = (open: boolean) => {
		if (!data) return;
		const next: Record<string, boolean> = {};
		for (const c of data.categories) {
			if (!c.synthetic) next[`cat-${c.id}`] = open;
		}
		for (const b of data.buckets) {
			if (b.files && b.files.length > 0) next[b.id] = open;
		}
		setExpanded(prev => ({...prev, ...next}));
	};

	useInput((input, key) => {
		const activateNav = () => {
			if (!navActive) setNavActive(true);
		};

		if (key.upArrow) {
			activateNav();
			setCursor(prev => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			activateNav();
			setCursor(prev => Math.min(Math.max(0, rows.length - 1), prev + 1));
			return;
		}
		if (key.return || input === ' ') {
			if (!navActive) {
				const firstExpandable = rows.find(
					r =>
						(r.kind === 'category' && r.canExpand) ||
						(r.kind === 'bucket' && r.canExpand),
				);
				if (firstExpandable?.kind === 'category') {
					toggleKey(`cat-${firstExpandable.category.id}`);
				} else if (firstExpandable?.kind === 'bucket') {
					toggleKey(firstExpandable.bucket.id);
				}
				return;
			}
			const row = rows[cursor];
			if (!row) return;
			if (row.kind === 'category' && row.canExpand) {
				toggleKey(`cat-${row.category.id}`);
			} else if (row.kind === 'bucket' && row.canExpand) {
				toggleKey(row.bucket.id);
			} else if (row.kind === 'file') {
				toggleKey(row.bucketId);
			}
			return;
		}
		if (input === 'a' || input === 'A') {
			expandAll(true);
			return;
		}
		if (input === 'c' || input === 'C') {
			expandAll(false);
			return;
		}
		if (key.tab) {
			const anyOpen = Object.values(expanded).some(Boolean);
			expandAll(!anyOpen);
		}
	});

	if (loading) {
		return (
			<Box borderStyle="round" borderColor={theme.colors.menuInfo} paddingX={2}>
				<Text color={theme.colors.menuSecondary}>
					{tp.loading || 'Loading context usage…'}
				</Text>
			</Box>
		);
	}

	if (error || !data) {
		return (
			<Box borderStyle="round" borderColor={theme.colors.error} paddingX={2}>
				<Text color={theme.colors.error}>
					{(tp.error || 'Failed: {error}').replace(
						'{error}',
						error || 'unknown',
					)}
				</Text>
			</Box>
		);
	}

	const headerColor = pctColor(data.percentage, theme);
	const windowBarWidth = Math.max(16, Math.min(panelWidth - 28, 40));
	const visible = rows.slice(scrollOffset, scrollOffset + visibleRows);
	const hiddenAbove = scrollOffset;
	const hiddenBelow = Math.max(0, rows.length - scrollOffset - visibleRows);

	const estimateLabel =
		data.estimateMode === 'precise'
			? tp.precise || 'precise'
			: tp.estimate || 'estimate';

	const gridCols = Math.min(20, Math.max(12, Math.floor((panelWidth - 6) / 2)));
	const gridRows = 4;
	const gridDots = dotGrid(data.categories, gridCols * gridRows);

	const categoryLabel = (cat: ContextCategory) => {
		const fromI18n = tp.categories?.[cat.id];
		if (fromI18n) return fromI18n;
		return cat.label;
	};

	const bucketLabel = (bucket: ContextBucket) => {
		return (tp.buckets && tp.buckets[bucket.id]) || bucket.label;
	};

	return (
		<Box
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			width={panelWidth}
		>
			{/* Title */}
			<Box>
				<Text color={theme.colors.menuInfo} bold>
					/context
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{'  '}
					{tp.title || 'Context Usage'}
					{'  '}[{estimateLabel}]
				</Text>
			</Box>

			{/* Model + used/max */}
			<Box marginTop={1}>
				<Text color={theme.colors.menuInfo} bold>
					{data.modelName}
				</Text>
			</Box>
			<Box>
				<Text color={headerColor} bold>
					{formatTokens(data.totalEstimatedTokens)}/
					{formatTokens(data.maxContextTokens)} tokens
				</Text>
				<Text color={headerColor}>
					{'  '}({data.percentage.toFixed(0)}%)
				</Text>
			</Box>
			<Box>
				<Text color={headerColor}>{bar(data.percentage, windowBarWidth)}</Text>
			</Box>

			{/* Dot grid */}
			<Box marginTop={1} flexDirection="column">
				{Array.from({length: gridRows}, (_, rowIdx) => (
					<Box key={`grid-row-${rowIdx}`}>
						{gridDots
							.slice(rowIdx * gridCols, rowIdx * gridCols + gridCols)
							.map((dot, colIdx) => (
								<Text
									key={`d-${rowIdx}-${colIdx}`}
									color={categoryColor(dot.id, theme)}
								>
									{dot.char}{' '}
								</Text>
							))}
					</Box>
				))}
			</Box>

			{typeof data.apiPromptTokens === 'number' && (
				<Text color={theme.colors.menuSecondary} dimColor>
					{(tp.apiLast || 'Last API prompt') + ': '}
					{formatTokens(data.apiPromptTokens)}
					{typeof data.apiPercentage === 'number'
						? ` (${data.apiPercentage.toFixed(1)}%)`
						: ''}
				</Text>
			)}

			{/* Category legend header */}
			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{tp.estimatedByCategory || 'Estimated usage by category'}
				</Text>
			</Box>

			{hiddenAbove > 0 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					↑ {hiddenAbove} {tp.moreAbove || 'more above'}
				</Text>
			)}

			{visible.map((row, i) => {
				const absIndex = scrollOffset + i;
				const selected = navActive && absIndex === cursor;
				const marker = selected ? '›' : ' ';

				if (row.kind === 'meta') {
					return (
						<Box key={row.key}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{marker} {row.text}
							</Text>
						</Box>
					);
				}

				if (row.kind === 'file') {
					const mark = row.included ? '●' : '○';
					const fileColor = row.included
						? selected
							? theme.colors.menuInfo
							: theme.colors.menuSecondary
						: theme.colors.menuSecondary;
					const suffix = [
						row.tokens > 0 ? formatTokens(row.tokens) : '',
						row.truncated ? tp.truncated || '[trunc]' : '',
						!row.included ? tp.dropped || '[dropped]' : '',
						row.note || '',
					]
						.filter(Boolean)
						.join(' · ');
					return (
						<Box key={row.key}>
							<Text color={fileColor} bold={selected}>
								{marker} {mark} {row.label}
							</Text>
							{suffix ? (
								<Text color={theme.colors.menuSecondary} dimColor>
									{'  '}
									{suffix}
								</Text>
							) : null}
						</Box>
					);
				}

				if (row.kind === 'bucket') {
					const bucket = row.bucket;
					const isOpen = expanded[bucket.id] ?? false;
					const chevron = row.canExpand ? (isOpen ? '▼' : '▶') : ' ';
					const color = bucket.displayOnly
						? theme.colors.menuSecondary
						: selected
						? theme.colors.menuInfo
						: theme.colors.menuSecondary;
					return (
						<Box key={row.key}>
							<Text color={color} bold={selected}>
								{marker} {chevron} {bucketLabel(bucket)}
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								{'  '}
								{formatTokens(bucket.tokens)}
								{bucket.displayOnly ? ` · ${tp.displayOnly || 'in sys'}` : ''}
							</Text>
						</Box>
					);
				}

				// category row (screenshot-style)
				const cat = row.category;
				const color = selected
					? theme.colors.menuInfo
					: categoryColor(cat.id, theme);
				const isOpen = expanded[`cat-${cat.id}`] ?? false;
				const chevron = row.canExpand ? (isOpen ? '▼' : '▶') : ' ';
				const icon =
					cat.id === 'free' ? '○' : cat.id === 'autocompact' ? '◌' : '●';

				return (
					<Box key={row.key}>
						<Text color={color} bold={selected || !cat.synthetic}>
							{marker}
							{chevron} {icon} {pad(categoryLabel(cat), labelWidth - 4)}
						</Text>
						<Text color={color}>
							{padLeft(formatTokens(cat.tokens), tokenWidth)}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{' '}
							{padLeft(`${cat.percentage.toFixed(1)}%`, pctWidth)}
						</Text>
					</Box>
				);
			})}

			{hiddenBelow > 0 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					↓ {hiddenBelow} {tp.moreBelow || 'more below'}
				</Text>
			)}

			{/* Footer: auto-compact window */}
			<Box marginTop={1} flexDirection="column">
				<Text color={theme.colors.menuSecondary} dimColor>
					{(tp.autoCompactWindow || 'Auto-compact window') + ': '}
					{formatTokens(data.maxContextTokens)} tokens
					{data.enableAutoCompress
						? ` · threshold ${data.autoCompressThreshold}%`
						: ` · ${tp.autoCompressOff || 'off'}`}
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{tp.hint ||
						'↑↓ select · Enter/Space expand · A all · C collapse · ESC close'}
				</Text>
			</Box>
		</Box>
	);
}
