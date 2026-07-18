/**
 * DuckDuckGo search engine implementation.
 *
 * Uses the lightweight `lite.duckduckgo.com/lite` endpoint which renders a
 * plain HTML table of results — this is the most reliable target for a
 * headless browser because it does not depend on heavy JS bundles.
 */

import type {Page} from 'puppeteer-core';
import type {SearchResult} from '../../types/websearch.types.js';
import {cleanText} from '../../utils/websearch/text.utils.js';
import type {SearchEngine, SearchEngineId} from './types.js';

export class DuckDuckGoEngine implements SearchEngine {
	readonly id: SearchEngineId = 'duckduckgo';
	readonly name = 'DuckDuckGo';

	async search(
		page: Page,
		query: string,
		maxResults: number,
	): Promise<SearchResult[]> {
		const encodedQuery = encodeURIComponent(query);
		const searchUrl = `https://lite.duckduckgo.com/lite?q=${encodedQuery}`;

		await page.goto(searchUrl, {
			waitUntil: 'networkidle2',
			timeout: 30000,
		});

		const results = await page.evaluate((maxLimit: number) => {
			type Partial = {
				title?: string;
				url?: string;
				snippet?: string;
				displayUrl?: string;
			};
			const searchResults: Partial[] = [];
			const rows = document.querySelectorAll('table tr');

			let currentResult: Partial = {};
			let resultCount = 0;

			for (const row of rows) {
				if (resultCount >= maxLimit) break;

				// Title row contains the result link
				const linkElement = row.querySelector('a.result-link');
				if (linkElement) {
					if (currentResult.title && currentResult.url) {
						searchResults.push(currentResult);
						resultCount++;
						if (resultCount >= maxLimit) break;
					}

					const title = linkElement.textContent?.trim() || '';
					const href = linkElement.getAttribute('href') || '';

					// Decode the actual URL out of DuckDuckGo's redirect wrapper
					let actualUrl = href;
					if (href.includes('uddg=')) {
						const match = href.match(/uddg=([^&]+)/);
						if (match && match[1]) {
							actualUrl = decodeURIComponent(match[1]);
						}
					}

					currentResult = {
						title,
						url: actualUrl,
						snippet: '',
						displayUrl: '',
					};
					continue;
				}

				const snippetElement = row.querySelector('td.result-snippet');
				if (snippetElement && currentResult.title) {
					currentResult.snippet =
						snippetElement.textContent?.trim() || '';
					continue;
				}

				const displayUrlElement = row.querySelector('span.link-text');
				if (displayUrlElement && currentResult.title) {
					currentResult.displayUrl =
						displayUrlElement.textContent?.trim() || '';
				}
			}

			if (
				currentResult.title &&
				currentResult.url &&
				resultCount < maxLimit
			) {
				searchResults.push(currentResult);
			}

			return searchResults;
		}, maxResults);

		return results.map(r => ({
			title: cleanText(r.title || ''),
			url: r.url || '',
			snippet: cleanText(r.snippet || ''),
			displayUrl: cleanText(r.displayUrl || ''),
		}));
	}
}
