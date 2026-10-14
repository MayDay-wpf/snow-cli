/**
 * Centralized cleanup for session and global/singleton resources.
 *
 * - cleanupSessionResources(): Called by /clear command to reset conversational state
 *   WITHOUT dropping persistent MCP connections, flushing OTEL, or triggering blocking STW GC.
 * - cleanupGlobalResources(): Called on application exit / fatal crash to fully reclaim
 *   process handles, close MCP child processes, and flush telemetry.
 */

import {logger} from './logger.js';

/**
 * Lightweight cleanup executed on /clear and session resets.
 * Preserves MCP connections and tool caches to ensure zero-latency subsequent requests.
 * Never executes synchronous global.gc() to eliminate Stop-The-World main thread freezing.
 */
export async function cleanupSessionResources(): Promise<void> {
	// 1. Free the module-level tiktoken encoder in subAgentContextCompressor
	try {
		const {freeSubAgentEncoder} = await import(
			'./subAgentContextCompressor.js'
		);
		freeSubAgentEncoder();
	} catch {
		// Module may not be loaded yet — nothing to free
	}

	// 2. Clear sub-agent stream state maps
	try {
		const {clearAllTeammateStreamEntries, clearAllSubAgentStreamEntries} =
			await import('../../hooks/conversation/core/subAgentMessageHandler.js');
		clearAllTeammateStreamEntries();
		clearAllSubAgentStreamEntries();
	} catch {
		// Not loaded
	}

	// 3. Clear runningSubAgentTracker
	try {
		const {runningSubAgentTracker} = await import(
			'../execution/runningSubAgentTracker.js'
		);
		runningSubAgentTracker.clear();
	} catch {
		// Not loaded
	}

	// 4. Clear conversation context
	try {
		const {clearConversationContext} = await import(
			'../codebase/conversationContext.js'
		);
		clearConversationContext();
	} catch {
		// Not loaded
	}

	// 5. Clear Ink fullStaticOutput buffer
	try {
		const ink = (await import('ink')) as any;
		if (typeof ink.clearInkStaticOutput === 'function') {
			ink.clearInkStaticOutput(process.stdout);
		}
	} catch {
		// Ink module not loaded
	}

	// Note: We intentionally DO NOT call global.gc() here.
	// Running a full STW GC on a ~1GB V8 heap freezes the event loop for 1-5 seconds.
	// V8 idle GC handles memory reclamation naturally without blocking user interaction.

	logger.info('[SessionCleanup] Session resources reset (MCP connections preserved)');
}

/**
 * Full teardown for process exit or crash handling.
 */
export async function cleanupGlobalResources(): Promise<void> {
	// 1. Run session-level cleanup
	await cleanupSessionResources();

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

	// 4. Close persistent MCP clients + drop tools cache (prevents orphaned children on exit)
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

	logger.info('[GlobalCleanup] Global resources fully cleaned up for exit');
}

