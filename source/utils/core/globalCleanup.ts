/**
 * Centralized cleanup for global/singleton resources.
 * Called by /clear command and application exit (incl. fatal crash path)
 * to reclaim memory and avoid orphaned MCP / browser / OTEL handles on Windows.
 */

import {logger} from './logger.js';

export async function cleanupGlobalResources(): Promise<void> {
	// 1. Free the module-level tiktoken encoder in subAgentContextCompressor
	try {
		const {freeSubAgentEncoder} = await import(
			'./subAgentContextCompressor.js'
		);
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

	// 4. Close persistent MCP clients + drop tools cache (prevents orphaned children)
	try {
		const {closeAllMCPConnections, clearMCPToolsCache} = await import(
			'../execution/mcpToolsManager.js'
		);
		await Promise.race([
			closeAllMCPConnections(),
			new Promise<void>(resolve => setTimeout(resolve, 2000)),
		]);
		clearMCPToolsCache();
	} catch {
		// MCP manager not loaded
	}

	// 5. Flush OpenTelemetry (process.exit bypasses beforeExit)
	try {
		const {shutdownTelemetry} = await import('../telemetry/otel.js');
		await Promise.race([
			shutdownTelemetry(),
			new Promise<void>(resolve => setTimeout(resolve, 2000)),
		]);
	} catch {
		// OTEL not started
	}

	// 6. Clear sub-agent stream + live slot state maps
	try {
		const {clearAllTeammateStreamEntries, clearAllSubAgentStreamEntries} =
			await import('../../hooks/conversation/core/subAgentMessageHandler.js');
		clearAllTeammateStreamEntries();
		// Also clears live slots (see clearAllSubAgentStreamEntries implementation).
		clearAllSubAgentStreamEntries();
	} catch {
		// Not loaded
	}

	// 7. Clear runningSubAgentTracker
	try {
		const {runningSubAgentTracker} = await import(
			'../execution/runningSubAgentTracker.js'
		);
		runningSubAgentTracker.clear();
	} catch {
		// Not loaded
	}

	// 8. Clear conversation context
	try {
		const {clearConversationContext} = await import(
			'../codebase/conversationContext.js'
		);
		clearConversationContext();
	} catch {
		// Not loaded
	}

	// 9. Clear Ink fullStaticOutput buffer
	try {
		const ink = (await import('ink')) as any;
		if (typeof ink.clearInkStaticOutput === 'function') {
			ink.clearInkStaticOutput(process.stdout);
		}
	} catch {
		// Ink module not loaded
	}

	// 10. Force GC if available
	if (global.gc) {
		global.gc();
	}

	logger.info('[GlobalCleanup] Global resources cleaned up');
}
