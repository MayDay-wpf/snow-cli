/**
 * Patch cli-highlight to gracefully handle unknown languages
 * This must be loaded BEFORE any modules that use cli-highlight
 */

import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const cliHighlightModule = require('cli-highlight');
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
