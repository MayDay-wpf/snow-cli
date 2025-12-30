import type {ChatMessage} from '../../../api/chat.js';

/**
 * LAYER 3 PROTECTION: Clean orphaned tool_calls from conversation messages
 *
 * Removes two types of problematic messages:
 * 1. Assistant messages with tool_calls that have no corresponding tool results
 * 2. Tool result messages that have no corresponding tool_calls
 *
 * This prevents OpenAI API errors when sessions have incomplete tool_calls
 * due to force quit (Ctrl+C/ESC) during tool execution.
 *
 * @param messages - Array of conversation messages (will be modified in-place)
 */
export function cleanOrphanedToolCalls(messages: ChatMessage[]): void {
	// Build map of tool_call_ids that have results
	const toolResultIds = new Set<string>();
	for (const msg of messages) {
		if (msg.role === 'tool' && msg.tool_call_id) {
			toolResultIds.add(msg.tool_call_id);
		}
	}

	// Build map of tool_call_ids that are declared in assistant messages
	const declaredToolCallIds = new Set<string>();
	for (const msg of messages) {
		if (msg.role === 'assistant' && msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				declaredToolCallIds.add(tc.id);
			}
		}
	}

	// Find indices to remove (iterate backwards for safe removal)
	const indicesToRemove: number[] = [];

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg) continue; // Skip undefined messages (should never happen, but TypeScript requires check)

		// Check for orphaned assistant messages with tool_calls
		if (msg.role === 'assistant' && msg.tool_calls) {
			const hasAllResults = msg.tool_calls.every(tc =>
				toolResultIds.has(tc.id),
			);

			if (!hasAllResults) {
				const orphanedIds = msg.tool_calls
					.filter(tc => !toolResultIds.has(tc.id))
					.map(tc => tc.id);

				console.warn(
					'[cleanOrphanedToolCalls] Removing assistant message with orphaned tool_calls',
					{
						messageIndex: i,
						toolCallIds: msg.tool_calls.map(tc => tc.id),
						orphanedIds,
					},
				);

				indicesToRemove.push(i);
			}
		}

		// Check for orphaned tool result messages
		if (msg.role === 'tool' && msg.tool_call_id) {
			if (!declaredToolCallIds.has(msg.tool_call_id)) {
				console.warn('[cleanOrphanedToolCalls] Removing orphaned tool result', {
					messageIndex: i,
					toolCallId: msg.tool_call_id,
				});

				indicesToRemove.push(i);
			}
		}
	}

	// Remove messages in reverse order (from end to start) to preserve indices
	for (const idx of indicesToRemove) {
		messages.splice(idx, 1);
	}

	if (indicesToRemove.length > 0) {
		console.log(
			`[cleanOrphanedToolCalls] Removed ${indicesToRemove.length} orphaned messages from conversation`,
		);
	}
}
