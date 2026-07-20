/**
 * Type definitions for Web Search Service
 */

/**
 * Search result item
 */
export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	displayUrl: string;
}

/**
 * Search response
 */
export interface SearchResponse {
	query: string;
	results: SearchResult[];
	totalResults: number;
}

/**
 * Web page content
 */
export interface WebPageContent {
	url: string;
	title: string;
	content:
		| string
		| Array<
				| {type: 'text'; text: string}
				| {type: 'image'; data: string; mimeType: string}
		  >;
	textLength: number;
	contentPreview: string;
	/** How the returned content was produced (optional for backward compatibility). */
	summaryStatus?:
		| 'summarized'
		| 'fallback_timeout'
		| 'fallback_error'
		| 'raw'
		| 'unavailable';
	/** Content serialization format. Fetch pages use lightweight markdown-ish text. */
	contentFormat?: 'text' | 'markdown';
}
