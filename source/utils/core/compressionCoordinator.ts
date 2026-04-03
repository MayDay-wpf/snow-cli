/**
 * CompressionCoordinator
 *
 * Cooperative lock that prevents race conditions when auto-compression
 * runs concurrently with teammate / sub-agent loops.
 *
 * When any participant acquires the lock, others that call
 * `waitUntilFree()` will be parked on a microtask-resolved promise
 * until the lock holder releases.  Multiple independent compressors
 * (e.g. two teammates) can coexist — each only blocks the *main*
 * flow or vice-versa — by using the `excludeId` parameter.
 */

type Waiter = {
	resolve: () => void;
	excludeId?: string;
};

class CompressionCoordinator {
	private _compressing: Set<string> = new Set();
	private _waiters: Waiter[] = [];

	/**
	 * Acquire the compression lock for `id`.
	 * If someone *else* already holds a lock, this will block until they release.
	 */
	async acquireLock(id: string): Promise<void> {
		await this.waitUntilFree(id);
		this._compressing.add(id);
	}

	/**
	 * Release the compression lock for `id` and wake any waiters
	 * whose blocking condition is now satisfied.
	 */
	releaseLock(id: string): void {
		this._compressing.delete(id);
		this._drainWaiters();
	}

	/**
	 * Check whether anyone *other than* `excludeId` is currently compressing.
	 */
	isCompressing(excludeId?: string): boolean {
		if (excludeId === undefined) return this._compressing.size > 0;
		for (const id of this._compressing) {
			if (id !== excludeId) return true;
		}
		return false;
	}

	/**
	 * Returns a promise that resolves once no one *other than* `excludeId`
	 * holds a compression lock.  Resolves immediately if already free.
	 */
	waitUntilFree(excludeId?: string): Promise<void> {
		if (!this.isCompressing(excludeId)) return Promise.resolve();
		return new Promise<void>(resolve => {
			this._waiters.push({resolve, excludeId});
		});
	}

	/**
	 * Convenience helper: wrap an async fn with acquire/release.
	 */
	async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
		await this.acquireLock(id);
		try {
			return await fn();
		} finally {
			this.releaseLock(id);
		}
	}

	private _drainWaiters(): void {
		const still: Waiter[] = [];
		for (const w of this._waiters) {
			if (!this.isCompressing(w.excludeId)) {
				w.resolve();
			} else {
				still.push(w);
			}
		}
		this._waiters = still;
	}
}

export const compressionCoordinator = new CompressionCoordinator();
