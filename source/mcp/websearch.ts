import puppeteer, {type Browser, type Page} from 'puppeteer-core';
import {existsSync} from 'node:fs';
import {getProxyConfig} from '../utils/config/proxyConfig.js';
// Type definitions
import type {
	SearchResult,
	SearchResponse,
	WebPageContent,
} from './types/websearch.types.js';
// Utility functions
import {findBrowserExecutable} from './utils/websearch/browser.utils.js';
import {cleanText} from './utils/websearch/text.utils.js';

/**
 * Web Search Service using DuckDuckGo Lite with Puppeteer Core
 * Provides web search functionality with real browser support and proxy
 * Uses system-installed Chrome/Edge to reduce package size
 */
export class WebSearchService {
	private maxResults: number;
	private browser: Browser | null = null;
	private executablePath: string | null = null;

	constructor(maxResults: number = 10) {
		this.maxResults = maxResults;
	}

	/**
	 * Launch browser with proxy settings from config
	 */
	private async launchBrowser(): Promise<Browser> {
		if (this.browser && this.browser.connected) {
			return this.browser;
		}

		const proxyConfig = getProxyConfig();

		// Find browser executable path (cache it)
		// Priority: 1. User-configured path, 2. Auto-detect
		if (!this.executablePath) {
			// First try user-configured browser path
			if (proxyConfig.browserPath && existsSync(proxyConfig.browserPath)) {
				this.executablePath = proxyConfig.browserPath;
			} else {
				// Fallback to auto-detection
				this.executablePath = findBrowserExecutable();
				if (!this.executablePath) {
					throw new Error(
						'No system browser found. Please install Chrome or Edge browser, or configure browser path in Proxy settings.',
					);
				}
			}
		}

		const launchArgs = [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-accelerated-2d-canvas',
			'--disable-gpu',
		];

		// Only add proxy if enabled
		if (proxyConfig.enabled) {
			launchArgs.unshift(`--proxy-server=http://127.0.0.1:${proxyConfig.port}`);
		}

		this.browser = await puppeteer.launch({
			executablePath: this.executablePath,
			headless: true,
			args: launchArgs,
		});

		return this.browser;
	}

