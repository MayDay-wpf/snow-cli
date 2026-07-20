import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import type {Theme} from '../../themes/index.js';
import {formatTokens as sharedFormatTokens} from '../../utils/formatTokens.js';
import {
	loadUsageData,
	filterByPeriod,
	aggregateByModel,
	USAGE_PERIODS,
	type AggregatedStats,
	type UsagePeriod,
} from '../../../utils/core/usageHistory.js';

type Granularity = UsagePeriod;

function getModelShortName(modelName: string, maxLength = 20): string {
	// Extract readable name from model string intelligently
	// Examples:
	// "claude-sonnet-4-5-20250929" -> "Sonnet 4.5"
	// "gpt-4-turbo-2024-04-09" -> "GPT-4 Turbo"
	// "deepseek-chat-v2.5" -> "Deepseek Chat V2.5"
	// "glm-4-plus-20240116" -> "GLM-4 Plus"
	// "qwen2.5-72b-instruct" -> "Qwen2.5 72B"

	let name = modelName;

	// Step 1: Remove common date/version suffixes
	// Remove YYYYMMDD dates
	name = name.replace(/-?\d{8}$/g, '');
	// Remove YYYY-MM-DD dates
	name = name.replace(/-\d{4}-\d{2}-\d{2}$/g, '');
	// Remove trailing version hashes
	name = name.replace(/-[a-f0-9]{7,}$/gi, '');

	// Step 2: Convert version patterns (4-5 -> 4.5, but keep word-number like gpt-4)
	// Only convert digit-digit patterns
	name = name.replace(/(\d)-(\d)/g, '$1.$2');

	// Step 3: Smart parsing based on common patterns
	const parts = name.split(/[-_]/);

	// Filter out common suffixes we don't want
	const stopWords = [
		'instruct',
		'chat',
		'base',
		'turbo',
		'preview',
		'api',
		'model',
	];
	const importantParts: string[] = [];
	const suffixParts: string[] = [];

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part) continue;

		const lower = part.toLowerCase();

		// First part is always important (brand name)
		if (i === 0) {
			importantParts.push(part);
			continue;
		}

		// Version numbers and model tiers are important
		if (/^\d+\.?\d*[a-z]?$/i.test(part) || /^v\d/i.test(part)) {
			importantParts.push(part);
			continue;
		}

		// Size indicators (72b, 7b, etc)
		if (/^\d+[bm]$/i.test(part)) {
			importantParts.push(part.toUpperCase());
			continue;
		}

		// Model names/variants (sonnet, haiku, plus, pro, ultra, etc)
		if (
			lower.match(/^(sonnet|haiku|opus|plus|pro|ultra|mini|nano|max|lite)$/)
		) {
			importantParts.push(part);
			continue;
		}

		// Common suffixes go to end
		if (stopWords.includes(lower)) {
			suffixParts.push(part);
			continue;
		}

		// Everything else goes to important parts (up to 3 parts total)
		if (importantParts.length < 3) {
			importantParts.push(part);
		}
	}

	// Step 4: Format the name
	let result = importantParts
		.map((part, idx) => {
			// First part: capitalize first letter
			if (idx === 0) {
				return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
			}

			// Version numbers and sizes: keep as-is or uppercase
			if (/^\d|^v\d|^\d+[BM]$/i.test(part)) {
				return part;
			}

			// Other parts: capitalize first letter
			return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
		})
		.join(' ');

	// Add important suffix if exists and space allows
	if (
		suffixParts.length > 0 &&
		suffixParts[0] &&
		result.length < maxLength - 5
	) {
		result +=
			' ' +
			suffixParts[0].charAt(0).toUpperCase() +
			suffixParts[0].slice(1).toLowerCase();
	}

	// Step 5: Truncate if too long
	return result.length > maxLength ? result.slice(0, maxLength) : result;
}

function formatTokens(tokens: number, compact = false): string {
	return sharedFormatTokens(tokens, compact);
}

