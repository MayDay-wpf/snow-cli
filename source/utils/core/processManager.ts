import {ChildProcess, exec} from 'child_process';

/**
 * Process Manager
 * Tracks and manages all child processes to ensure proper cleanup
 * Supports Windows process tree termination
 */
class ProcessManager {
	private processes: Set<ChildProcess> = new Set();
	private isShuttingDown = false;
	private readonly isWindows = process.platform === 'win32';

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
	 * On Windows, uses taskkill with /T flag to terminate process tree
	 */
	private killProcess(process: ChildProcess): void {
		const pid = process.pid;
		if (!pid || process.killed) {
			return;
		}

		if (this.isWindows) {
			// Windows: Use taskkill to kill entire process tree
			// /T = terminate child processes, /F = force
			// Redirect stderr to NUL to suppress "Access is denied" error spam
			exec(`taskkill /PID ${pid} /T /F 2>NUL`, {windowsHide: true}, () => {
				// Ignore errors - process may already be dead or inaccessible
			});
		} else {
			// Unix: Use SIGTERM for graceful termination
			try {
				process.kill('SIGTERM');

				// Force kill after 1 second if still alive
				setTimeout(() => {
					try {
						if (!process.killed) {
							process.kill('SIGKILL');
						}
					} catch {
						// Process already dead
					}
				}, 1000);
			} catch {
				// Process already dead
			}
		}
	}

	/**
	 * Kill all tracked processes
	 * On Windows, kills process trees to ensure no orphaned children
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

/**
 * Graceful exit with async cleanup support
 * Emits SIGINT to trigger cleanup handlers before exit
 */
export function gracefulExit(): void {
	// Emit SIGINT to trigger async cleanup handlers in cli.tsx
	// The SIGINT handler will call process.exit() after cleanup
	process.emit('SIGINT');
}
