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
	content: string;
	textLength: number;
	contentPreview: string;
}
