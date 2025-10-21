/**
 * Text processing utilities for web search
 */

import type {SearchResponse} from '../../types/websearch.types.js';

/**
 * Clean text by removing extra whitespace and HTML entities
 * @param text - Raw text to clean
 * @returns Cleaned text
 */
export function cleanText(text: string): string {
	return text
		.replace(/\s+/g, ' ') // Replace multiple spaces with single space
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/<b>/g, '')
		.replace(/<\/b>/g, '')
		.trim();
}

/**
 * Format search results as readable text for AI consumption
 * @param searchResponse - Search response object
 * @returns Formatted text representation
 */
export function formatSearchResults(searchResponse: SearchResponse): string {
	const {query, results, totalResults} = searchResponse;

	let output = `Search Results for: "${query}"\n`;
	output += `Found ${totalResults} results\n\n`;
	output += '='.repeat(80) + '\n\n';

	results.forEach((result, index) => {
		output += `${index + 1}. ${result.title}\n`;
		output += `   URL: ${result.url}\n`;
		if (result.snippet) {
			output += `   ${result.snippet}\n`;
		}
		output += '\n';
	});

	return output;
}
