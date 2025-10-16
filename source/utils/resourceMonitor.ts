/**
 * Resource Monitor - Track memory usage and potential leaks
 */

import {logger} from './logger.js';

interface ResourceStats {
	timestamp: number;
	memoryUsage: NodeJS.MemoryUsage;
	activeEncoders: number;
	activeMCPConnections: number;
}

class ResourceMonitor {
	private stats: ResourceStats[] = [];
	private readonly maxStatsHistory = 100;
	private activeEncoders = 0;
	private activeMCPConnections = 0;
	private monitoringInterval: NodeJS.Timeout | null = null;

	/**
	 * Start monitoring resources
	 */
	startMonitoring(intervalMs: number = 30000) {
		if (this.monitoringInterval) {
			return; // Already monitoring
		}

		this.monitoringInterval = setInterval(() => {
			this.collectStats();
		}, intervalMs);

		logger.info('Resource monitoring started');
	}

	/**
	 * Stop monitoring resources
	 */
	stopMonitoring() {
		if (this.monitoringInterval) {
			clearInterval(this.monitoringInterval);
			this.monitoringInterval = null;
			logger.info('Resource monitoring stopped');
		}
	}

	/**
	 * Collect current resource stats
	 */
	private collectStats() {
		const stats: ResourceStats = {
			timestamp: Date.now(),
			memoryUsage: process.memoryUsage(),
			activeEncoders: this.activeEncoders,
			activeMCPConnections: this.activeMCPConnections,
		};

		this.stats.push(stats);

		// Keep only recent history
		if (this.stats.length > this.maxStatsHistory) {
			this.stats.shift();
		}

		// Log warning if memory usage is high
		const heapUsedMB = stats.memoryUsage.heapUsed / 1024 / 1024;
		if (heapUsedMB > 500) {
			logger.warn(
				`High memory usage detected: ${heapUsedMB.toFixed(2)} MB heap used`,
			);
		}

		// Log debug info periodically (every 5 minutes)
		if (this.stats.length % 10 === 0) {
			logger.info(
				`Resource stats: Heap ${heapUsedMB.toFixed(2)} MB, Encoders: ${this.activeEncoders}, MCP: ${this.activeMCPConnections}`,
			);
		}
	}

	/**
	 * Track encoder creation
	 */
	trackEncoderCreated() {
		this.activeEncoders++;
		logger.info(`Encoder created (total: ${this.activeEncoders})`);
	}

	/**
	 * Track encoder freed
	 */
	trackEncoderFreed() {
		this.activeEncoders--;
		if (this.activeEncoders < 0) {
			logger.warn('Encoder count went negative - possible double-free');
			this.activeEncoders = 0;
		}
		logger.info(`Encoder freed (remaining: ${this.activeEncoders})`);
	}

	/**
	 * Track MCP connection opened
	 */
	trackMCPConnectionOpened(serviceName: string) {
		this.activeMCPConnections++;
		logger.info(
			`MCP connection opened: ${serviceName} (total: ${this.activeMCPConnections})`,
		);
	}

	/**
	 * Track MCP connection closed
	 */
	trackMCPConnectionClosed(serviceName: string) {
		this.activeMCPConnections--;
		if (this.activeMCPConnections < 0) {
			logger.warn('MCP connection count went negative - possible double-close');
			this.activeMCPConnections = 0;
		}
		logger.info(
			`MCP connection closed: ${serviceName} (remaining: ${this.activeMCPConnections})`,
		);
	}

	/**
	 * Get current stats
	 */
	getCurrentStats(): ResourceStats | null {
		return this.stats.length > 0 ? this.stats[this.stats.length - 1]! : null;
	}

	/**
	 * Get stats history
	 */
	getStatsHistory(): ResourceStats[] {
		return [...this.stats];
	}

	/**
	 * Check if there are potential memory leaks
	 */
	checkForLeaks(): {hasLeak: boolean; reasons: string[]} {
		const reasons: string[] = [];

		// Check encoder leak
		if (this.activeEncoders > 3) {
			reasons.push(
				`High encoder count: ${this.activeEncoders} (expected <= 3)`,
			);
		}

		// Check MCP connection leak
		if (this.activeMCPConnections > 5) {
			reasons.push(
				`High MCP connection count: ${this.activeMCPConnections} (expected <= 5)`,
			);
		}

		// Check memory growth
		if (this.stats.length >= 10) {
			const recent = this.stats.slice(-10);
			const first = recent[0]!;
			const last = recent[recent.length - 1]!;
			const growthMB =
				(last.memoryUsage.heapUsed - first.memoryUsage.heapUsed) / 1024 / 1024;

			if (growthMB > 100) {
				reasons.push(
					`Memory grew by ${growthMB.toFixed(2)} MB in last 10 samples`,
				);
			}
		}

		return {
			hasLeak: reasons.length > 0,
			reasons,
		};
	}

	/**
	 * Force garbage collection if available
	 */
	forceGC() {
		if (global.gc) {
			logger.info('Forcing garbage collection');
			global.gc();
		} else {
			logger.warn(
				'GC not available - run with --expose-gc flag for manual GC',
			);
		}
	}
}

// Singleton instance
export const resourceMonitor = new ResourceMonitor();