	/**
	 * Close browser instance
	 */
	async closeBrowser(): Promise<void> {
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}
	}

	/**
	 * Perform a web search using DuckDuckGo
	 * @param query - Search query string
	 * @param maxResults - Maximum number of results to return (default: 10)
	 * @returns Search results with title, URL, and snippet
	 */
	async search(query: string, maxResults?: number): Promise<SearchResponse> {
		const limit = maxResults || this.maxResults;
		let page: Page | null = null;

		try {
			// Launch browser with proxy
			const browser = await this.launchBrowser();
			page = await browser.newPage();

			// Set realistic user agent
			await page.setUserAgent(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			);

			// Encode query for URL
			const encodedQuery = encodeURIComponent(query);
			const searchUrl = `https://lite.duckduckgo.com/lite?q=${encodedQuery}`;

			// Navigate to search page with timeout
			await page.goto(searchUrl, {
				waitUntil: 'networkidle2',
				timeout: 30000,
			});

			// Extract search results from the page
			const results = await page.evaluate((maxLimit: number) => {
				const searchResults: SearchResult[] = [];
				const rows = document.querySelectorAll('table tr');

				let currentResult: Partial<SearchResult> = {};
				let resultCount = 0;

				for (const row of rows) {
					if (resultCount >= maxLimit) break;

					// Check if this row contains a link (title row)
					const linkElement = row.querySelector('a.result-link');
					if (linkElement) {
						// Save previous result if exists
						if (currentResult.title && currentResult.url) {
							searchResults.push(currentResult as SearchResult);
							resultCount++;
							if (resultCount >= maxLimit) break;
						}

						// Start new result
						const title = linkElement.textContent?.trim() || '';
						const href = linkElement.getAttribute('href') || '';

						// Extract actual URL from DuckDuckGo redirect
						let actualUrl = href;
						if (href.includes('uddg=')) {
							const match = href.match(/uddg=([^&]+)/);
							if (match && match[1]) {
								actualUrl = decodeURIComponent(match[1]);
							}
						}

						currentResult = {
							title: title,
							url: actualUrl,
							snippet: '',
							displayUrl: '',
						};
						continue;
					}

					// Check if this row contains snippet
					const snippetElement = row.querySelector('td.result-snippet');
					if (snippetElement && currentResult.title) {
						currentResult.snippet = snippetElement.textContent?.trim() || '';
						continue;
					}

					// Check if this row contains display URL
					const displayUrlElement = row.querySelector('span.link-text');
					if (displayUrlElement && currentResult.title) {
						currentResult.displayUrl =
							displayUrlElement.textContent?.trim() || '';
					}
				}

				// Add last result if exists
				if (
					currentResult.title &&
					currentResult.url &&
					resultCount < maxLimit
				) {
					searchResults.push(currentResult as SearchResult);
				}

				return searchResults;
			}, limit);

			// Clean text in results
			const cleanedResults = results.map(result => ({
				title: cleanText(result.title),
				url: result.url,
				snippet: cleanText(result.snippet),
				displayUrl: cleanText(result.displayUrl),
			}));

			// Close the page
			await page.close();

			return {
				query,
				results: cleanedResults,
				totalResults: cleanedResults.length,
			};
		} catch (error: any) {
			// Clean up page on error
			if (page) {
				try {
					await page.close();
				} catch {
					// Ignore close errors
				}
			}

			throw new Error(`Web search failed: ${error.message}`);
		}
	}

	/**
	 * Fetch and extract content from a web page
	 * @param url - URL of the web page to fetch
	 * @param maxLength - Maximum content length (default: 50000 characters)
	 * @param isUserProvided - Whether the URL is user-provided (true) or from search results (false)
	 * @param userQuery - Optional user query for content extraction using compact model agent
	 * @param abortSignal - Optional abort signal from main flow
	 * @param onTokenUpdate - Optional callback to update token count during compression
	 * @returns Cleaned page content
	 */
	async fetchPage(
		url: string,
		maxLength: number = 50000,
		isUserProvided: boolean = false,
		userQuery?: string,
		abortSignal?: AbortSignal,
		onTokenUpdate?: (tokenCount: number) => void,
	): Promise<WebPageContent> {
		let page: Page | null = null;

		try {
			// Launch browser with proxy
			const browser = await this.launchBrowser();
			page = await browser.newPage();

			// Set realistic user agent
			await page.setUserAgent(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			);

			// Navigate to page with timeout
			await page.goto(url, {
				waitUntil: 'networkidle2',
				timeout: 30000,
			});

			// Extract content using browser context
			const pageData = await page.evaluate(() => {
				// Remove unwanted elements
				const selectorsToRemove = [
					'script',
					'style',
					'nav',
					'header',
					'footer',
					'iframe',
					'noscript',
					'svg',
					'.advertisement',
					'.ad',
					'.ads',
					'#cookie-banner',
					'.cookie-notice',
					'.social-share',
					'.comments',
					'.sidebar',
					'[role="banner"]',
					'[role="navigation"]',
					'[role="complementary"]',
				];

				selectorsToRemove.forEach(selector => {
					document.querySelectorAll(selector).forEach(el => el.remove());
				});

				// Get title
				const title = document.title || '';

				// Try to find main content area
				let mainContent: Element | null = null;
				const mainSelectors = [
					'article',
					'main',
					'[role="main"]',
					'.main-content',
					'.content',
					'#content',
					'.article-body',
					'.post-content',
				];

				for (const selector of mainSelectors) {
					mainContent = document.querySelector(selector);
					if (mainContent) break;
				}

				// Fallback to body if no main content found
				const contentElement = mainContent || document.body;

				// Extract text content
				const textContent = contentElement.textContent || '';

				return {
					title,
					textContent,
				};
			});

			// Clean and process the text
			let cleanedContent = pageData.textContent
				.replace(/\s+/g, ' ') // Replace multiple spaces with single space
				.replace(/\n\s*\n/g, '\n') // Remove empty lines
				.trim();

			// Limit content length
			if (cleanedContent.length > maxLength) {
				cleanedContent =
					cleanedContent.slice(0, maxLength) + '\n\n[Content truncated...]';
			}

			// Create preview (first 500 characters)
			const contentPreview =
				cleanedContent.slice(0, 500) +
				(cleanedContent.length > 500 ? '...' : '');

			// Close the page
			await page.close();

			// Use compact agent to extract key information if userQuery is provided
			// Skip compression for user-provided URLs - return full cleaned content
			let finalContent = cleanedContent;
			if (userQuery && !isUserProvided) {
				try {
					const {compactAgent} = await import('../agents/compactAgent.js');
					const isAvailable = await compactAgent.isAvailable();

					if (isAvailable) {
						// Use compact model to extract relevant information
						// No timeout - let it run as long as needed
						finalContent = await compactAgent.extractWebPageContent(
							cleanedContent,
							userQuery,
							url,
							abortSignal,
							onTokenUpdate,
						);
					}
				} catch (error: any) {
					// If compact agent fails, fallback to original content
					// Error is already logged in compactAgent
				}
			}

			return {
				url,
				title: cleanText(pageData.title),
				content: finalContent,
				textLength: finalContent.length,
				contentPreview,
			};
		} catch (error: any) {
			// Clean up page on error
			if (page) {
				try {
					await page.close();
				} catch {
					// Ignore close errors
				}
			}

			throw new Error(`Failed to fetch page: ${error.message}`);
		}
	}
}