function renderStackedBarChart(
	stats: AggregatedStats,
	terminalWidth: number,
	scrollOffset: number,
	t: any,
	theme: Theme,
) {
	if (stats.models.size === 0) {
		return (
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.usagePanel.chart.noData}
			</Text>
		);
	}

	const sortedModels = Array.from(stats.models.entries()).sort(
		(a, b) => b[1].total - a[1].total,
	);
	const isNarrow = terminalWidth < 100;

	// Show maximum 2 models at a time for better readability
	const maxVisibleModels = 2;

	// Calculate visible range
	const startIdx = scrollOffset;
	const endIdx = Math.min(startIdx + maxVisibleModels, sortedModels.length);
	const visibleModels = sortedModels.slice(startIdx, endIdx);
	const hasMoreAbove = startIdx > 0;
	const hasMoreBelow = endIdx < sortedModels.length;

	// Calculate max total (including cache) for scaling
	const maxTotal = Math.max(
		...Array.from(stats.models.values()).map(
			s => s.total + s.cacheCreation + s.cacheRead,
		),
	);

	// Use almost full width for bars (leave some margin)
	const maxBarWidth = Math.min(isNarrow ? 50 : 70, terminalWidth - 10);

	return (
		<Box flexDirection="column">
			{/* Legend */}
			<Box marginBottom={1}>
				<Text color={theme.colors.menuInfo}>█</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{' '}
					{t.usagePanel.chart.usage}{' '}
				</Text>
				<Text color={theme.colors.success}>█</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{' '}
					{t.usagePanel.chart.cacheHit}{' '}
				</Text>
				<Text color={theme.colors.warning}>█</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{' '}
					{t.usagePanel.chart.cacheCreate}
				</Text>
			</Box>

			{/* Scroll indicator - more above */}
			{hasMoreAbove && (
				<Box marginBottom={1}>
					<Text color={theme.colors.warning} dimColor>
						{t.usagePanel.chart.moreAbove.replace('{count}', String(startIdx))}
					</Text>
				</Box>
			)}

			{visibleModels.map(([modelName, modelStats]) => {
				const shortName = getModelShortName(modelName, 30);

				// Calculate segment lengths based on proportion
				// Ensure at least 1 character if value exists
				const usageLength =
					modelStats.total > 0
						? Math.max(
								1,
								Math.round((modelStats.total / maxTotal) * maxBarWidth),
						  )
						: 0;
				const cacheHitLength =
					modelStats.cacheRead > 0
						? Math.max(
								1,
								Math.round((modelStats.cacheRead / maxTotal) * maxBarWidth),
						  )
						: 0;
				const cacheCreateLength =
					modelStats.cacheCreation > 0
						? Math.max(
								1,
								Math.round((modelStats.cacheCreation / maxTotal) * maxBarWidth),
						  )
						: 0;

				return (
					<Box key={modelName} flexDirection="column" marginBottom={1}>
						{/* Line 1: Model name */}
						<Box>
							<Text bold color={theme.colors.text}>
								{shortName}
							</Text>
						</Box>

						{/* Line 2: Stacked bar chart */}
						<Box>
							{/* Usage segment */}
							{usageLength > 0 && (
								<Text color={theme.colors.menuInfo}>
									{'█'.repeat(usageLength)}
								</Text>
							)}
							{/* Cache hit segment */}
							{cacheHitLength > 0 && (
								<Text color={theme.colors.success}>
									{'█'.repeat(cacheHitLength)}
								</Text>
							)}
							{/* Cache create segment */}
							{cacheCreateLength > 0 && (
								<Text color={theme.colors.warning}>
									{'█'.repeat(cacheCreateLength)}
								</Text>
							)}
						</Box>

						{/* Line 3: Detailed stats */}
						<Box>
							<Text color={theme.colors.menuInfo}>
								{t.usagePanel.chart.usage}{' '}
								{formatTokens(modelStats.total, isNarrow)}
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								{' '}
								({t.usagePanel.chart.in}{' '}
								{formatTokens(modelStats.input, isNarrow)},{' '}
								{t.usagePanel.chart.out}{' '}
								{formatTokens(modelStats.output, isNarrow)})
							</Text>
							{(modelStats.cacheRead > 0 || modelStats.cacheCreation > 0) && (
								<>
									<Text color={theme.colors.menuSecondary} dimColor>
										{' '}
										|{' '}
									</Text>
									{modelStats.cacheRead > 0 && (
										<>
											<Text color={theme.colors.success}>
												{t.usagePanel.chart.hit}{' '}
												{formatTokens(modelStats.cacheRead, isNarrow)}
											</Text>
											{modelStats.cacheCreation > 0 && (
												<Text color={theme.colors.menuSecondary} dimColor>
													,{' '}
												</Text>
											)}
										</>
									)}
									{modelStats.cacheCreation > 0 && (
										<Text color={theme.colors.warning}>
											{t.usagePanel.chart.create}{' '}
											{formatTokens(modelStats.cacheCreation, isNarrow)}
										</Text>
									)}
								</>
							)}
						</Box>
					</Box>
				);
			})}

			{/* Total summary */}
			{sortedModels.length > 1 && (
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.colors.menuSecondary} dimColor>
						{'─'.repeat(Math.min(terminalWidth - 8, 70))}
					</Text>
					<Box>
						<Text bold color={theme.colors.text}>
							{t.usagePanel.chart.total}{' '}
						</Text>
						<Text color={theme.colors.menuInfo} bold>
							{formatTokens(stats.grandTotal)}
						</Text>
						{Array.from(stats.models.values()).reduce(
							(sum, s) => sum + s.cacheRead,
							0,
						) > 0 && (
							<>
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									|{' '}
								</Text>
								<Text color={theme.colors.success} bold>
									{t.usagePanel.chart.hit}{' '}
									{formatTokens(
										Array.from(stats.models.values()).reduce(
											(sum, s) => sum + s.cacheRead,
											0,
										),
									)}
								</Text>
							</>
						)}
						{Array.from(stats.models.values()).reduce(
							(sum, s) => sum + s.cacheCreation,
							0,
						) > 0 && (
							<>
								<Text color={theme.colors.menuSecondary} dimColor>
									,{' '}
								</Text>
								<Text color={theme.colors.warning} bold>
									{t.usagePanel.chart.create}{' '}
									{formatTokens(
										Array.from(stats.models.values()).reduce(
											(sum, s) => sum + s.cacheCreation,
											0,
										),
									)}
								</Text>
							</>
						)}
					</Box>
				</Box>
			)}

			{/* Scroll indicator - more below */}
			{hasMoreBelow && (
				<Box marginTop={1}>
					<Text color={theme.colors.warning} dimColor>
						{t.usagePanel.chart.moreBelow.replace(
							'{count}',
							String(sortedModels.length - endIdx),
						)}
					</Text>
				</Box>
			)}
		</Box>
	);
}

