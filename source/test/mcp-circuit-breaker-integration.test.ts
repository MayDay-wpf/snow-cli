import anyTest, {type TestFn} from 'ava';
import {
	MCPCircuitBreaker,
} from '../utils/execution/mcp/circuitBreaker.js';

const test = (anyTest as unknown as TestFn).serial;

test('MCPCircuitBreakerIntegration: consecutive failures trip circuit and fast-fail subsequent probes in 0ms', async t => {
	const breaker = new MCPCircuitBreaker({
		failureThreshold: 2,
		cooldownMs: 60_000,
	});

	const faultyServiceName = 'unreachable-service';

	// Probe 1: Fails (e.g., 5000ms timeout in real system)
	t.true(breaker.canExecute(faultyServiceName));
	breaker.recordFailure(faultyServiceName);
	t.is(breaker.getState(faultyServiceName), 'CLOSED');

	// Probe 2: Fails again -> Reaches threshold -> TRIPPED to OPEN
	t.true(breaker.canExecute(faultyServiceName));
	breaker.recordFailure(faultyServiceName);
	t.is(breaker.getState(faultyServiceName), 'OPEN');

	// Probe 3: Fast-fail! Breaker immediately rejects probe without starting subprocess or HTTP timeout
	const start = Date.now();
	const allowed = breaker.canExecute(faultyServiceName);
	const duration = Date.now() - start;

	t.false(allowed, 'Should be blocked by open circuit');
	t.true(duration < 10, 'Fast-fail should execute in under 10ms (0ms nominal)');

	const status = breaker.getStatus(faultyServiceName);
	t.is(status.state, 'OPEN');
	t.truthy(status.nextAllowedAttemptTime);
	t.true(status.nextAllowedAttemptTime! > Date.now());

	// Manual reconnect / refresh resets breaker and allows canary probe
	breaker.resetService(faultyServiceName);
	t.is(breaker.getState(faultyServiceName), 'CLOSED');
	t.true(breaker.canExecute(faultyServiceName));
});
