import puppeteer, {type Browser, type Page} from 'puppeteer-core';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join} from 'node:path';
import {getProxyConfig} from '../utils/config/proxyConfig.js';
import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';
// Type definitions
import type {SearchResponse, WebPageContent} from './types/websearch.types.js';
import {IMAGE_MIME_TYPES} from './types/filesystem.types.js';
// Utility functions
import {
	findBrowserExecutable,
	isWSL,
	findWindowsBrowserInWSL,
	launchWindowsBrowserFromWSL,
	getRunningBrowserWSEndpoint,
} from './utils/websearch/browser.utils.js';
import {cleanText} from './utils/websearch/text.utils.js';
import {
	getSearchEngine,
	ensureSearchEnginesLoaded,
} from './engines/websearch/index.js';

/**
 * Web Search Service using a pluggable search engine (DuckDuckGo / Bing / ...)
 * driven by Puppeteer Core.
 *
 * The browser lifecycle (launch / connect / close) is owned by this service;
 * the actual per-engine search/extraction logic lives under
 * `./engines/websearch/*`. To add a new engine, implement `SearchEngine` and
 * register it in `./engines/websearch/index.ts`.
 *
 * Uses system-installed Chrome/Edge to reduce package size and supports WSL
 * by connecting to a Windows browser via WebSocket.
 */
export class WebSearchService {
	private maxResults: number;
	private browser: Browser | null = null;
	private executablePath: string | null = null;
	private isWSLMode: boolean = false;
	private userDataDir: string | undefined;
	private browserLaunchPromise: Promise<Browser> | null = null;
	private browserClosePromise: Promise<void> | null = null;

	constructor(maxResults: number = 10) {
		this.maxResults = maxResults;
		// Detect WSL environment once
		this.isWSLMode = isWSL();
		// Windows native mode: keep a stable profile per CLI process to avoid
		// lockfile cleanup issues while preventing cross-terminal profile conflicts.
		if (process.platform === 'win32' && !this.isWSLMode) {
			this.userDataDir = join(
				tmpdir(),
				`snow-cli-puppeteer-profile-${process.pid}`,
			);
		}
	}

	/**
	 * Launch browser with proxy settings from config
	 * In WSL mode, connects to Windows browser via WebSocket
	 */
	private async launchBrowser(): Promise<Browser> {
		if (this.browserClosePromise) {
			await this.browserClosePromise;
		}

		if (this.browser && this.browser.connected) {
			return this.browser;
		}

		if (this.browserLaunchPromise) {
			return this.browserLaunchPromise;
		}

		this.browserLaunchPromise = this.createBrowser().finally(() => {
			this.browserLaunchPromise = null;
		});

		return this.browserLaunchPromise;
	}

	private async createBrowser(): Promise<Browser> {
		const proxyConfig = getProxyConfig();
		const debugPort = proxyConfig.browserDebugPort || 9222;

		// WSL Mode: Connect to Windows browser via WebSocket
		if (this.isWSLMode) {
			return this.launchBrowserWSL(proxyConfig, debugPort);
		}

		// Standard Mode: Launch browser directly
		return this.launchBrowserDirect(proxyConfig);
	}