export default function UsagePanel() {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [granularity, setGranularity] = useState<Granularity>('week');
	const [stats, setStats] = useState<AggregatedStats>({
		models: new Map(),
		grandTotal: 0,
	});
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [scrollOffset, setScrollOffset] = useState(0);
	const {columns: terminalWidth} = useTerminalSize();

	const granularityLabels: Record<Granularity, string> = {
		hour: t.usagePanel.granularity.last24h,
		day: t.usagePanel.granularity.last7d,
		week: t.usagePanel.granularity.last30d,
		month: t.usagePanel.granularity.last12m,
	};

	useEffect(() => {
		const load = async () => {
			setIsLoading(true);
			try {
				const entries = await loadUsageData();
				const filtered = filterByPeriod(entries, granularity);
				const aggregated = aggregateByModel(filtered);
				setStats(aggregated);
				setError(null);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : 'Failed to load usage data',
				);
			} finally {
				setIsLoading(false);
			}
		};

		load();
	}, [granularity]);

	// Reset scroll when changing granularity
	useEffect(() => {
		setScrollOffset(0);
	}, [granularity]);

	useInput((_input, key) => {
		if (key.tab) {
			const granularities = USAGE_PERIODS;
			const currentIdx = granularities.indexOf(granularity);
			const nextIdx = (currentIdx + 1) % granularities.length;
			setGranularity(granularities[nextIdx]!);
		}

		// Calculate available space for scrolling
		const sortedModels = Array.from(stats.models.entries()).sort(
			(a, b) => b[1].total - a[1].total,
		);
		const totalModels = sortedModels.length;

		// 循环导航:第一项 → 最后一项,最后一项 → 第一项
		if (key.upArrow) {
			const maxScroll = Math.max(0, totalModels - 1);
			setScrollOffset(prev => (prev > 0 ? prev - 1 : maxScroll));
		}
		if (key.downArrow) {
			// Reserve space for header, legend, total summary
			const maxScroll = Math.max(0, totalModels - 1);
			setScrollOffset(prev => (prev < maxScroll ? prev + 1 : 0));
		}
	});

	if (isLoading) {
		return (
			<Box
				borderColor={theme.colors.menuInfo}
				borderStyle="round"
				paddingX={2}
				paddingY={0}
			>
				<Text color={theme.colors.menuSecondary}>{t.usagePanel.loading}</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box
				borderColor={theme.colors.error}
				borderStyle="round"
				paddingX={2}
				paddingY={0}
			>
				<Text color={theme.colors.error}>
					{t.usagePanel.error.replace('{error}', error)}
				</Text>
			</Box>
		);
	}

	const modelCount = stats.models.size;
	const totalCacheRead = Array.from(stats.models.values()).reduce(
		(sum, s) => sum + s.cacheRead,
		0,
	);
	const totalCacheCreate = Array.from(stats.models.values()).reduce(
		(sum, s) => sum + s.cacheCreation,
		0,
	);
	const totalIO = Array.from(stats.models.values()).reduce(
		(sum, s) => sum + s.input + s.output,
		0,
	);
	const cacheHitPct =
		totalIO + totalCacheRead > 0
			? (totalCacheRead / (totalIO + totalCacheRead)) * 100
			: 0;

	return (
		<Box
			borderColor={theme.colors.menuInfo}
			borderStyle="round"
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color={theme.colors.menuInfo} bold>
					{t.usagePanel.title}
				</Text>
				<Text color={theme.colors.menuSecondary}>
					{' '}
					({granularityLabels[granularity]})
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{' '}
					{t.usagePanel.tabToSwitch}
				</Text>
			</Box>

			{/* Overview summary card */}
			{modelCount > 0 && (
				<Box marginBottom={1} flexDirection="column">
					<Box>
						<Text color={theme.colors.menuInfo} bold>
							{formatTokens(stats.grandTotal)}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{' '}
							{t.usagePanel.overview.total}
						</Text>
						<Text color={theme.colors.menuSecondary}> · </Text>
						<Text color={theme.colors.success}>{cacheHitPct.toFixed(0)}%</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{' '}
							{t.usagePanel.overview.cacheHit}
						</Text>
						{totalCacheCreate > 0 && (
							<>
								<Text color={theme.colors.menuSecondary}> · </Text>
								<Text color={theme.colors.warning}>
									{formatTokens(totalCacheCreate, true)}
								</Text>
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									{t.usagePanel.overview.create}
								</Text>
							</>
						)}
						<Text color={theme.colors.menuSecondary}> · </Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{(modelCount === 1
								? t.usagePanel.overview.models
								: t.usagePanel.overview.modelsPlural
							).replace('{count}', String(modelCount))}
						</Text>
					</Box>
				</Box>
			)}

			{stats.models.size === 0 ? (
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.usagePanel.noDataForPeriod}
				</Text>
			) : (
				renderStackedBarChart(stats, terminalWidth, scrollOffset, t, theme)
			)}
		</Box>
	);
}
