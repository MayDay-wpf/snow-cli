/**
 * SSH connection pool.
 *
 * Goals:
 * - Reuse SSHClient instances across multiple short operations (readFile, exec, sftp readdir, ...)
 *   to avoid the cost of TCP + key exchange + SFTP init for every call.
 * - Idle disconnect: a connection with zero in-flight users is closed after IDLE_DISCONNECT_MS
 *   to free up server resources.
 * - Process-exit safety: all open connections are torn down on `process.exit` / SIGINT / SIGTERM.
 *
 * Usage:
 *
 *   await sshConnectionPool.withClient(sshConfig, async client => {
 *     return await client.readFile('/etc/hostname');
 *   });
 *
 * Notes:
 * - Connections are keyed by `username@host:port`. Different auth methods to the same
 *   host:port:user collapse onto the same key (first one wins). This is acceptable because in
 *   practice working-dirs.json stores one SSHConfig per (host, port, user).
 * - `withClient` increments a ref count for the duration of the callback; the idle timer only
 *   starts after ref count returns to zero.
 */

import {SSHClient} from './sshClient.js';
import type {SSHConfig} from '../config/workingDirConfig.js';
import {logger} from '../core/logger.js';

const IDLE_DISCONNECT_MS = 60 * 1000;

interface PoolEntry {
	client: SSHClient;
	refCount: number;
	idleTimer: NodeJS.Timeout | null;
	connectingPromise: Promise<void> | null;
	connected: boolean;
}

function keyFor(config: SSHConfig): string {
	return `${config.username}@${config.host}:${config.port}`;
}

class SSHConnectionPool {
	private entries: Map<string, PoolEntry> = new Map();
	private exitHooksInstalled = false;

	private installExitHooks(): void {
		if (this.exitHooksInstalled) return;
		this.exitHooksInstalled = true;
		const closeAll = () => {
			void this.closeAll();
		};
		// Use `once` so re-entry doesn't double-close, and don't keep the event loop alive.
		process.once('exit', closeAll);
		process.once('SIGINT', closeAll);
		process.once('SIGTERM', closeAll);
	}

	private async ensureConnected(config: SSHConfig): Promise<PoolEntry> {
		this.installExitHooks();
		const key = keyFor(config);
		let entry = this.entries.get(key);

		if (!entry) {
			entry = {
				client: new SSHClient(),
				refCount: 0,
				idleTimer: null,
				connectingPromise: null,
				connected: false,
			};
			this.entries.set(key, entry);
		}

		if (entry.idleTimer) {
			clearTimeout(entry.idleTimer);
			entry.idleTimer = null;
		}

		if (entry.connected) {
			return entry;
		}

		if (!entry.connectingPromise) {
			const e = entry;
			entry.connectingPromise = (async () => {
				const result = await e.client.connect(config, config.password);
				if (!result.success) {
					// Drop the broken entry so the next attempt creates a fresh client.
					this.entries.delete(key);
					throw new Error(
						`SSH connection failed (${key}): ${result.error || 'unknown error'}`,
					);
				}
				e.connected = true;
			})();
		}

		try {
			await entry.connectingPromise;
		} finally {
			entry.connectingPromise = null;
		}

		return entry;
	}

	private scheduleIdleDisconnect(entry: PoolEntry, key: string): void {
		if (entry.idleTimer) {
			clearTimeout(entry.idleTimer);
		}
		entry.idleTimer = setTimeout(() => {
			// Re-check at fire time to avoid disconnecting an entry that got reused.
			if (entry.refCount > 0) return;
			try {
				entry.client.disconnect();
			} catch (err) {
				logger.warn('SSH pool: error while disconnecting idle client', err);
			}
			entry.connected = false;
			this.entries.delete(key);
		}, IDLE_DISCONNECT_MS);
		// Don't let the idle timer keep the process alive on its own.
		entry.idleTimer.unref?.();
	}

	/**
	 * Borrow a connected SSHClient for the duration of `fn`.
	 * The client is shared; do NOT call `client.disconnect()` from within `fn`.
	 */
	async withClient<T>(
		config: SSHConfig,
		fn: (client: SSHClient) => Promise<T>,
	): Promise<T> {
		const key = keyFor(config);
		const entry = await this.ensureConnected(config);
		entry.refCount++;
		try {
			return await fn(entry.client);
		} finally {
			entry.refCount--;
			if (entry.refCount <= 0) {
				entry.refCount = 0;
				this.scheduleIdleDisconnect(entry, key);
			}
		}
	}

	/**
	 * Forcefully close all pooled connections. Used on process exit and from dispose().
	 */
	async closeAll(): Promise<void> {
		const entries = Array.from(this.entries.values());
		this.entries.clear();
		for (const entry of entries) {
			if (entry.idleTimer) {
				clearTimeout(entry.idleTimer);
				entry.idleTimer = null;
			}
			try {
				entry.client.disconnect();
			} catch (err) {
				logger.warn('SSH pool: error while closing client during shutdown', err);
			}
			entry.connected = false;
		}
	}
}

export const sshConnectionPool = new SSHConnectionPool();
