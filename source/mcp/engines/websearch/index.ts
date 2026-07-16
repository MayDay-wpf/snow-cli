/**
 * Search engine registry / factory.
 *
 * Built-in engines are registered statically below. In addition, users can
 * drop custom engine plugins into `~/.snow/plugin/search_engines/` (the
 * `SEARCH_ENGINES_DIR` constant exported from `apiConfig.ts`). Each plugin
 * file must implement the `SearchEngine` contract from `./types.ts` and is
 * loaded lazily on first use via dynamic `import()`.
 *
 * Plugin file rules (mirrors the status-line plugin loader):
 *   - Supported extensions: `.js`, `.mjs`, `.cjs`
 *   - The module may export the engine as `default`, `searchEngine`, or
 *     `searchEngines` (single object or array).
 *   - An engine MUST be an object with `{id, name, search(page, query,
 *     maxResults)}` where `search` returns `Promise<SearchResult[]>`.
 *   - External engines override built-ins when their `id` collides.
 *   - Plugin directory changes hot-reload without process restart.
 *
 * Adding a NEW built-in engine still requires only:
 *   1. Implementing `SearchEngine` in a new file under this folder.
 *   2. Registering it in `BUILT_IN_ENGINES` below.
 */

import {
	existsSync,
	readdirSync,
	watch as watchDir,
	type FSWatcher,
} from 'node:fs';
import {extname, join} from 'node:path';

import {SEARCH_ENGINES_DIR} from '../../../utils/config/apiConfig.js';
import {importFreshPluginModule} from '../../../utils/plugins/importFresh.js';
import {DuckDuckGoEngine} from './duckduckgo.engine.js';
import {BingEngine} from './bing.engine.js';
import type {SearchEngine, SearchEngineId} from './types.js';

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'duckduckgo';

const SUPPORTED_SEARCH_ENGINE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const PLUGIN_RELOAD_DEBOUNCE_MS = 150;

const BUILT_IN_ENGINES: SearchEngine[] = [
	new DuckDuckGoEngine(),
	new BingEngine(),
];

/**
 * In-memory registry keyed by engine id. Initially populated with built-in
 * engines (only those that are enabled); extended at runtime by
 * `ensureSearchEnginesLoaded()`. Engines explicitly setting `enable: false`
 * are NOT registered.
 */
const ENGINES: Map<string, SearchEngine> = buildBuiltinEngineMap();

let externalLoadPromise: Promise<void> | null = null;
let externalLoaded = false;
/** Bumps on each reload so concurrent ensure/reload don't serve a half-cleared registry. */
let loadGeneration = 0;
/** Serializes reloadSearchEngines — concurrent watch events share one in-flight reload. */
let reloadInFlight: Promise<void> | null = null;
/** When true, another reload was requested during the current in-flight run. */
let reloadQueued = false;
let pluginWatcher: FSWatcher | null = null;
let pluginReloadTimer: ReturnType<typeof setTimeout> | null = null;
let pluginWatchRetryTimer: ReturnType<typeof setTimeout> | null = null;
let watcherBootstrapped = false;

type SearchEngineModule = {
	default?: unknown;
	searchEngine?: unknown;
	searchEngines?: unknown;
};

function isSearchEngine(candidate: unknown): candidate is SearchEngine {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const c = candidate as Partial<SearchEngine>;
	return (
		typeof c.id === 'string' &&
		c.id.length > 0 &&
		typeof c.name === 'string' &&
		typeof c.search === 'function'
	);
}

/**
 * An engine is considered enabled unless it explicitly sets `enable: false`.
 * This lets plugin authors keep the file on disk while temporarily disabling
 * the engine, mirroring the StatusLine hook convention.
 */
function isEngineEnabled(engine: SearchEngine): boolean {
	return engine.enable !== false;
}

function collectFromModule(mod: SearchEngineModule): SearchEngine[] {
	const candidates: unknown[] = [];
	const pushOne = (val: unknown) => {
		if (Array.isArray(val)) candidates.push(...val);
		else if (val !== undefined && val !== null) candidates.push(val);
	};
	pushOne(mod.default);
	pushOne(mod.searchEngine);
	pushOne(mod.searchEngines);
	return candidates.filter(isSearchEngine);
}

/** Bust ESM import cache so edited plugins reload without process restart. */
function buildBuiltinEngineMap(): Map<string, SearchEngine> {
	const engines = new Map<string, SearchEngine>();
	for (const engine of BUILT_IN_ENGINES) {
		if (isEngineEnabled(engine)) {
			engines.set(engine.id, engine);
		}
	}
	return engines;
}

function replaceEngines(nextEngines: Map<string, SearchEngine>): void {
	ENGINES.clear();
	for (const [id, engine] of nextEngines) {
		ENGINES.set(id, engine);
	}
}

