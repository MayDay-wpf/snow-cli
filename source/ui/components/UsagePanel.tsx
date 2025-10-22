import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';

interface UsageLogEntry {
	model: string;
	profileName: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	timestamp: string;
}

interface ModelStats {
	input: number;
	output: number;
	cacheCreation: number;
	cacheRead: number;
	total: number;
}

interface AggregatedStats {
	models: Map<string, ModelStats>;
	grandTotal: number;
}

type Granularity = 'hour' | 'day' | 'week' | 'month';

const GRANULARITY_LABELS: Record<Granularity, string> = {
	hour: 'Last 24h',
	day: 'Last 7d',
	week: 'Last 30d',
	month: 'Last 12m',
};

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

async function loadUsageData(): Promise<UsageLogEntry[]> {
	const homeDir = os.homedir();
	const usageDir = path.join(homeDir, '.snow', 'usage');

	try {
		const entries: UsageLogEntry[] = [];
		const dateDirs = await fs.readdir(usageDir);

		for (const dateDir of dateDirs) {
			const datePath = path.join(usageDir, dateDir);
			const stats = await fs.stat(datePath);

			if (!stats.isDirectory()) continue;

			const files = await fs.readdir(datePath);

			for (const file of files) {
				if (!file.endsWith('.jsonl')) continue;

				const filePath = path.join(datePath, file);
				const content = await fs.readFile(filePath, 'utf-8');
				const lines = content
					.trim()
					.split('\n')
					.filter(l => l.trim());

				for (const line of lines) {
					try {
						const entry = JSON.parse(line) as UsageLogEntry;
						entries.push(entry);
					} catch {
						// Skip invalid lines
					}
				}
			}
		}

		return entries.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);
	} catch (error) {
		return [];
	}
}

function filterByGranularity(
	entries: UsageLogEntry[],
	granularity: Granularity,
): UsageLogEntry[] {
	if (entries.length === 0) return [];

	const now = new Date();
	const cutoff = new Date(now);

	switch (granularity) {
		case 'hour':
			cutoff.setHours(now.getHours() - 24);
			break;
		case 'day':
			cutoff.setDate(now.getDate() - 7);
			break;
		case 'week':
			cutoff.setDate(now.getDate() - 30);
			break;
		case 'month':
			cutoff.setMonth(now.getMonth() - 12);
			break;
	}

	return entries.filter(e => new Date(e.timestamp) >= cutoff);
}

function aggregateByModel(entries: UsageLogEntry[]): AggregatedStats {
	const models = new Map<string, ModelStats>();
	let grandTotal = 0;

	for (const entry of entries) {
		const modelName = entry.model;

		if (!models.has(modelName)) {
			models.set(modelName, {
				input: 0,
				output: 0,
				cacheCreation: 0,
				cacheRead: 0,
				total: 0,
			});
		}

		const stats = models.get(modelName)!;
		stats.input += entry.inputTokens;
		stats.output += entry.outputTokens;
		stats.cacheCreation += entry.cacheCreationInputTokens || 0;
		stats.cacheRead += entry.cacheReadInputTokens || 0;
		stats.total += entry.inputTokens + entry.outputTokens;

		grandTotal += entry.inputTokens + entry.outputTokens;
	}

	return {models, grandTotal};
}

function formatTokens(tokens: number, compact = false): string {
	if (tokens >= 1000000) {
		return compact
			? `${(tokens / 1000000).toFixed(1)}M`
			: `${(tokens / 1000000).toFixed(2)}M`;
	}
	if (tokens >= 1000) {
		return compact
			? `${Math.round(tokens / 1000)}K`
			: `${(tokens / 1000).toFixed(1)}K`;
	}
	return String(tokens);
}

