/**
 * Patch cli-highlight to gracefully handle unknown languages
 * This must be loaded BEFORE any modules that use cli-highlight
 */

import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const cliHighlightModule = require('cli-highlight');
const hljs = require('highlight.js/lib/core');

// Register commonly used languages
try {
	// Register JavaScript and TypeScript
	hljs.registerLanguage(
		'javascript',
		require('highlight.js/lib/languages/javascript'),
	);
	hljs.registerLanguage(
		'typescript',
		require('highlight.js/lib/languages/typescript'),
	);
	hljs.registerLanguage('json', require('highlight.js/lib/languages/json'));
	hljs.registerLanguage('python', require('highlight.js/lib/languages/python'));
	hljs.registerLanguage('bash', require('highlight.js/lib/languages/bash'));
	hljs.registerLanguage('xml', require('highlight.js/lib/languages/xml'));

	// Register Vue using XML as a fallback
	const xml = require('highlight.js/lib/languages/xml');
	hljs.registerLanguage('vue', xml);
} catch (error) {
	// Silently ignore language registration errors
	console.warn(
		'Warning: Some highlight.js languages could not be registered:',
		error,
	);
}

const originalHighlight = cliHighlightModule.highlight;

// Override the highlight function to handle unknown languages gracefully
cliHighlightModule.highlight = function (code: string, options?: any) {
	try {
		return originalHighlight(code, options);
	} catch (error: any) {
		// If the error is about an unknown language, return the original code without highlighting
		if (
			error?.message?.includes('Unknown language') ||
			error?.message?.includes('Could not find the language')
		) {
			return code;
		}
		// Re-throw other unexpected errors
		throw error;
	}
};
