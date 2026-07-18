/**
 * Search engine abstraction for the web search service.
 *
 * Each engine encapsulates the logic to drive a Puppeteer Page and extract
 * search results from a specific search provider (DuckDuckGo, Bing, ...).
 *
 * Browser lifecycle (launch / connect / close) is managed by WebSearchService
 * and is intentionally outside the scope of an engine — engines only need a
 * ready-to-use `Page`.
 */

import type {Page} from 'puppeteer-core';
import type {SearchResult} from '../../types/websearch.types.js';

/**
 * Identifier used for configuration / persistence.
 *
 * Historically this was a closed string-literal union ('duckduckgo' | 'bing').
 * Since search engines are now pluggable (user-supplied plugins under
 * `~/.snow/plugin/search_engines/`), the id space is open and runtime values
 * can be any string the plugin author chooses. We therefore keep this as a
 * `string` alias to preserve a stable type name across the codebase while
 * accepting arbitrary plugin ids.
 */
export type SearchEngineId = string;

/**
 * Common contract every search engine implementation must satisfy.
 */
export interface SearchEngine {
	/** Stable engine identifier used in config files. */
	readonly id: SearchEngineId;
	/** Human readable name (used by UI / logs). */
	readonly name: string;

	/**
	 * Optional enable flag. Defaults to `true` when omitted.
	 *
	 * Plugin authors can set `enable: false` to keep the plugin file in place
	 * but exclude its engine(s) from the registry — useful for temporarily
	 * disabling an engine without deleting the file. Disabled engines are
	 * invisible to `getSearchEngine` / `listSearchEngines` / the UI picker.
	 */
	readonly enable?: boolean;

	/**
	 * Drive the given Puppeteer Page to perform a search and extract results.
	 *
	 * Engines should:
	 *   - navigate to their own search URL
	 *   - wait for the page to settle
	 *   - extract up to `maxResults` results
	 *   - clean up nothing (page is owned by the caller)
	 */
	search(
		page: Page,
		query: string,
		maxResults: number,
	): Promise<SearchResult[]>;
}
