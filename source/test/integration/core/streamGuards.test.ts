import test from 'ava';
import {
	createIdleTimeoutGuard,
	StreamIdleTimeoutError,
	STREAM_IDLE_TIMEOUT_MS,
} from '../../../utils/core/streamGuards.js';

// ============================================================================
// Core Domain (L1 Integration): streamGuards 空闲超时状态机与流安全放弃
// 依据 testing-scenario-cli 与 testing-core-oracle 契约判定
// ============================================================================

test('streamGuards: initial state is not abandoned and has no timeout error', t => {
	const guard = createIdleTimeoutGuard({idleTimeoutMs: 5000});
	t.false(guard.isAbandoned());
	t.is(guard.getTimeoutError(), null);
	guard.dispose();
});

test('streamGuards: manual abandon flags stream as abandoned immediately', t => {
	const guard = createIdleTimeoutGuard({idleTimeoutMs: 5000});
	guard.abandon();
	t.true(guard.isAbandoned());
	guard.dispose();
});

test('streamGuards: idle timer triggers timeout and sets StreamIdleTimeoutError', async t => {
	// 50ms 超时用于快速单测
	const guard = createIdleTimeoutGuard({
		idleTimeoutMs: 40,
	});

	t.false(guard.isAbandoned());

	// 等待 120ms 触发定时器 (兼容 Windows 定时器时钟抖动)
	await new Promise(r => setTimeout(r, 120));

	t.true(guard.isAbandoned(), 'Stream must be marked abandoned after idle timeout');
	const err = guard.getTimeoutError();
	t.truthy(err);
	t.true(err instanceof StreamIdleTimeoutError);
	t.true(err?.message.includes('[RETRIABLE]'));

	guard.dispose();
});

test('streamGuards: touch resets the idle timer and prevents premature timeout', async t => {
	const guard = createIdleTimeoutGuard({
		idleTimeoutMs: 120,
	});

	// 在 50ms 时调用 touch
	await new Promise(r => setTimeout(r, 50));
	guard.touch();

	// 在 90ms 时再看，由于 touch 重置，此时不应超时
	t.false(guard.isAbandoned());
	t.is(guard.getTimeoutError(), null);

	guard.dispose();
});

test('streamGuards: custom onTimeout callback is safely invoked without leaking unhandled exceptions', async t => {
	let callbackInvoked = false;
	const guard = createIdleTimeoutGuard({
		idleTimeoutMs: 40,
		onTimeout: () => {
			callbackInvoked = true;
			throw new Error('Custom timeout error');
		},
	});

	await new Promise(r => setTimeout(r, 100));

	t.true(callbackInvoked);
	t.true(guard.isAbandoned());
	const err = guard.getTimeoutError();
	t.is(err?.message, 'Custom timeout error');

	guard.dispose();
});
