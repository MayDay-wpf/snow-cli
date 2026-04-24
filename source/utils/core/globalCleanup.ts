/**
 * Centralized cleanup for global/singleton resources.
 * Called by /clear command and application exit to reclaim memory.
 */

import {logger} from './logger.js';

export async function cleanupGlobalResources(): Promise<void> {
	// 1. Free the module-level tiktoken encoder in subAgentContextCompressor
	try {
		const {freeSubAgentEncoder} = await import('./subAgentContextCompressor.js');
		freeSubAgentEncoder();
	} catch {
		// Module may not be loaded yet — nothing to free
	}

	// 2. Close Puppeteer browser if launched by WebSearchService
	try {
		const {webSearchService} = await import('../../mcp/websearch.js');
		await webSearchService.closeBrowser();
	} catch {
		// websearch module not loaded or already closed
	}

	// 3. Dispose ACECodeSearchService caches
	try {
		const {aceCodeSearchService} = await import('../../mcp/aceCodeSearch.js');
		aceCodeSearchService.dispose();
	} catch {
		// ACE module not loaded
	}

	// 4. Clear sub-agent stream state maps
	try {
		const {
			clearAllTeammateStreamEntries,
			clearAllSubAgentStreamEntries,
		} = await import('../../hooks/conversation/core/subAgentMessageHandler.js');
		clearAllTeammateStreamEntries();
		clearAllSubAgentStreamEntries();
	} catch {
		// Not loaded
	}

	// 5. Clear runningSubAgentTracker
	try {
		const {runningSubAgentTracker} = await import(
			'../execution/runningSubAgentTracker.js'
		);
		runningSubAgentTracker.clear();
	} catch {
		// Not loaded
	}

	// 6. Clear conversation context
	try {
		const {clearConversationContext} = await import(
			'../codebase/conversationContext.js'
		);
		clearConversationContext();
	} catch {
		// Not loaded
	}

	// 7. Clear Ink fullStaticOutput buffer
	try {
		const ink = await import('ink') as any;
		if (typeof ink.clearInkStaticOutput === 'function') {
			ink.clearInkStaticOutput(process.stdout);
		}
	} catch {
		// Ink module not loaded
	}

	// 8. Force GC if available
	if (global.gc) {
		global.gc();
	}

	logger.info('[GlobalCleanup] Global resources cleaned up');
}