async function loadExternalEngines(): Promise<Map<string, SearchEngine>> {
	const nextEngines = buildBuiltinEngineMap();
	if (!existsSync(SEARCH_ENGINES_DIR)) return nextEngines;

	let entries: Array<import('node:fs').Dirent>;
	try {
		entries = readdirSync(SEARCH_ENGINES_DIR, {withFileTypes: true});
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn('[websearch] failed to read plugin dir', error);
		return nextEngines;
	}

	const files = entries
		.filter(
			e =>
				e.isFile() &&
				SUPPORTED_SEARCH_ENGINE_EXTENSIONS.has(extname(e.name).toLowerCase()),
		)
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const file of files) {
		const modulePath = join(SEARCH_ENGINES_DIR, file.name);
		try {
			const mod = (await importFreshPluginModule(
				modulePath,
			)) as SearchEngineModule;
			const engines = collectFromModule(mod);
			if (engines.length === 0) {
				// eslint-disable-next-line no-console
				console.warn(
					`[websearch] plugin "${file.name}" did not export a valid SearchEngine`,
				);
				continue;
			}
			for (const engine of engines) {
				if (!isEngineEnabled(engine)) {
					// Plugin author explicitly disabled this engine — ensure it is
					// not registered AND drop any same-id built-in so the user can
					// also use `enable: false` as a way to mask built-ins.
					nextEngines.delete(engine.id);
					continue;
				}
				nextEngines.set(engine.id, engine);
			}
		} catch (error) {
			// eslint-disable-next-line no-console
			console.warn(
				`[websearch] failed to load search engine plugin "${file.name}":`,
				error,
			);
		}
	}

	return nextEngines;
}

function ensurePluginWatcher(): void {
	if (watcherBootstrapped) return;
	watcherBootstrapped = true;
	let shouldReloadAfterAttach = false;

	const scheduleWatchRetry = (delayMs: number) => {
		if (pluginWatcher || pluginWatchRetryTimer) return;
		pluginWatchRetryTimer = setTimeout(() => {
			pluginWatchRetryTimer = null;
			startWatch();
		}, delayMs);
		pluginWatchRetryTimer.unref?.();
	};

	const startWatch = () => {
		if (pluginWatcher) return;
		if (!existsSync(SEARCH_ENGINES_DIR)) {
			shouldReloadAfterAttach = true;
			scheduleWatchRetry(800);
			return;
		}
		try {
			pluginWatcher = watchDir(
				SEARCH_ENGINES_DIR,
				{persistent: false},
				(_eventType, filename) => {
					if (
						filename &&
						!SUPPORTED_SEARCH_ENGINE_EXTENSIONS.has(
							extname(filename).toLowerCase(),
						)
					) {
						return;
					}
					if (pluginReloadTimer) clearTimeout(pluginReloadTimer);
					pluginReloadTimer = setTimeout(() => {
						void reloadSearchEngines();
					}, PLUGIN_RELOAD_DEBOUNCE_MS);
				},
			);
			pluginWatcher.on('error', () => {
				try {
					pluginWatcher?.close();
				} catch {
					// ignore
				}
				pluginWatcher = null;
				shouldReloadAfterAttach = true;
				scheduleWatchRetry(300);
			});
			if (shouldReloadAfterAttach) {
				shouldReloadAfterAttach = false;
				void reloadSearchEngines();
			}
		} catch {
			shouldReloadAfterAttach = true;
			scheduleWatchRetry(400);
		}
	};

	startWatch();
}

/**
 * Ensure that external search engine plugins are loaded into the registry.
 * Safe to call multiple times — first load is cached until `reloadSearchEngines`.
 * Concurrent callers share one promise; never observes a mid-reload map.
 */
export function ensureSearchEnginesLoaded(): Promise<void> {
	ensurePluginWatcher();
	// If a reload is in flight, wait for it (new generation) instead of racing.
	if (reloadInFlight) return reloadInFlight;
	if (externalLoaded) return Promise.resolve();
	if (externalLoadPromise) return externalLoadPromise;
	const gen = loadGeneration;
	externalLoadPromise = loadExternalEngines().then(nextEngines => {
		// Only mark loaded if no reload superseded this load.
		if (gen === loadGeneration) {
			replaceEngines(nextEngines);
			externalLoaded = true;
		}
	});
	return externalLoadPromise;
}

/**
 * Force re-scan plugin directory and re-import modules (cache-busted).
 * Serialized with queue-latest: concurrent watch events share one run; if another
 * reload is requested mid-flight, one more pass runs after the current finishes.
 * Generation token prevents ensure* from publishing a half-cleared registry.
 */
export async function reloadSearchEngines(): Promise<void> {
	ensurePluginWatcher();
	if (reloadInFlight) {
		reloadQueued = true;
		await reloadInFlight;
		return;
	}

	reloadInFlight = (async () => {
		do {
			reloadQueued = false;
			loadGeneration += 1;
			const gen = loadGeneration;
			externalLoaded = false;
			externalLoadPromise = null;
			const loadPromise = loadExternalEngines().then(nextEngines => {
				if (gen === loadGeneration) {
					replaceEngines(nextEngines);
					externalLoaded = true;
				}
			});
			externalLoadPromise = loadPromise;
			await loadPromise;
		} while (reloadQueued);
	})().finally(() => {
		reloadInFlight = null;
	});

	await reloadInFlight;
}

/**
 * Resolve an engine by id. Falls back to the default engine if the id is
 * unknown (e.g. older config file referencing a removed engine).
 *
 * NOTE: This is synchronous and only sees engines registered at call time.
 * Callers that need external plugins to be available should `await
 * ensureSearchEnginesLoaded()` first.
 */
export function getSearchEngine(id?: string | null): SearchEngine {
	if (id && ENGINES.has(id)) {
		return ENGINES.get(id)!;
	}
	return ENGINES.get(DEFAULT_SEARCH_ENGINE)!;
}

/** All registered engines (sync — only sees what's loaded so far). */
export function listSearchEngines(): SearchEngine[] {
	return Array.from(ENGINES.values());
}

/**
 * Async variant of `listSearchEngines` that first ensures external plugins
 * have been loaded. Use this from UI screens that show the engine picker.
 */
export async function listSearchEnginesAsync(): Promise<SearchEngine[]> {
	await ensureSearchEnginesLoaded();
	return listSearchEngines();
}

export type {SearchEngine, SearchEngineId} from './types.js';
