/**
 * Custom header plugin system.
 *
 * Users can drop plugin files into `~/.snow/plugin/custom_headers/`
 * (the `CUSTOM_HEADERS_PLUGIN_DIR` constant exported from
 * `../../config/apiConfig.ts`). Each plugin can resolve `{{placeholder}}`
 * tokens that appear in custom header values, allowing headers to be
 * dynamically populated at request time (e.g. fetching an OAuth token,
 * generating a timestamp, reading from a secrets manager, etc.).
 *
 * Plugin file rules (mirrors the status-line / search-engine plugin
 * loaders):
 *   - Supported extensions: `.js`, `.mjs`, `.cjs`
 *   - The module may export the plugin as `default`, `customHeaderPlugin`,
 *     or `customHeaderPlugins` (single object or array).
 *   - A plugin MUST be an object with `{id, resolve(placeholders, context)}`
 *     where `resolve` returns `Promise<Record<string, string>>`.
 *   - Multiple plugins are loaded; the first plugin to resolve a given
 *     placeholder wins.
 *   - Set `enable: false` to temporarily disable a plugin without deleting
 *     the file.
 */

/**
 * Context passed to every plugin's `resolve` call.
 */
export interface CustomHeaderPluginContext {
	/** Current working directory of the CLI process. */
	readonly cwd: string;
	/** Operating system platform (e.g. 'darwin', 'win32', 'linux'). */
	readonly platform: string;
}

/**
 * Contract every custom header plugin must satisfy.
 *
 * A plugin receives the list of unique placeholder names extracted from the
 * active header scheme's values and returns a map of placeholder name →
 * resolved value. Placeholders that a plugin cannot resolve should simply be
 * omitted from the returned map — they may be resolved by another plugin or
 * left as-is in the final headers.
 */
export interface CustomHeaderPlugin {
	/** Unique plugin identifier (used for logging / override). */
	readonly id: string;
	/** Human-readable name (used in logs). */
	readonly name?: string;
	/**
	 * Optional enable flag. Defaults to `true` when omitted.
	 *
	 * Plugin authors can set `enable: false` to keep the file on disk but
	 * exclude the plugin from resolution.
	 */
	readonly enable?: boolean;
	/**
	 * Resolve placeholder values for the given placeholder names.
	 *
	 * @param placeholders - Unique placeholder names found in the active
	 *   header scheme (e.g. header value `Bearer {{token}}` yields
	 *   `["token"]`).
	 * @param context - Runtime context (cwd, platform, etc.).
	 * @returns A map of placeholder name → resolved value. Only include
	 *   placeholders that this plugin successfully resolved.
	 */
	resolve(
		placeholders: string[],
		context: CustomHeaderPluginContext,
	): Promise<Record<string, string>>;
}
