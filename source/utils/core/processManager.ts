import {ChildProcess, exec, execSync, spawnSync} from 'child_process';
import {logger} from './logger.js';

export interface TrackedProcessInfo {
	pid: number;
	command: string;
}

/**
 * Find child PIDs of a process on Unix/POSIX systems.
 * Uses pgrep or ps to discover active child processes directly without shell overhead.
 */
function getChildPidsUnix(parentPid: number): number[] {
	if (!Number.isInteger(parentPid) || parentPid <= 0) return [];

	const pidStr = String(parentPid);
	try {
		const result = spawnSync('pgrep', ['-P', pidStr], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		if (result.stdout) {
			return result.stdout
				.trim()
				.split(/\s+/)
				.map(Number)
				.filter(p => Number.isInteger(p) && p > 0);
		}
	} catch (error) {
		logger.debug('getChildPidsUnix pgrep failed', {error, parentPid});
	}

	try {
		const result = spawnSync('ps', ['-o', 'pid=', '--ppid', pidStr], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		if (result.stdout) {
			return result.stdout
				.trim()
				.split(/\s+/)
				.map(Number)
				.filter(p => Number.isInteger(p) && p > 0);
		}
	} catch (error) {
		logger.debug('getChildPidsUnix ps failed', {error, parentPid});
	}

	return [];
}

/**
 * Recursively discover all descendant PIDs under a root PID on Unix/POSIX systems.
 */
function getAllDescendantPidsUnix(rootPid: number): number[] {
	const allPids: number[] = [];
	const queue = [rootPid];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const children = getChildPidsUnix(current);
		for (const child of children) {
			if (!allPids.includes(child)) {
				allPids.push(child);
				queue.push(child);
			}
		}
	}

	return allPids;
}

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
	 * Terminate an entire process tree by PID cross-platform.
	 * On Windows: uses taskkill /PID ${pid} /T /F
	 * On Unix/POSIX: recursively reaps all descendant PIDs, plus process group and direct kill
	 */
	killPidTree(pid: number): void {
		if (!pid || pid <= 0) return;

		if (this.isWindows) {
			exec(`taskkill /PID ${pid} /T /F 2>NUL`, {windowsHide: true}, () => {
				// Ignore errors - process may already be dead or inaccessible
			});
		} else {
			// POSIX: Reap all descendant PIDs from leaves to root to prevent orphan adoption
			const descendants = getAllDescendantPidsUnix(pid);
			for (const childPid of descendants.reverse()) {
				try {
					process.kill(childPid, 'SIGKILL');
				} catch (error) {
					logger.debug('killPidTree child kill failed', {error, childPid});
				}
			}

			// Try process group kill in case child process was spawned as detached group leader
			try {
				process.kill(-pid, 'SIGKILL');
			} catch (error) {
				logger.debug('killPidTree process group kill failed', {error, pid});
			}

			// Final direct kill
			try {
				process.kill(pid, 'SIGKILL');
			} catch (error) {
				logger.debug('killPidTree direct kill failed', {error, pid});
			}
		}
	}

	/**
	 * Synchronously terminate a process tree by PID cross-platform.
	 * Essential during process exit hooks where event loop may not tick again.
	 */
	killPidTreeSync(pid: number): void {
		if (!pid || pid <= 0) return;

		if (this.isWindows) {
			try {
				execSync(`taskkill /PID ${pid} /T /F 2>NUL`, {
					windowsHide: true,
					stdio: 'ignore',
				});
			} catch (error) {
				// Ignore errors - process already terminated
				logger.debug('killPidTreeSync taskkill failed', {error, pid});
			}
		} else {
			const descendants = getAllDescendantPidsUnix(pid);
			for (const childPid of descendants.reverse()) {
				try {
					process.kill(childPid, 'SIGKILL');
				} catch (error) {
					logger.debug('killPidTreeSync child kill failed', {error, childPid});
				}
			}

			try {
				process.kill(-pid, 'SIGKILL');
			} catch (error) {
				logger.debug('killPidTreeSync process group kill failed', {error, pid});
			}

			try {
				process.kill(pid, 'SIGKILL');
			} catch (error) {
				logger.debug('killPidTreeSync direct kill failed', {error, pid});
			}
		}
	}

	/**
	 * Kill a specific process gracefully and reap its entire process tree.
	 * On Windows, uses taskkill with /T flag to terminate process tree.
	 * On POSIX, uses process group signals.
	 */
	killProcess(proc: ChildProcess | number): void {
		const pid = typeof proc === 'number' ? proc : proc.pid;
		if (!pid) {
			return;
		}
		if (typeof proc !== 'number' && proc.killed) {
			return;
		}

		this.killPidTree(pid);

		if (typeof proc !== 'number') {
			this.processes.delete(proc);
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

	/**
	 * List tracked child processes with their pid and command line.
	 * Used by the task manager to display per-process resource usage.
	 */
	list(): TrackedProcessInfo[] {
		const result: TrackedProcessInfo[] = [];
		for (const proc of this.processes) {
			if (!proc.pid) {
				continue;
			}
			const command = [proc.spawnfile, ...(proc.spawnargs ?? [])]
				.filter(Boolean)
				.join(' ')
				.trim();
			result.push({
				pid: proc.pid,
				command: command || `pid ${proc.pid}`,
			});
		}
		return result;
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
