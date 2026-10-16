import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {
	parseUsagePeriod,
	aggregateByModel,
	filterByPeriod,
	loadUsageData,
	toHistorySnapshot,
	type UsageLogEntry,
} from '../../../utils/core/usageHistory.js';

test('parseUsagePeriod parses period keys and aliases', t => {
	t.deepEqual(parseUsagePeriod('hour'), {ok: true, period: 'hour'});
	t.deepEqual(parseUsagePeriod('24h'), {ok: true, period: 'hour'});
	t.deepEqual(parseUsagePeriod('7d'), {ok: true, period: 'day'});
	t.deepEqual(parseUsagePeriod('last30d'), {ok: true, period: 'week'});
	t.deepEqual(parseUsagePeriod('12m'), {ok: true, period: 'month'});
	t.deepEqual(parseUsagePeriod(''), {ok: true, period: 'week'}); // default
	t.false(parseUsagePeriod('invalid-period').ok);
});

test('aggregateByModel correctly sums tokens across models', t => {
	const entries: UsageLogEntry[] = [
		{
			model: 'claude-3-5-sonnet',
			profileName: 'default',
			inputTokens: 100,
			outputTokens: 50,
			cacheCreationInputTokens: 20,
			cacheReadInputTokens: 10,
			timestamp: new Date().toISOString(),
		},
		{
			model: 'claude-3-5-sonnet',
			profileName: 'default',
			inputTokens: 200,
			outputTokens: 100,
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
			timestamp: new Date().toISOString(),
		},
		{
			model: 'gpt-4o',
			profileName: 'openai',
			inputTokens: 50,
			outputTokens: 25,
			timestamp: new Date().toISOString(),
		},
	];

	const agg = aggregateByModel(entries);
	t.is(agg.grandTotal, 525);
	const sonnet = agg.models.get('claude-3-5-sonnet');
	t.truthy(sonnet);
	t.is(sonnet?.input, 300);
	t.is(sonnet?.output, 150);
	t.is(sonnet?.cacheCreation, 20);
	t.is(sonnet?.cacheRead, 10);
	t.is(sonnet?.total, 450);

	const snapshot = toHistorySnapshot(agg, 'week', entries.length);
	t.is(snapshot.period, 'week');
	t.is(snapshot.entryCount, 3);
	t.is(snapshot.models.length, 2);
	t.is(snapshot.models[0]?.model, 'claude-3-5-sonnet');
});

test('filterByPeriod and loadUsageData handle files correctly', async t => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-usage-'));
	try {
		const dayDir = path.join(tempDir, '2026-10-15');
		await fs.mkdir(dayDir, {recursive: true});

		const now = new Date('2026-10-15T12:00:00Z');
		const recentEntry: UsageLogEntry = {
			model: 'test-model',
			profileName: 'default',
			inputTokens: 10,
			outputTokens: 5,
			timestamp: '2026-10-15T10:00:00Z',
		};
		const oldEntry: UsageLogEntry = {
			model: 'test-model',
			profileName: 'default',
			inputTokens: 10,
			outputTokens: 5,
			timestamp: '2026-09-01T10:00:00Z',
		};

		await fs.writeFile(
			path.join(dayDir, 'session1.jsonl'),
			`${JSON.stringify(recentEntry)}\n${JSON.stringify(oldEntry)}\n`,
			'utf-8',
		);

		const loaded = await loadUsageData(tempDir);
		t.is(loaded.length, 2);

		const filtered = filterByPeriod(loaded, 'day', now);
		t.is(filtered.length, 1);
		t.is(filtered[0]?.timestamp, '2026-10-15T10:00:00Z');
	} finally {
		await fs.rm(tempDir, {recursive: true, force: true});
	}
});
