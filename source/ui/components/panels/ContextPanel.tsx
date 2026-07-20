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

function pctColor(
	pct: number,
	theme: {colors: {success: string; warning: string; error: string}},
): string {
	if (pct < 50) return theme.colors.success;
	if (pct < 90) return theme.colors.warning;
	return theme.colors.error;
}

function bucketShare(bucket: ContextBucket, total: number): number {
	if (bucket.displayOnly || total <= 0) return 0;
	return (bucket.tokens / total) * 100;
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
	// Default expand AGENTS/tools/ROLE so pure viewing shows content
	const [expanded, setExpanded] = useState<Record<string, boolean>>({
		agents: true,
		tools: true,
		role: true,
		system: false,
		hooks: false,
		messages: false,
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

	const rows: Row[] = useMemo(() => {
		if (!data) return [];
		const out: Row[] = [];
		for (const bucket of data.buckets) {
			const canExpand = Boolean(bucket.files && bucket.files.length > 0);
			out.push({
				kind: 'bucket',
				key: `b-${bucket.id}`,
				bucket,
				canExpand,
			});
			const isOpen = expanded[bucket.id] ?? false;
			if (canExpand && isOpen && bucket.files) {
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
			}
		}
		return out;
	}, [data, expanded]);

	// Keep cursor in range when rows change
	useEffect(() => {
		if (cursor >= rows.length) {
			setCursor(Math.max(0, rows.length - 1));
		}
	}, [rows.length, cursor]);

	const panelWidth = Math.min(Math.max(terminalWidth - 4, 56), 96);
	const labelWidth = 20;
	const tokenWidth = 7;
	const pctWidth = 7;
	const barWidth = Math.max(
		10,
		Math.min(28, panelWidth - labelWidth - tokenWidth - pctWidth - 10),
	);

	// Header takes ~6 lines; leave room for footer hint
	const visibleRows = Math.max(8, Math.min(terminalHeight - 12, 22));

	// Keep cursor visible in scroll window only when navigating
	useEffect(() => {
		if (!navActive) return;
		if (cursor < scrollOffset) setScrollOffset(cursor);
		else if (cursor >= scrollOffset + visibleRows) {
			setScrollOffset(cursor - visibleRows + 1);
		}
	}, [cursor, scrollOffset, visibleRows, navActive]);

	const toggleBucket = (id: string) => {
		setExpanded(prev => ({
			...prev,
			[id]: !Boolean(prev[id]),
		}));
	};

	const expandAll = (open: boolean) => {
		if (!data) return;
		const next: Record<string, boolean> = {};
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
			// Without prior navigation: toggle the first expandable bucket under viewport
			if (!navActive) {
				const firstExpandable = rows.find(
					r => r.kind === 'bucket' && r.canExpand,
				);
				if (firstExpandable && firstExpandable.kind === 'bucket') {
					toggleBucket(firstExpandable.bucket.id);
				}
				return;
			}
			const row = rows[cursor];
			if (!row) return;
			if (row.kind === 'bucket' && row.canExpand) {
				toggleBucket(row.bucket.id);
			} else if (row.kind === 'file') {
				toggleBucket(row.bucketId);
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
			// Toggle all expandable sections
			const anyOpen = data?.buckets.some(
				b => (b.files?.length ?? 0) > 0 && (expanded[b.id] ?? false),
			);
			expandAll(!anyOpen);
		}
	});

	if (loading) {
		return (
			<Box borderStyle="round" borderColor={theme.colors.menuInfo} paddingX={2}>
				<Text color={theme.colors.menuSecondary}>
					{tp.loading || 'Loading context breakdown…'}
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
					{tp.title || 'Context Breakdown'}
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{'  '}[{estimateLabel}]
				</Text>
			</Box>

			{/* Window usage */}
			<Box marginTop={1}>
				<Text color={headerColor} bold>
					{padLeft(data.percentage.toFixed(1) + '%', 6)}
				</Text>
				<Text color={headerColor}> {bar(data.percentage, windowBarWidth)}</Text>
				<Text color={theme.colors.menuSecondary}>
					{' '}
					{formatTokens(data.totalEstimatedTokens)} /{' '}
					{formatTokens(data.maxContextTokens)}
				</Text>
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

			{/* Column header */}
			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{pad(tp.colBucket || 'Bucket', labelWidth)} {pad('', barWidth)}{' '}
					{padLeft(tp.colTokens || 'Tokens', tokenWidth)}{' '}
					{padLeft(tp.colShare || 'Share', pctWidth)}
				</Text>
			</Box>
			<Text color={theme.colors.menuSecondary} dimColor>
				{'─'.repeat(
					Math.min(
						panelWidth - 4,
						labelWidth + barWidth + tokenWidth + pctWidth + 4,
					),
				)}
			</Text>

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

				// bucket row
				const bucket = row.bucket;
				const share = bucketShare(bucket, data.totalEstimatedTokens);
				const ofWindow =
					data.maxContextTokens > 0
						? (bucket.tokens / data.maxContextTokens) * 100
						: 0;
				const color = bucket.displayOnly
					? theme.colors.menuSecondary
					: selected
					? theme.colors.menuInfo
					: pctColor(ofWindow, theme);
				const label = (tp.buckets && tp.buckets[bucket.id]) || bucket.label;
				const isOpen = expanded[bucket.id] ?? false;
				const chevron = row.canExpand ? (isOpen ? '▼' : '▶') : ' ';
				const shareText = bucket.displayOnly
					? tp.displayOnly || 'in sys'
					: `${share.toFixed(1)}%`;

				return (
					<Box key={row.key} flexDirection="column">
						<Box>
							<Text color={color} bold={selected || !bucket.displayOnly}>
								{marker}
								{chevron} {pad(label, labelWidth - 2)}
							</Text>
							<Text color={color}>
								{bar(bucket.displayOnly ? 0 : share, barWidth)}
							</Text>
							<Text color={color}>
								{' '}
								{padLeft(formatTokens(bucket.tokens), tokenWidth)}
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								{' '}
								{padLeft(shareText, pctWidth)}
							</Text>
						</Box>
						{/* Compact meta under closed buckets only when not expanded */}
						{!isOpen && bucket.meta && (
							<Text color={theme.colors.menuSecondary} dimColor>
								{'    '}
								{bucket.meta}
								{bucket.detail ? ` · ${bucket.detail}` : ''}
							</Text>
						)}
					</Box>
				);
			})}

			{hiddenBelow > 0 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					↓ {hiddenBelow} {tp.moreBelow || 'more below'}
				</Text>
			)}

			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{tp.hint ||
						'↑↓ select · Enter/Space expand · A all · C collapse · ESC close'}
				</Text>
			</Box>
		</Box>
	);
}