	/**
	 * Launch browser in WSL mode by connecting to Windows browser
	 */
	private async launchBrowserWSL(
		proxyConfig: ReturnType<typeof getProxyConfig>,
		debugPort: number,
	): Promise<Browser> {
		// First check if browser is already running on debug port
		let wsEndpoint = await getRunningBrowserWSEndpoint(debugPort);

		if (!wsEndpoint) {
			// Need to launch Windows browser
			// Priority: 1. User-configured path, 2. Auto-detect Windows browser in WSL
			let browserPath: string | null | undefined = proxyConfig.browserPath;

			if (!browserPath || !existsSync(browserPath)) {
				browserPath = findWindowsBrowserInWSL();
			}

			if (!browserPath) {
				throw new Error(
					'No Windows browser found in WSL environment. Please install Chrome or Edge on Windows, ' +
						'or configure browser path in ~/.snow/proxy-config.json (browserPath). ' +
						'Expected paths: /mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
				);
			}

			// Launch Windows browser with remote debugging
			wsEndpoint = await launchWindowsBrowserFromWSL(browserPath, debugPort);

			if (!wsEndpoint) {
				throw new Error(
					`Failed to launch Windows browser from WSL. Browser path: ${browserPath}. ` +
						`Debug port: ${debugPort}. Make sure the browser is not already running ` +
						`or try a different port in ~/.snow/proxy-config.json (browserDebugPort).`,
				);
			}
		}

		try {
			this.browser = await puppeteer.connect({
				browserWSEndpoint: wsEndpoint,
			});
			return this.browser;
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to connect to Windows browser via WebSocket. Endpoint: ${wsEndpoint}. ` +
					`Original error: ${errorMessage}`,
			);
		}
	}

	/**
	 * Launch browser directly (non-WSL mode)
	 */
	private async launchBrowserDirect(
		proxyConfig: ReturnType<typeof getProxyConfig>,
	): Promise<Browser> {
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

		try {
			this.browser = await puppeteer.launch({
				executablePath: this.executablePath,
				headless: true,
				args: launchArgs,
				userDataDir: this.userDataDir,
			});
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const browserPathInfo = this.executablePath
				? `Browser path: ${this.executablePath}`
				: 'Browser path not set';
			throw new Error(
				`Failed to launch the browser process. ${browserPathInfo}. On Linux, ensure Chromium/Chrome is installed and required dependencies are available. You can set a custom browser path in Settings > Proxy & Browser or in ~/.snow/proxy-config.json (browserPath). Original error: ${errorMessage}`,
			);
		}

		return this.browser;
	}

	/**
	 * Close browser instance
	 */
	async closeBrowser(): Promise<void> {
		if (this.browserClosePromise) {
			return this.browserClosePromise;
		}

		this.browserClosePromise = this.closeBrowserInternal().finally(() => {
			this.browserClosePromise = null;
		});

		return this.browserClosePromise;
	}

	private async closeBrowserInternal(): Promise<void> {
		const browser = this.browserLaunchPromise
			? await this.browserLaunchPromise.catch(() => null)
			: this.browser;

		if (!browser) {
			this.browser = null;
			return;
		}

		if (this.isWSLMode) {
			// In WSL mode, just disconnect (don't close the Windows browser)
			try {
				if (browser.connected) {
					browser.disconnect();
				}
			} catch {
				// Ignore disconnect errors
			}
		} else {
			try {
				if (browser.connected) {
					await browser.close();
				}
			} catch {
				// Ignore close errors (e.g., Windows EBUSY/lockfile issues)
			}
		}

		if (this.browser === browser) {
			this.browser = null;
		}
	}

	private async closePage(page: Page | null): Promise<void> {
		if (!page || page.isClosed()) {
			return;
		}

		try {
			await page.close();
		} catch {
			// Ignore close errors. Page cleanup must not mask the real tool result.
		}
	}

	/**
	 * Perform a web search using the engine selected in proxy config.
	 * @param query - Search query string
	 * @param maxResults - Maximum number of results to return (default: 10)
	 * @returns Search results with title, URL, and snippet
	 */
	async search(query: string, maxResults?: number): Promise<SearchResponse> {
		const limit = maxResults || this.maxResults;
		let page: Page | null = null;

		try {
			// Resolve search engine from current proxy/search config. Ensure
			// user-supplied plugins under ~/.snow/plugin/search_engines/ are
			// loaded into the registry before resolving — this is a no-op after
			// the first call.
			await ensureSearchEnginesLoaded();
			const proxyConfig = getProxyConfig();
			const engine = getSearchEngine(proxyConfig.searchEngine);

			// Launch browser with proxy
			const browser = await this.launchBrowser();
			page = await browser.newPage();

			// Set realistic user agent
			await page.setUserAgent(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			);

			// Delegate the actual search/extraction to the engine.
			const cleanedResults = await engine.search(page, query, limit);

			return {
				query,
				results: cleanedResults,
				totalResults: cleanedResults.length,
			};
		} catch (error: any) {
			throw new Error(`Web search failed: ${error.message}`);
		} finally {
			await this.closePage(page);
		}
	}

	private getImageMimeTypeFromUrl(url: string): string | undefined {
		try {
			const pathname = new URL(url).pathname;
			const ext = extname(pathname).toLowerCase();
			return IMAGE_MIME_TYPES[ext as keyof typeof IMAGE_MIME_TYPES];
		} catch {
			return undefined;
		}
	}

	private normalizeImageMimeType(
		contentType: string | null,
	): string | undefined {
		if (!contentType) {
			return undefined;
		}

		const mimeType = contentType.split(';')[0]?.trim().toLowerCase();
		return mimeType && mimeType.startsWith('image/') ? mimeType : undefined;
	}

	private async convertImageBufferToBase64(
		buffer: Buffer,
		mimeType: string,
	): Promise<{data: string; mimeType: string}> {
		if (mimeType === 'image/svg+xml') {
			try {
				const sharp = (await import('sharp')).default;
				const pngBuffer = await sharp(buffer).png().toBuffer();

				return {
					data: pngBuffer.toString('base64'),
					mimeType: 'image/png',
				};
			} catch {
				return {
					data: buffer.toString('base64'),
					mimeType,
				};
			}
		}

		return {
			data: buffer.toString('base64'),
			mimeType,
		};
	}

	private async fetchRemoteImageAsBase64(
		url: string,
		abortSignal?: AbortSignal,
	): Promise<{data: string; mimeType: string} | null> {
		const mimeTypeFromUrl = this.getImageMimeTypeFromUrl(url);
		const response = await fetch(
			url,
			addProxyToFetchOptions(url, {
				signal: abortSignal,
				headers: {
					Accept:
						'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
				},
			}),
		);

		if (!response.ok) {
			if (mimeTypeFromUrl) {
				throw new Error(
					`Failed to fetch image: ${response.status} ${response.statusText}`,
				);
			}

			return null;
		}

		const mimeType =
			this.normalizeImageMimeType(response.headers.get('content-type')) ||
			mimeTypeFromUrl;
		if (!mimeType) {
			return null;
		}

		const arrayBuffer = await response.arrayBuffer();
		return this.convertImageBufferToBase64(Buffer.from(arrayBuffer), mimeType);
	}

	/**
	 * Fetch and extract content from a web page
	 * @param url - URL of the web page to fetch
	 * @param maxLength - Maximum content length (default: 50000 characters)
	 * @param isUserProvided - Whether the URL is user-provided (true) or from search results (false). User-provided URLs ALWAYS skip AI summarization.
	 * @param userQuery - Optional user query for content extraction using compact model agent
	 * @param abortSignal - Optional abort signal from main flow
	 * @param onTokenUpdate - Optional callback to update token count during compression
	 * @param enableAiSummary - Whether to enable AI summarization for non-user-provided URLs (default: false). Ignored when isUserProvided=true.
	 * @returns Cleaned page content, or multimodal text + image content for direct image URLs
	 */
	async fetchPage(
		url: string,
		maxLength: number = 50000,
		isUserProvided: boolean = false,
		userQuery?: string,
		abortSignal?: AbortSignal,
		onTokenUpdate?: (tokenCount: number) => void,
		enableAiSummary: boolean = false,
	): Promise<WebPageContent> {
		let page: Page | null = null;

		try {
			if (isUserProvided || this.getImageMimeTypeFromUrl(url)) {
				const imageContent = await this.fetchRemoteImageAsBase64(
					url,
					abortSignal,
				);

				if (imageContent) {
					const text = `Image URL fetched successfully: ${url} (${imageContent.mimeType})`;

					return {
						url,
						title: 'Image',
						content: [
							{type: 'text', text},
							{
								type: 'image',
								data: imageContent.data,
								mimeType: imageContent.mimeType,
							},
						],
						textLength: text.length,
						contentPreview: text,
					};
				}
			}

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

			// Release the Puppeteer page before optional AI compression. Compression can
			// take much longer than DOM extraction and must not keep browser resources busy.
			await this.closePage(page);
			page = null;

			// Use compact agent to extract key information if userQuery is provided
			// Skip compression for user-provided URLs OR when AI summary is not requested
			let finalContent = cleanedContent;
			if (userQuery && !isUserProvided && enableAiSummary) {
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
			throw new Error(`Failed to fetch page: ${error.message}`);
		} finally {
			await this.closePage(page);
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
			'Search the web using the configured search engine (DuckDuckGo or Bing). Returns a list of search results with titles, URLs, and snippets. Best for finding current information, documentation, news, or general web content. **IMPORTANT WORKFLOW**: After getting search results, analyze them and choose ONLY ONE most credible and relevant page to fetch. Do NOT fetch multiple pages - reading one high-quality source is sufficient and more efficient.',
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
			'Fetch and read the full content of a web page or a direct image URL. For HTML pages, automatically cleans and extracts main text content. For direct image URLs (detected by image content-type or image file extension), downloads the image, converts it to base64, and returns multimodal content with an image block so the model can inspect the image. **USAGE RULE**: Only fetch ONE page per search - choose the most credible and relevant result (prefer official documentation, reputable tech sites, or well-known sources). **COMPRESSION CONTROL**: User-provided URLs (isUserProvided=true) ALWAYS return full cleaned content without AI summarization. For AI-discovered URLs (isUserProvided=false), use enableAiSummary to choose: true = compact AI model extracts query-relevant info (80-95% smaller), false = return full cleaned content. Set enableAiSummary=true when you only need targeted facts; set false when you need the original full text.',
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description:
						'Full URL of the web page or direct image to fetch (e.g., "https://example.com/article" or "https://example.com/image.png")',
				},
				maxLength: {
					type: 'number',
					description:
						'Maximum content length in characters for HTML pages (default: 50000, max: 100000). Ignored for direct image URLs.',
					default: 50000,
					minimum: 1000,
					maximum: 100000,
				},
				isUserProvided: {
					type: 'boolean',
					description:
						'REQUIRED: Whether the URL is directly provided by the user (true) or from search results / AI-discovered (false). User-provided URLs ALWAYS skip AI summarization regardless of enableAiSummary.',
				},
				enableAiSummary: {
					type: 'boolean',
					description:
						'Whether to apply AI summarization for non-user-provided HTML pages. Only effective when isUserProvided=false AND userQuery is provided. Default: false (return full cleaned content). Ignored for direct image URLs.',
					default: false,
				},
				userQuery: {
					type: 'string',
					description:
						"Optional: User's original question or query. Only used for non-user-provided HTML pages when enableAiSummary=true. Direct image URLs are returned as image content instead of summarized text.",
				},
			},
			required: ['url', 'isUserProvided'],
		},
	},
];
