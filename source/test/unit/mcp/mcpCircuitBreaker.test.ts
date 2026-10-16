import anyTest, {type TestFn} from 'ava';
import {
	MCPCircuitBreaker,
} from '../../../utils/execution/mcp/circuitBreaker.js';

const test = (anyTest as unknown as TestFn).serial;

test('MCPCircuitBreaker: initial state is CLOSED and allows execution', t => {
	const breaker = new MCPCircuitBreaker({failureThreshold: 2, cooldownMs: 1000});
	t.is(breaker.getState('mock-service'), 'CLOSED');
	t.true(breaker.canExecute('mock-service'));
});

test('MCPCircuitBreaker: single failure stays CLOSED, reaches threshold enters OPEN', t => {
	const breaker = new MCPCircuitBreaker({failureThreshold: 2, cooldownMs: 1000});

	breaker.recordFailure('mock-service');
	t.is(breaker.getState('mock-service'), 'CLOSED');
	t.true(breaker.canExecute('mock-service'));

	breaker.recordFailure('mock-service');
	t.is(breaker.getState('mock-service'), 'OPEN');
	t.false(breaker.canExecute('mock-service'));
});

test('MCPCircuitBreaker: success resets failure counter back to clean CLOSED', t => {
	const breaker = new MCPCircuitBreaker({failureThreshold: 2, cooldownMs: 1000});

	breaker.recordFailure('mock-service');
	t.is(breaker.getStatus('mock-service').consecutiveFailures, 1);

	breaker.recordSuccess('mock-service');
	t.is(breaker.getStatus('mock-service').consecutiveFailures, 0);
	t.is(breaker.getState('mock-service'), 'CLOSED');
});

test('MCPCircuitBreaker: cooldown transition to HALF_OPEN and recovers on canary success', async t => {
	const breaker = new MCPCircuitBreaker({failureThreshold: 2, cooldownMs: 150});

	breaker.recordFailure('mock-service');
	breaker.recordFailure('mock-service');
	t.is(breaker.getState('mock-service'), 'OPEN');
	t.false(breaker.canExecute('mock-service'));

	// Wait for cooldown
	await new Promise(resolve => setTimeout(resolve, 200));

	t.is(breaker.getState('mock-service'), 'HALF_OPEN');
	t.true(breaker.canExecute('mock-service'));

	// Canary succeeds -> back to CLOSED
	breaker.recordSuccess('mock-service');
	t.is(breaker.getState('mock-service'), 'CLOSED');
	t.true(breaker.canExecute('mock-service'));
});

test('MCPCircuitBreaker: HALF_OPEN canary failure immediately drops back to OPEN', async t => {
	const breaker = new MCPCircuitBreaker({failureThreshold: 2, cooldownMs: 150});

	breaker.recordFailure('mock-service');
	breaker.recordFailure('mock-service');
	t.is(breaker.getState('mock-service'), 'OPEN');

	// Wait for cooldown
	await new Promise(resolve => setTimeout(resolve, 200));
	t.is(breaker.getState('mock-service'), 'HALF_OPEN');

	// Canary fails -> immediately OPEN again
	breaker.recordFailure('mock-service');
	t.is(breaker.getState('mock-service'), 'OPEN');
	t.false(breaker.canExecute('mock-service'));
});

test('MCPCircuitBreaker: manual reset restores CLOSED state immediately', t => {
	const breaker = new MCPCircuitBreaker({failureThreshold: 2, cooldownMs: 50000});

	breaker.recordFailure('service-1');
	breaker.recordFailure('service-1');
	breaker.recordFailure('service-2');
	breaker.recordFailure('service-2');
	t.is(breaker.getState('service-1'), 'OPEN');
	t.is(breaker.getState('service-2'), 'OPEN');

	breaker.resetService('service-1');
	t.is(breaker.getState('service-1'), 'CLOSED');
	t.is(breaker.getState('service-2'), 'OPEN');

	breaker.resetAll();
	t.is(breaker.getState('service-2'), 'CLOSED');
});
