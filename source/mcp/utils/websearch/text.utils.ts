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
 * Normalize lightweight markdown-ish page text:
 * - collapse spaces within lines
 * - keep paragraph breaks (max one blank line)
 * - trim edges
 */
export function normalizeLightweightMarkdown(text: string): string {
	return text
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Truncate markdown-ish content near a paragraph boundary when possible.
 * If truncation splits a fenced code block, append a closing fence.
 */
export function truncateLightweightMarkdown(
	text: string,
	maxLength: number,
): string {
	if (maxLength <= 0 || text.length <= maxLength) {
		return text;
	}

	const hardLimit = Math.max(0, maxLength);
	let cutAt = hardLimit;
	const windowStart = Math.max(0, hardLimit - 400);
	const paragraphBreak = text.lastIndexOf('\n\n', hardLimit);
	if (paragraphBreak >= windowStart) {
		cutAt = paragraphBreak;
	} else {
		const lineBreak = text.lastIndexOf('\n', hardLimit);
		if (lineBreak >= windowStart) {
			cutAt = lineBreak;
		}
	}

	let truncated = text.slice(0, cutAt).trimEnd();
	const fenceCount = (truncated.match(/^```/gm) || []).length;
	if (fenceCount % 2 === 1) {
		truncated += '\n```';
	}

	return `${truncated}\n\n[Content truncated...]`;
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
