import test from 'ava';
import {withRetry, isOverloadedError} from '../../../utils/core/retryUtils.js';

// ============================================================================
// Core Domain (L1 Integration): retryUtils 退避重试与中断信号
// 依据 testing-scenario-cli 与 testing-core-oracle 契约判定
// ============================================================================

test('retryUtils: withRetry resolves immediately when the task succeeds on first try', async t => {
	let calls = 0;
	const result = await withRetry(async () => {
		calls++;
		return 'success';
	}, {baseDelay: 10, maxRetries: 3});

	t.is(result, 'success');
	t.is(calls, 1);
});

test('retryUtils: withRetry retries on retryable errors until success', async t => {
	let calls = 0;
	const retryAttempts: number[] = [];

	const result = await withRetry(async () => {
		calls++;
		if (calls < 3) {
			throw new Error('503 Service Unavailable');
		}
		return 'recovered';
	}, {
		maxRetries: 4,
		baseDelay: 10,
		onRetry: (_err, attempt) => {
			retryAttempts.push(attempt);
		},
	});

	t.is(result, 'recovered');
	t.is(calls, 3);
	t.deepEqual(retryAttempts, [1, 2]);
});

test('retryUtils: withRetry fast-fails immediately on non-retryable client errors (e.g. 400 Bad Request)', async t => {
	let calls = 0;

	const err = await t.throwsAsync(async () => {
		await withRetry(async () => {
			calls++;
			throw new Error('400 Bad Request: Invalid JSON body');
		}, {maxRetries: 3, baseDelay: 10});
	});

	t.truthy(err);
	t.true(err?.message.includes('400 Bad Request'));
	t.is(calls, 1, 'Client errors must NOT be retried');
});

test('retryUtils: withRetry respects AbortSignal during execution', async t => {
	const controller = new AbortController();
	controller.abort();

	const err = await t.throwsAsync(async () => {
		await withRetry(async () => {
			return 'never reached';
		}, {abortSignal: controller.signal, baseDelay: 10});
	});

	t.truthy(err);
});

test('retryUtils: isOverloadedError detects server overloaded responses', t => {
	t.true(isOverloadedError(new Error('Model is overloaded. Please try again later.')));
	t.true(isOverloadedError(new Error('Server overloaded (529)')));
	t.false(isOverloadedError(new Error('404 Not Found')));
});
