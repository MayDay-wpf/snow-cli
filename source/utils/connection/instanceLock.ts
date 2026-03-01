import * as fs from 'fs';
import * as path from 'path';

export class InstanceLockManager {
	private readonly locksDir: string;

	constructor() {
		this.locksDir = path.join(process.cwd(), '.snow', 'locks');
	}

	// Ensure .snow/locks directory exists
	ensureLocksDir(): void {
		if (!fs.existsSync(this.locksDir)) {
			fs.mkdirSync(this.locksDir, {recursive: true});
		}
	}

	// Get instance lock file path
	private getLockPath(instanceId: string): string {
		return path.join(this.locksDir, `${instanceId}.lock`);
	}

	// Check if instance ID is already locked by another process
	isLocked(instanceId: string): boolean {
		try {
			const lockPath = this.getLockPath(instanceId);
			if (!fs.existsSync(lockPath)) {
				return false;
			}

			// Read lock file to get PID
			const lockContent = fs.readFileSync(lockPath, 'utf-8');
			const lockData = JSON.parse(lockContent) as {
				pid: number;
				timestamp: number;
			};

			// Check if the process is still running
			try {
				// On Windows, process.kill(0) throws if process doesn't exist
				// On Unix, it returns false
				process.kill(lockData.pid, 0);
				return true; // Process is still running
			} catch {
				// Process doesn't exist anymore, stale lock
				fs.unlinkSync(lockPath);
				return false;
			}
		} catch {
			return false;
		}
	}

	// Lock instance ID for current process
	lock(instanceId: string): boolean {
		try {
			this.ensureLocksDir();
			const lockPath = this.getLockPath(instanceId);

			// Double-check lock
			if (this.isLocked(instanceId)) {
				return false;
			}

			// Create lock file with current PID and timestamp
			const lockData = {
				pid: process.pid,
				timestamp: Date.now(),
			};
			fs.writeFileSync(lockPath, JSON.stringify(lockData), 'utf-8');
			return true;
		} catch {
			return false;
		}
	}

	// Unlock instance ID
	unlock(instanceId: string): void {
		try {
			const lockPath = this.getLockPath(instanceId);
			if (fs.existsSync(lockPath)) {
				fs.unlinkSync(lockPath);
			}
		} catch {
			// Ignore unlock errors
		}
	}
}
