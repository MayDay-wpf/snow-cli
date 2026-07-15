/**
 * Shared usage history load/aggregate helpers for TUI /usage panel and headless usage.
 * Data lives under ~/.snow/usage/YYYY-MM-DD/*.jsonl (append-only, compatible across versions).
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface UsageLogEntry {
	model: string;
	profileName: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	timestamp: string;
}

export interface ModelStats {
	input: number;
	output: number;
	cacheCreation: number;
	cacheRead: number;
	total: number;
}

export interface AggregatedStats {
	models: Map<string, ModelStats>;
	grandTotal: number;
}

/** Rolling-window granularity keys (same as UsagePanel Tab cycle). */
export type UsagePeriod = 'hour' | 'day' | 'week' | 'month';

/** Human-readable rolling windows corresponding to UsagePeriod. */
export type UsageWindow =
	| 'last_24h'
	| 'last_7d'
	| 'last_30d'
	| 'last_12m';

export const USAGE_PERIODS: readonly UsagePeriod[] = [
	'hour',
	'day',
	'week',
	'month',
] as const;

export const USAGE_PERIOD_WINDOWS: Record<UsagePeriod, UsageWindow> = {
	hour: 'last_24h',
	day: 'last_7d',
	week: 'last_30d',
	month: 'last_12m',
};

export const DEFAULT_USAGE_PERIOD: UsagePeriod = 'week';

/** Aliases accepted by headless `usage --period=...`. */
const PERIOD_ALIASES: Record<string, UsagePeriod> = {
	hour: 'hour',
	h: 'hour',
	'24h': 'hour',
	last24h: 'hour',
	last_24h: 'hour',
	day: 'day',
	d: 'day',
	'7d': 'day',
	last7d: 'day',
	last_7d: 'day',
	week: 'week',
	w: 'week',
	'30d': 'week',
	last30d: 'week',
	last_30d: 'week',
	month: 'month',
	m: 'month',
	'12m': 'month',
	last12m: 'month',
	last_12m: 'month',
};

export function isUsagePeriod(value: string): value is UsagePeriod {
	return (USAGE_PERIODS as readonly string[]).includes(value);
}

/**
 * Parse a period token from CLI/agent args.
 * Accepts: hour|day|week|month and aliases like 24h, 7d, 30d, 12m, last_30d.
 */
export function parseUsagePeriod(
	raw?: string | null,
):
	| {ok: true; period: UsagePeriod}
	| {ok: false; message: string} {
	const token = (raw ?? '').trim().toLowerCase();
	if (!token) {
		return {ok: true, period: DEFAULT_USAGE_PERIOD};
	}
	const mapped = PERIOD_ALIASES[token];
	if (!mapped) {
		return {
			ok: false,
			message:
				'Invalid period. Use hour|day|week|month (aliases: 24h, 7d, 30d, 12m).',
		};
	}
	return {ok: true, period: mapped};
}

export function getUsageRootDir(homeDir: string = os.homedir()): string {
	return path.join(homeDir, '.snow', 'usage');
}

/**
 * Load all usage log entries under ~/.snow/usage (or custom root).
 * Invalid JSONL lines are skipped for forward/backward compatibility.
 */
