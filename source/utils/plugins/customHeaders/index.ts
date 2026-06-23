/**
 * Custom header plugin registry / loader / placeholder resolver.
 *
 * Mirrors the architecture of the search-engine plugin loader
 * (`source/mcp/engines/websearch/index.ts`) and the status-line hook loader
 * (`source/ui/components/common/statusline/useStatusLineHooks.ts`):
 *
 *   - Plugins live in `~/.snow/plugin/custom_headers/` and are loaded lazily
 *     on first use via dynamic `import()`.
 *   - Supported extensions: `.js`, `.mjs`, `.cjs`.
 *   - Module may export `default`, `customHeaderPlugin`, or
 *     `customHeaderPlugins` (single object or array).
 *   - `enable: false` skips the plugin.
 *
 * The main entry point is `resolveCustomHeaderPlaceholders()`, which scans
 * header values for `{{name}}` tokens, asks every enabled plugin to resolve
 * them, and substitutes the results. When no placeholders are present the
 * function returns synchronously without touching the plugin directory.
 */

import {existsSync, readdirSync} from 'node:fs';
import {extname, join} from 'node:path';
import {pathToFileURL} from 'node:url';

import {CUSTOM_HEADERS_PLUGIN_DIR} from '../../config/apiConfig.js';
import {logger} from '../../core/logger.js';
import type {CustomHeaderPlugin, CustomHeaderPluginContext} from './types.js';

export type {CustomHeaderPlugin, CustomHeaderPluginContext} from './types.js';

const SUPPORTED_PLUGIN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/** Matches `{{placeholder}}` tokens in header values. Capture group 1 = name. */
const PLACEHOLDER_PATTERN = /\{\{([^}]+)\}\}/g;

type CustomHeaderPluginModule = {
	default?: unknown;
	customHeaderPlugin?: unknown;
	customHeaderPlugins?: unknown;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isCustomHeaderPlugin(
	candidate: unknown,
): candidate is CustomHeaderPlugin {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const c = candidate as Partial<CustomHeaderPlugin>;
	return (
		typeof c.id === 'string' &&
		c.id.length > 0 &&
		typeof c.resolve === 'function'
	);
}

function isPluginEnabled(plugin: CustomHeaderPlugin): boolean {
	return plugin.enable !== false;
}

function collectFromModule(mod: CustomHeaderPluginModule): CustomHeaderPlugin[] {
	const candidates: unknown[] = [];
	const pushOne = (val: unknown) => {
		if (Array.isArray(val)) candidates.push(...val);
		else if (val !== undefined && val !== null) candidates.push(val);
	};
	pushOne(mod.default);
	pushOne(mod.customHeaderPlugin);
	pushOne(mod.customHeaderPlugins);
	return candidates.filter(isCustomHeaderPlugin);
}

// ---------------------------------------------------------------------------
// External plugin loading (lazy, runs once)
// ---------------------------------------------------------------------------

const PLUGINS: CustomHeaderPlugin[] = [];
let externalLoadPromise: Promise<void> | null = null;
let externalLoaded = false;

async function loadExternalPlugins(): Promise<void> {
	if (!existsSync(CUSTOM_HEADERS_PLUGIN_DIR)) return;

	let entries: Array<import('node:fs').Dirent>;
	try {
		entries = readdirSync(CUSTOM_HEADERS_PLUGIN_DIR, {withFileTypes: true});
	} catch (error) {
		logger.warn('Failed to read custom header plugin directory', {
			directory: CUSTOM_HEADERS_PLUGIN_DIR,
			error,
		});
		return;
	}

	const files = entries
		.filter(
			e =>
				e.isFile() &&
				SUPPORTED_PLUGIN_EXTENSIONS.has(extname(e.name).toLowerCase()),
		)
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const file of files) {
		const modulePath = join(CUSTOM_HEADERS_PLUGIN_DIR, file.name);
		try {
			const moduleUrl = pathToFileURL(modulePath).href;
			const mod = (await import(moduleUrl)) as CustomHeaderPluginModule;
			const plugins = collectFromModule(mod);
			if (plugins.length === 0) {
				logger.warn(
					`[custom-headers] plugin "${file.name}" did not export a valid CustomHeaderPlugin`,
				);
				continue;
			}
			for (const plugin of plugins) {
				if (!isPluginEnabled(plugin)) continue;
				PLUGINS.push(plugin);
			}
		} catch (error) {
			logger.warn(
				`[custom-headers] failed to load plugin "${file.name}":`,
				{error},
			);
		}
	}
}

