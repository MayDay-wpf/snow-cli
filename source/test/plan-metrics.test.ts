import anyTest, {type TestFn} from 'ava';
import {measurePlanOperation} from '../utils/execution/plan-metrics.js';
import type {TelemetryPlanOperationAttributes} from '../utils/telemetry/otel.js';

const test = anyTest as unknown as TestFn;

function clock(...values: number[]): () => number {
	let index = 0;
	return () => values[Math.min(index++, values.length - 1)]!;
}

test('Plan timing records bounded success and cache attributes', async t => {
	let recorded: TelemetryPlanOperationAttributes | undefined;
	const result = await measurePlanOperation(
		{operation: 'parse', detail: 'document'},
		async function (context) {
			context.cache = 'hit';
			return 'value';
		},
		{
			now: clock(10, 14.5),
			record(attributes) {
				recorded = attributes;
			},
		},
	);

	t.is(result, 'value');
	t.deepEqual(recorded, {
		operation: 'parse',
		detail: 'document',
		outcome: 'success',
		cache: 'hit',
		durationMs: 4.5,
	});
});

test('Plan timing records errors and preserves the original failure', async t => {
	let recorded: TelemetryPlanOperationAttributes | undefined;
	const error = await t.throwsAsync(async () =>
		measurePlanOperation(
			{operation: 'lock', detail: 'acquire'},
			async () => {
				throw new Error('lock failed');
			},
			{
				now: clock(20, 23),
				record(attributes) {
					recorded = attributes;
				},
			},
		),
	);

	t.is(error?.message, 'lock failed');
	t.deepEqual(recorded, {
		operation: 'lock',
		detail: 'acquire',
		outcome: 'error',
		cache: 'none',
		durationMs: 3,
	});
});

test('Plan timing ignores recorder failures', async t => {
	const result = await measurePlanOperation(
		{operation: 'write', detail: 'replace'},
		async function () {
			return 42;
		},
		{
			now: clock(1, 2),
			record() {
				throw new Error('telemetry failed');
			},
		},
	);

	t.is(result, 42);
});
