/**
 * Cache Invalidation Registry
 *
 * Provides a decoupled mechanism for upper-layer services (such as agents and execution hooks)
 * to register their cache clearance callbacks, preventing utils/config from directly depending
 * on agents/* or execution/* and breaking circular dependency chains (Cycles #1 - #8).
 */

import {logger} from '../core/logger.js';

const log = logger.child('config.cacheRegistry');

type CacheClearer = () => void;

const clearers = new Set<CacheClearer>();

/**
 * Register a cache clearing function.
 * Called by agents and hook executors during initialization.
 * Returns an unregister function.
 */
export function registerCacheClearer(clearer: CacheClearer): () => void {
	clearers.add(clearer);
	return () => {
		clearers.delete(clearer);
	};
}

/**
 * Clear all registered caches across agents and execution services.
 * Invoked by configManager when profile switches or configs change.
 */
export function clearAllRegisteredCaches(): void {
	for (const clearer of clearers) {
		try {
			clearer();
		} catch (error) {
			log.debug('Failed to clear cache handler', error);
		}
	}
}