/**
 * Ensure that external custom header plugins are loaded into the registry.
 * Safe to call multiple times — actual loading only runs once.
 */
export function ensureCustomHeaderPluginsLoaded(): Promise<void> {
	if (externalLoaded) return Promise.resolve();
	if (externalLoadPromise) return externalLoadPromise;
	externalLoadPromise = loadExternalPlugins().then(() => {
		externalLoaded = true;
	});
	return externalLoadPromise;
}

/** All registered (enabled) plugins (sync — only sees what's loaded so far). */
export function listCustomHeaderPlugins(): CustomHeaderPlugin[] {
	return PLUGINS;
}

// ---------------------------------------------------------------------------
// Placeholder extraction & resolution
// ---------------------------------------------------------------------------

/**
 * Extract all unique placeholder names from a set of header values.
 * Returns an empty array when no `{{...}}` tokens are present.
 */
export function extractPlaceholders(
	headers: Record<string, string>,
): string[] {
	const names = new Set<string>();
	for (const value of Object.values(headers)) {
		if (typeof value !== 'string') continue;
		for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
			const name = match[1]?.trim();
			if (name) names.add(name);
		}
	}
	return Array.from(names);
}

/**
 * Resolve `{{placeholder}}` tokens in custom header values using plugins.
 *
 * Flow:
 *   1. Extract unique placeholder names from all header values.
 *   2. If none found, return headers unchanged (no plugin loading).
 *   3. Load external plugins (lazy, once).
 *   4. Call each enabled plugin's `resolve()` with the placeholder names.
 *      First plugin to resolve a placeholder wins.
 *   5. Substitute resolved values; unresolved placeholders remain as-is.
 *
 * @param headers - Raw header key-value pairs (may contain `{{...}}` tokens).
 * @param contextOverride - Optional partial context to merge over defaults.
 * @returns A new record with placeholders substituted.
 */
export async function resolveCustomHeaderPlaceholders(
	headers: Record<string, string>,
	contextOverride?: Partial<CustomHeaderPluginContext>,
): Promise<Record<string, string>> {
	const placeholders = extractPlaceholders(headers);

	// Fast path: no placeholders → no async work.
	if (placeholders.length === 0) {
		return headers;
	}

	await ensureCustomHeaderPluginsLoaded();
	const plugins = listCustomHeaderPlugins();

	// No plugins installed → leave placeholders as-is.
	if (plugins.length === 0) {
		return headers;
	}

	const context: CustomHeaderPluginContext = {
		cwd: process.cwd(),
		platform: process.platform,
		...contextOverride,
	};

	// Collect resolved values — first plugin to provide a value wins.
	const resolved: Record<string, string> = {};
	for (const plugin of plugins) {
		try {
			const result = await plugin.resolve(placeholders, context);
			if (result && typeof result === 'object') {
				for (const [key, value] of Object.entries(result)) {
					if (
						typeof value === 'string' &&
						value.length > 0 &&
						!(key in resolved)
					) {
						resolved[key] = value;
					}
				}
			}
		} catch (error) {
			logger.warn('Custom header plugin resolve failed', {
				pluginId: plugin.id,
				error,
			});
		}
	}

	// If nothing was resolved, skip substitution entirely.
	if (Object.keys(resolved).length === 0) {
		return headers;
	}

	// Substitute placeholders in header values.
	const result: Record<string, string> = {};
	for (const [headerKey, headerValue] of Object.entries(headers)) {
		result[headerKey] = headerValue.replace(
			PLACEHOLDER_PATTERN,
			(match, name: string) => {
				const trimmed = name.trim();
				return trimmed in resolved ? resolved[trimmed]! : match;
			},
		);
	}

	return result;
}