// Export a default instance
export const webSearchService = new WebSearchService();

// MCP Tool definitions
export const mcpTools = [
	{
		name: 'websearch-search',
		description:
			'Search the web using DuckDuckGo. Returns a list of search results with titles, URLs, and snippets. Best for finding current information, documentation, news, or general web content. **IMPORTANT WORKFLOW**: After getting search results, analyze them and choose ONLY ONE most credible and relevant page to fetch. Do NOT fetch multiple pages - reading one high-quality source is sufficient and more efficient.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Search query string (e.g., "Claude latest model", "TypeScript best practices")',
				},
				maxResults: {
					type: 'number',
					description:
						'Maximum number of results to return (default: 10, max: 20)',
					default: 10,
					minimum: 1,
					maximum: 20,
				},
			},
			required: ['query'],
		},
	},
	{
		name: 'websearch-fetch',
		description:
			'Fetch and read the full content of a web page. Automatically cleans HTML and extracts the main text content, removing ads, navigation, and other noise. **USAGE RULE**: Only fetch ONE page per search - choose the most credible and relevant result (prefer official documentation, reputable tech sites, or well-known sources). **IMPORTANT**: The isUserProvided parameter determines whether content is compressed - user-provided URLs return full cleaned content, while search result URLs use AI compression.',
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description:
						'Full URL of the web page to fetch (e.g., "https://example.com/article")',
				},
				maxLength: {
					type: 'number',
					description:
						'Maximum content length in characters (default: 50000, max: 100000)',
					default: 50000,
					minimum: 1000,
					maximum: 100000,
				},
				isUserProvided: {
					type: 'boolean',
					description:
						'REQUIRED: Whether the URL is directly provided by the user (true) or from search results (false). If true, returns full cleaned content without AI compression. If false, uses compact AI model to extract relevant information based on userQuery.',
				},
				userQuery: {
					type: 'string',
					description:
						"Optional: User's original question or query. Only used when isUserProvided=false for intelligent content extraction - the compact AI model will extract only information relevant to this query, reducing content size by 80-95%.",
				},
			},
			required: ['url', 'isUserProvided'],
		},
	},
];