function renderStackedBarChart(stats: AggregatedStats, terminalWidth: number) {
	if (stats.models.size === 0) {
		return (
			<Text color="gray" dimColor>
				No data available
			</Text>
		);
	}

	const sortedModels = Array.from(stats.models.entries()).sort(
		(a, b) => b[1].total - a[1].total,
	);
	const isNarrow = terminalWidth < 100;

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
				<Text color="cyan">█</Text>
				<Text color="gray" dimColor>
					{' '}
					Usage{' '}
				</Text>
				<Text color="green">█</Text>
				<Text color="gray" dimColor>
					{' '}
					Cache Hit{' '}
				</Text>
				<Text color="yellow">█</Text>
				<Text color="gray" dimColor>
					{' '}
					Cache Create
				</Text>
			</Box>

			{sortedModels.map(([modelName, modelStats]) => {
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
							<Text bold color="white">
								{shortName}
							</Text>
						</Box>

						{/* Line 2: Stacked bar chart */}
						<Box>
							{/* Usage segment (cyan) */}
							{usageLength > 0 && (
								<Text color="cyan">{'█'.repeat(usageLength)}</Text>
							)}
							{/* Cache hit segment (green) */}
							{cacheHitLength > 0 && (
								<Text color="green">{'█'.repeat(cacheHitLength)}</Text>
							)}
							{/* Cache create segment (yellow) */}
							{cacheCreateLength > 0 && (
								<Text color="yellow">{'█'.repeat(cacheCreateLength)}</Text>
							)}
						</Box>

						{/* Line 3: Detailed stats */}
						<Box>
							<Text color="cyan">
								Usage: {formatTokens(modelStats.total, isNarrow)}
							</Text>
							<Text color="gray" dimColor>
								{' '}
								(In: {formatTokens(modelStats.input, isNarrow)}, Out:{' '}
								{formatTokens(modelStats.output, isNarrow)})
							</Text>
							{(modelStats.cacheRead > 0 || modelStats.cacheCreation > 0) && (
								<>
									<Text color="gray" dimColor>
										{' '}
										|{' '}
									</Text>
									{modelStats.cacheRead > 0 && (
										<>
											<Text color="green">
												Hit: {formatTokens(modelStats.cacheRead, isNarrow)}
											</Text>
											{modelStats.cacheCreation > 0 && (
												<Text color="gray" dimColor>
													,{' '}
												</Text>
											)}
										</>
									)}
									{modelStats.cacheCreation > 0 && (
										<Text color="yellow">
											Create: {formatTokens(modelStats.cacheCreation, isNarrow)}
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
					<Text color="gray" dimColor>
						{'─'.repeat(Math.min(terminalWidth - 8, 70))}
					</Text>
					<Box>
						<Text bold color="white">
							TOTAL:{' '}
						</Text>
						<Text color="cyan" bold>
							{formatTokens(stats.grandTotal)}
						</Text>
						{Array.from(stats.models.values()).reduce(
							(sum, s) => sum + s.cacheRead,
							0,
						) > 0 && (
							<>
								<Text color="gray" dimColor>
									{' '}
									|{' '}
								</Text>
								<Text color="green" bold>
									Hit:{' '}
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
								<Text color="gray" dimColor>
									,{' '}
								</Text>
								<Text color="yellow" bold>
									Create:{' '}
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
		</Box>
	);
}

export default function UsagePanel() {
	const [granularity, setGranularity] = useState<Granularity>('week');
	const [stats, setStats] = useState<AggregatedStats>({
		models: new Map(),
		grandTotal: 0,
	});
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const {columns: terminalWidth} = useTerminalSize();

	useEffect(() => {
		const load = async () => {
			setIsLoading(true);
			try {
				const entries = await loadUsageData();
				const filtered = filterByGranularity(entries, granularity);
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

	useInput((_input, key) => {
		if (key.tab) {
			const granularities: Granularity[] = ['hour', 'day', 'week', 'month'];
			const currentIdx = granularities.indexOf(granularity);
			const nextIdx = (currentIdx + 1) % granularities.length;
			setGranularity(granularities[nextIdx]!);
		}
	});

	if (isLoading) {
		return (
			<Box borderColor="cyan" borderStyle="round" paddingX={2} paddingY={0}>
				<Text color="gray">Loading usage statistics...</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box borderColor="red" borderStyle="round" paddingX={2} paddingY={0}>
				<Text color="red">Error: {error}</Text>
			</Box>
		);
	}

	return (
		<Box
			borderColor="cyan"
			borderStyle="round"
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color="cyan" bold>
					Token Usage Statistics
				</Text>
				<Text color="gray"> ({GRANULARITY_LABELS[granularity]})</Text>
				<Text color="gray" dimColor>
					{' '}
					- Tab to switch
				</Text>
			</Box>

			{stats.models.size === 0 ? (
				<Text color="gray" dimColor>
					No usage data for this period
				</Text>
			) : (
				renderStackedBarChart(stats, terminalWidth)
			)}
		</Box>
	);
}