export async function loadUsageData(
	usageRootDir: string = getUsageRootDir(),
): Promise<UsageLogEntry[]> {
	try {
		const entries: UsageLogEntry[] = [];
		const dateDirs = await fs.readdir(usageRootDir);

		for (const dateDir of dateDirs) {
			const datePath = path.join(usageRootDir, dateDir);
			let stats;
			try {
				stats = await fs.stat(datePath);
			} catch {
				continue;
			}
			if (!stats.isDirectory()) continue;

			const files = await fs.readdir(datePath);
			for (const file of files) {
				if (!file.endsWith('.jsonl')) continue;
				const filePath = path.join(datePath, file);
				let content: string;
				try {
					content = await fs.readFile(filePath, 'utf-8');
				} catch {
					continue;
				}
				const lines = content
					.trim()
					.split('\n')
					.filter(l => l.trim());

				for (const line of lines) {
					try {
						const entry = JSON.parse(line) as UsageLogEntry;
						if (
							!entry ||
							typeof entry.timestamp !== 'string' ||
							typeof entry.model !== 'string'
						) {
							continue;
						}
						entries.push({
							model: entry.model,
							profileName:
								typeof entry.profileName === 'string'
									? entry.profileName
									: 'default',
							inputTokens: Number(entry.inputTokens) || 0,
							outputTokens: Number(entry.outputTokens) || 0,
							...(entry.cacheCreationInputTokens !== undefined && {
								cacheCreationInputTokens:
									Number(entry.cacheCreationInputTokens) || 0,
							}),
							...(entry.cacheReadInputTokens !== undefined && {
								cacheReadInputTokens:
									Number(entry.cacheReadInputTokens) || 0,
							}),
							timestamp: entry.timestamp,
						});
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
	} catch {
		return [];
	}
}

export function filterByPeriod(
	entries: UsageLogEntry[],
	period: UsagePeriod,
	now: Date = new Date(),
): UsageLogEntry[] {
	if (entries.length === 0) return [];

	const cutoff = new Date(now);
	switch (period) {
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

/** @deprecated Prefer filterByPeriod — kept for call-site clarity during migration. */
export function filterByGranularity(
	entries: UsageLogEntry[],
	granularity: UsagePeriod,
	now?: Date,
): UsageLogEntry[] {
	return filterByPeriod(entries, granularity, now);
}

export function aggregateByModel(entries: UsageLogEntry[]): AggregatedStats {
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

export interface UsageHistoryModelRow {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	totalTokens: number;
}

export interface UsageHistorySnapshot {
	period: UsagePeriod;
	window: UsageWindow;
	/** ISO timestamp of the aggregation "now". */
	asOf: string;
	entryCount: number;
	grandTotal: number;
	totalCacheReadTokens: number;
	totalCacheCreationTokens: number;
	models: UsageHistoryModelRow[];
}

export function toHistorySnapshot(
	stats: AggregatedStats,
	period: UsagePeriod,
	entryCount: number,
	asOf: Date = new Date(),
): UsageHistorySnapshot {
	const models: UsageHistoryModelRow[] = Array.from(stats.models.entries())
		.map(([model, m]) => ({
			model,
			inputTokens: m.input,
			outputTokens: m.output,
			cacheCreationInputTokens: m.cacheCreation,
			cacheReadInputTokens: m.cacheRead,
			totalTokens: m.total,
		}))
		.sort((a, b) => b.totalTokens - a.totalTokens);

	const totalCacheReadTokens = models.reduce(
		(sum, m) => sum + m.cacheReadInputTokens,
		0,
	);
	const totalCacheCreationTokens = models.reduce(
		(sum, m) => sum + m.cacheCreationInputTokens,
		0,
	);

	return {
		period,
		window: USAGE_PERIOD_WINDOWS[period],
		asOf: asOf.toISOString(),
		entryCount,
		grandTotal: stats.grandTotal,
		totalCacheReadTokens,
		totalCacheCreationTokens,
		models,
	};
}

/**
 * Load + filter + aggregate usage history for a rolling period.
 */
export async function getUsageHistorySnapshot(
	period: UsagePeriod = DEFAULT_USAGE_PERIOD,
	options?: {
		usageRootDir?: string;
		now?: Date;
	},
): Promise<UsageHistorySnapshot> {
	const now = options?.now ?? new Date();
	const entries = await loadUsageData(options?.usageRootDir);
	const filtered = filterByPeriod(entries, period, now);
	const aggregated = aggregateByModel(filtered);
	return toHistorySnapshot(aggregated, period, filtered.length, now);
}
