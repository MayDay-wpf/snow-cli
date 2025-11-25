import {ChildProcess} from 'child_process';

/**
 * Process Manager
 * Tracks and manages all child processes to ensure proper cleanup
 */
class ProcessManager {
	private processes: Set<ChildProcess> = new Set();
	private isShuttingDown = false;

	/**
	 * Register a child process for tracking
	 */
	register(process: ChildProcess): void {
		if (this.isShuttingDown) {
			// If we're already shutting down, kill immediately
			this.killProcess(process);
			return;
		}

		this.processes.add(process);

		// Auto-remove when process exits
		const cleanup = () => {
			this.processes.delete(process);
		};

		process.once('exit', cleanup);
		process.once('error', cleanup);
	}

	/**
	 * Kill a specific process gracefully
	 */
	private killProcess(process: ChildProcess): void {
		try {
			if (process.pid && !process.killed) {
				// Try graceful termination first
				process.kill('SIGTERM');

				// Force kill after 1 second if still alive
				setTimeout(() => {
					if (process.pid && !process.killed) {
						process.kill('SIGKILL');
					}
				}, 1000);
			}
		} catch (error) {
			// Process might already be dead, ignore errors
		}
	}

	/**
	 * Kill all tracked processes
	 */
	killAll(): void {
		this.isShuttingDown = true;

		for (const process of this.processes) {
			this.killProcess(process);
		}

		this.processes.clear();
	}

	/**
	 * Get count of active processes
	 */
	getActiveCount(): number {
		return this.processes.size;
	}
}

// Export singleton instance
export const processManager = new ProcessManager();
