import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';

import {
	aggregateByModel,
	filterByPeriod,
	loadUsageData,
	parseUsagePeriod,
} from '../utils/core/usageHistory.js';

const test = anyTest as unknown as TestFn;

test('usage history skips invalid identities and normalizes unsafe token counts', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-usage-history-'));
	const dateDir = path.join(root, '2026-07-16');
	await fs.mkdir(dateDir, {recursive: true});
	await fs.writeFile(
		path.join(dateDir, 'usage.jsonl'),
		[
			'{"model":" model-a ","profileName":"","inputTokens":10,"outputTokens":5,"timestamp":"2026-07-16T00:00:00.000Z"}',
			'{"model":"model-a","profileName":"default","inputTokens":-20,"outputTokens":1e999,"cacheReadInputTokens":-1,"timestamp":"2026-07-16T01:00:00.000Z"}',
			'{"model":"","inputTokens":99,"outputTokens":99,"timestamp":"2026-07-16T02:00:00.000Z"}',
			'{"model":"model-b","inputTokens":99,"outputTokens":99,"timestamp":"not-a-date"}',
		].join('\n'),
		'utf8',
	);

	try {
		const entries = await loadUsageData(root);
		t.is(entries.length, 2);
		t.deepEqual(entries[0], {
			model: 'model-a',
			profileName: 'default',
			inputTokens: 10,
			outputTokens: 5,
			timestamp: '2026-07-16T00:00:00.000Z',
		});
		t.is(entries[1]?.inputTokens, 0);
		t.is(entries[1]?.outputTokens, 0);
		t.is(entries[1]?.cacheReadInputTokens, 0);

		const totals = aggregateByModel(entries);
		t.is(totals.grandTotal, 15);
		t.is(totals.models.get('model-a')?.total, 15);
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
});

test('usage period parser accepts documented aliases', t => {
	t.deepEqual(parseUsagePeriod('24h'), {ok: true, period: 'hour'});
	t.deepEqual(parseUsagePeriod('7d'), {ok: true, period: 'day'});
	t.deepEqual(parseUsagePeriod('30d'), {ok: true, period: 'week'});
	t.deepEqual(parseUsagePeriod('12m'), {ok: true, period: 'month'});
	t.false(parseUsagePeriod('century').ok);
});

test('usage rolling windows exclude future timestamps', t => {
	const now = new Date('2026-07-16T12:00:00.000Z');
	const entries = [
		{
			model: 'model-a',
			profileName: 'default',
			inputTokens: 1,
			outputTokens: 1,
			timestamp: '2026-07-16T11:00:00.000Z',
		},
		{
			model: 'model-a',
			profileName: 'default',
			inputTokens: 10,
			outputTokens: 10,
			timestamp: '2026-07-17T12:00:00.000Z',
		},
	];

	t.deepEqual(filterByPeriod(entries, 'hour', now), [entries[0]]);
});
