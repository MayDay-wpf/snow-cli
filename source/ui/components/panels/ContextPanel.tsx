import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {
	buildContextBreakdown,
	type ContextBreakdown,
	type ContextBucket,
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
	if (pct < 75) return theme.colors.warning;
	if (pct < 90) return theme.colors.warning;
	return theme.colors.error;
}

function bucketShare(bucket: ContextBucket, total: number): number {
	if (bucket.displayOnly || total <= 0) return 0;
	return (bucket.tokens / total) * 100;
}

export default function ContextPanel() {
	const {t} = useI18n();
	const {theme} = useTheme();
	const {columns: terminalWidth, rows: terminalHeight} = useTerminalSize();
	const [data, setData] = useState<ContextBreakdown | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({
		role: true,
		agents: true,
	});

	const tp = (t as any).contextPanel || {};

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			try {
				const breakdown = await buildContextBreakdown();
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

	const lines = useMemo(() => {
		if (!data) return [] as Array<{key: string; node: React.ReactNode}>;
		const out: Array<{key: string; node: React.ReactNode}> = [];
		const barWidth = Math.max(12, Math.min(28, terminalWidth - 48));

		for (const bucket of data.buckets) {
			const share = bucketShare(bucket, data.totalEstimatedTokens);
			const ofWindow =
				data.maxContextTokens > 0
					? (bucket.tokens / data.maxContextTokens) * 100
					: 0;
			const color = bucket.displayOnly
				? theme.colors.menuSecondary
				: pctColor(ofWindow, theme);
			const label = (tp.buckets && tp.buckets[bucket.id]) || bucket.label;
			const canExpand = Boolean(bucket.files && bucket.files.length);
			const isOpen = expanded[bucket.id] ?? false;

			out.push({
				key: `b-${bucket.id}`,
				node: (
					<Box key={`b-${bucket.id}`} flexDirection="column">
						<Box>
							<Text color={color} bold>
								{canExpand ? (isOpen ? '▼ ' : '▶ ') : '  '}
								{label.padEnd(22).slice(0, 22)}
							</Text>
							<Text color={color}>
								{bar(bucket.displayOnly ? 0 : share, barWidth)}
							</Text>
							<Text color={color}>
								{' '}
								{formatTokens(bucket.tokens).padStart(6)}
							</Text>
							{!bucket.displayOnly && (
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									{share.toFixed(1)}%
								</Text>
							)}
							{bucket.displayOnly && (
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									{tp.displayOnly || '(in system)'}
								</Text>
							)}
						</Box>
						{bucket.meta && (
							<Text color={theme.colors.menuSecondary} dimColor>
								{'    '}
								{bucket.meta}
							</Text>
						)}
					</Box>
				),
			});

			if (canExpand && isOpen && bucket.files) {
				for (const file of bucket.files) {
					const mark = file.included ? '●' : '○';
					const fileColor = file.included
						? theme.colors.menuInfo
						: theme.colors.menuSecondary;
					out.push({
						key: `f-${bucket.id}-${file.label}`,
						node: (
							<Box key={`f-${bucket.id}-${file.label}`}>
								<Text color={fileColor}>
									{'    '}
									{mark} {file.label}
								</Text>
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									{formatTokens(file.tokens)}
									{file.truncated ? ` ${tp.truncated || '[trunc]'}` : ''}
									{!file.included ? ` ${tp.dropped || '[dropped]'}` : ''}
									{file.note ? ` · ${file.note}` : ''}
								</Text>
							</Box>
						),
					});
				}
			}
		}

		return out;
	}, [data, expanded, terminalWidth, theme, tp]);

	const visibleRows = Math.max(6, Math.min(terminalHeight - 10, 24));

	useInput((input, key) => {
		if (key.upArrow) {
			setScrollOffset(prev => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			setScrollOffset(prev =>
				Math.min(Math.max(0, lines.length - 1), prev + 1),
			);
			return;
		}
		if (input === 'r' || input === 'R') {
			setExpanded(prev => ({
				...prev,
				role: !Boolean(prev['role']),
			}));
			return;
		}
		if (input === 'a' || input === 'A') {
			setExpanded(prev => ({
				...prev,
				agents: !Boolean(prev['agents']),
			}));
			return;
		}
		if (key.tab || input === ' ') {
			// Toggle both file sections
			setExpanded(prev => {
				const nextOpen = !(prev['role'] && prev['agents']);
				return {role: nextOpen, agents: nextOpen};
			});
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
	const windowBarWidth = Math.max(16, Math.min(40, terminalWidth - 30));
	const visible = lines.slice(scrollOffset, scrollOffset + visibleRows);
	const hiddenAbove = scrollOffset;
	const hiddenBelow = Math.max(0, lines.length - scrollOffset - visibleRows);

	return (
		<Box
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			width={Math.min(terminalWidth - 2, 100)}
		>
			<Box marginBottom={1}>
				<Text color={theme.colors.menuInfo} bold>
					{tp.title || 'Context Breakdown'}
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{' '}
					{tp.subtitle || 'system · ROLE · AGENTS · hooks · tools · messages'}
				</Text>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Box>
					<Text color={headerColor} bold>
						{data.percentage.toFixed(1)}%
					</Text>
					<Text color={theme.colors.menuSecondary}>
						{' '}
						{bar(data.percentage, windowBarWidth)}{' '}
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
				<Text color={theme.colors.menuSecondary} dimColor>
					{tp.hint ||
						'Tab/Space toggle files · R ROLE · A AGENTS · ↑↓ scroll · ESC close'}
				</Text>
			</Box>

			{hiddenAbove > 0 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					↑ {hiddenAbove} {tp.moreAbove || 'more above'}
				</Text>
			)}

			{visible.map(item => item.node)}

			{hiddenBelow > 0 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					↓ {hiddenBelow} {tp.moreBelow || 'more below'}
				</Text>
			)}
		</Box>
	);
}
