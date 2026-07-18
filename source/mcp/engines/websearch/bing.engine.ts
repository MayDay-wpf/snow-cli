/**
 * Bing search engine implementation.
 *
 * Uses the public Bing search page (https://www.bing.com/search?q=...) and
 * scrapes the rendered DOM via Puppeteer. Does NOT use any official API.
 *
 * DOM contract used here (verified against current Bing layout, 2026):
 *   - Each organic result lives in `li.b_algo`
 *   - The canonical link element is `.b_tpcn a.tilk` (preferred) or `h2 > a`
 *     (the title heading also wraps an anchor with the same href)
 *   - Snippet text is in `.b_caption p` (often `p.b_lineclamp2`); some
 *     answers/cards put text directly under `.b_caption` without a `<p>`
 *   - Display URL: `.b_attribution cite` (fallback: any `cite` inside item)
 *
 * Robustness notes:
 *   - We use `domcontentloaded` instead of `networkidle2` because Bing keeps
 *     loading tracking/telemetry scripts long after results are painted,
 *     which often causes `networkidle2` to time out and produce empty results.
 *   - We try several wait selectors (`#b_results`, `li.b_algo`) and never
 *     throw if waiting times out — extraction will simply return [] and the
 *     caller can fall back to another engine.
 *   - We skip non-organic items inside `#b_results` such as `.b_ad`,
 *     `.b_msg`, `.b_pag`, ads or "people also ask" blocks.
 */

import type {Page} from 'puppeteer-core';
import type {SearchResult} from '../../types/websearch.types.js';
import {cleanText} from '../../utils/websearch/text.utils.js';
import type {SearchEngine, SearchEngineId} from './types.js';

export class BingEngine implements SearchEngine {
	readonly id: SearchEngineId = 'bing';
	readonly name = 'Bing';

	async search(
		page: Page,
		query: string,
		maxResults: number,
	): Promise<SearchResult[]> {
		const encodedQuery = encodeURIComponent(query);
		// `setlang=en` + `cc=us` is only a hint; Bing may still redirect CN
		// clients to cn.bing.com and serve zh-CN UI. The DOM contract is the
		// same in both cases, so this is fine.
		const searchUrl =
			`https://www.bing.com/search?q=${encodedQuery}` +
			`&count=${Math.max(maxResults, 10)}&setlang=en&cc=us`;

		try {
			await page.goto(searchUrl, {
				waitUntil: 'domcontentloaded',
				timeout: 30000,
			});
		} catch {
			// Navigation timeout — try to extract whatever already loaded.
		}

		// Wait for the results container. Try the most specific selector first,
		// then fall back. Never throw — empty extraction is a valid outcome.
		try {
			await page.waitForSelector('#b_results li.b_algo', {timeout: 10000});
		} catch {
			try {
				await page.waitForSelector('#b_results', {timeout: 3000});
			} catch {
				// Fall through.
			}
		}

		const results = await page.evaluate((maxLimit: number) => {
			type Partial = {
				title?: string;
				url?: string;
				snippet?: string;
				displayUrl?: string;
			};

			const out: Partial[] = [];
			const items = document.querySelectorAll('#b_results > li.b_algo');

			const isHttpUrl = (u: string): boolean =>
				/^https?:\/\//i.test(u);

			for (const item of items) {
				if (out.length >= maxLimit) break;

				// Skip ad/sponsored variants that may share the b_algo class.
				if (
					item.classList.contains('b_ad') ||
					item.querySelector('.b_adlabel, .b_ad_text')
				) {
					continue;
				}

				// Prefer the top-card link (.b_tpcn a.tilk) because its href is
				// the canonical destination URL. Fall back to h2 > a.
				const tilkEl = item.querySelector(
					'.b_tpcn a.tilk',
				) as HTMLAnchorElement | null;
				const headingEl = item.querySelector(
					'h2 a',
				) as HTMLAnchorElement | null;

				const linkEl = tilkEl ?? headingEl;
				if (!linkEl) continue;

				const url = linkEl.getAttribute('href') || '';
				if (!url || !isHttpUrl(url)) continue;

				// Title comes from the <h2> heading; fall back to tilk aria-label
				// or text content if heading is missing.
				let title = headingEl?.textContent?.trim() || '';
				if (!title) {
					title =
						tilkEl?.getAttribute('aria-label')?.trim() ||
						tilkEl?.textContent?.trim() ||
						'';
				}
				if (!title) continue;

				// Snippet: try common Bing layouts in priority order.
				let snippet = '';
				const snippetCandidates: Array<string> = [
					'.b_caption p.b_lineclamp2',
					'.b_caption p',
					'.b_richcard .b_caption',
					'.b_snippet',
					'.b_caption',
					'.b_paractl',
				];
				for (const sel of snippetCandidates) {
					const el = item.querySelector(sel);
					const txt = el?.textContent?.trim();
					if (txt) {
						snippet = txt;
						break;
					}
				}

				// Display URL: prefer cite inside attribution; fallback any cite.
				const citeEl =
					item.querySelector('.b_attribution cite') ||
					item.querySelector('cite');
				const displayUrl = citeEl?.textContent?.trim() || '';

				out.push({title, url, snippet, displayUrl});
			}

			return out;
		}, maxResults);

		return results.map(r => ({
			title: cleanText(r.title || ''),
			url: r.url || '',
			snippet: cleanText(r.snippet || ''),
			displayUrl: cleanText(r.displayUrl || ''),
		}));
	}
}
