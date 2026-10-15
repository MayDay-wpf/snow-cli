/**
 * MCP Service Circuit Breaker
 * Protects system startup and probe phases from being stalled by repeated timeouts
 * on dead or unreachable external MCP services.
 *
 * State Machine:
 *   CLOSED   (normal operation, failures accumulate)
 *     |-- (failures >= threshold) --> OPEN
 *   OPEN     (fast-fail with 0ms delay, cooldown timer runs)
 *     |-- (cooldown elapsed) --> HALF_OPEN
 *   HALF_OPEN (single canary probe allowed)
 *     |-- (probe succeeds) --> CLOSED
 *     |-- (probe fails)    --> OPEN (reset cooldown)
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
	/** Consecutive failures before opening the circuit (default: 2) */
	failureThreshold?: number;
	/** Cooldown period in ms before switching from OPEN to HALF_OPEN (default: 120,000ms = 2 min) */
	cooldownMs?: number;
}

export interface CircuitStatus {
	serviceName: string;
	state: CircuitState;
	consecutiveFailures: number;
	lastFailureTime?: number;
	nextAllowedAttemptTime?: number;
}

export class MCPCircuitBreaker {
	private readonly failureThreshold: number;
	private readonly cooldownMs: number;
	private readonly circuits: Map<
		string,
		{
			state: CircuitState;
			failures: number;
			lastFailureTime: number;
		}
	> = new Map();

	constructor(options: CircuitBreakerOptions = {}) {
		this.failureThreshold = options.failureThreshold ?? 2;
		this.cooldownMs = options.cooldownMs ?? 120_000;
	}

	/**
	 * Check if a probe execution is currently permitted for this service.
	 * Returns true if permitted, false if circuit is OPEN.
	 */
	canExecute(serviceName: string): boolean {
		const entry = this.circuits.get(serviceName);
		if (!entry) {
			return true;
		}

		if (entry.state === 'CLOSED') {
			return true;
		}

		const now = Date.now();
		if (entry.state === 'OPEN') {
			if (now - entry.lastFailureTime >= this.cooldownMs) {
				// Cooldown elapsed: transition to HALF_OPEN for canary probe
				entry.state = 'HALF_OPEN';
				return true;
			}
			return false;
		}

		// In HALF_OPEN: allow canary probe
		return true;
	}

	/**
	 * Record a successful probe or connection. Resets failures and returns to CLOSED.
	 */
	recordSuccess(serviceName: string): void {
		const entry = this.circuits.get(serviceName);
		if (entry) {
			entry.state = 'CLOSED';
			entry.failures = 0;
		}
	}

	/**
	 * Record a probe failure or timeout.
	 * If in HALF_OPEN or failures exceed threshold, transitions to OPEN.
	 */
	recordFailure(serviceName: string): void {
		let entry = this.circuits.get(serviceName);
		const now = Date.now();

		if (!entry) {
			entry = {
				state: 'CLOSED',
				failures: 1,
				lastFailureTime: now,
			};
			this.circuits.set(serviceName, entry);
		} else {
			entry.failures += 1;
			entry.lastFailureTime = now;
		}

		if (entry.state === 'HALF_OPEN' || entry.failures >= this.failureThreshold) {
			entry.state = 'OPEN';
		}
	}

	/**
	 * Get the current circuit state for a service.
	 */
	getState(serviceName: string): CircuitState {
		const entry = this.circuits.get(serviceName);
		if (!entry) {
			return 'CLOSED';
		}

		if (entry.state === 'OPEN') {
			if (Date.now() - entry.lastFailureTime >= this.cooldownMs) {
				entry.state = 'HALF_OPEN';
				return 'HALF_OPEN';
			}
		}

		return entry.state;
	}

	/**
	 * Get full status of a service circuit for diagnostic panels.
	 */
	getStatus(serviceName: string): CircuitStatus {
		const state = this.getState(serviceName);
		const entry = this.circuits.get(serviceName);
		return {
			serviceName,
			state,
			consecutiveFailures: entry?.failures ?? 0,
			lastFailureTime: entry?.lastFailureTime,
			nextAllowedAttemptTime:
				entry && entry.state === 'OPEN'
					? entry.lastFailureTime + this.cooldownMs
					: undefined,
		};
	}

	/**
	 * Check if circuit is currently OPEN (blocking calls).
	 */
	isOpen(serviceName: string): boolean {
		return this.getState(serviceName) === 'OPEN';
	}

	/**
	 * Reset circuit for a single service (or all if omitted).
	 */
	reset(serviceName?: string): void {
		if (serviceName) {
			this.resetService(serviceName);
		} else {
			this.resetAll();
		}
	}

	/**
	 * Reset circuit for a single service (e.g. user manually triggers reconnect)
	 */
	resetService(serviceName: string): void {
		this.circuits.delete(serviceName);
	}

	/**
	 * Reset all circuits (e.g. on configuration reload or restart)
	 */
	resetAll(): void {
		this.circuits.clear();
	}
}

export const mcpCircuitBreaker = new MCPCircuitBreaker();
