/**
 * Global conversation context for snapshot management
 * Provides current session ID and message index to filesystem operations
 */

let currentSessionId: string | undefined;
let currentMessageIndex: number | undefined;

/**
 * Set current conversation context
 */
export function setConversationContext(
	sessionId: string,
	messageIndex: number,
): void {
	currentSessionId = sessionId;
	currentMessageIndex = messageIndex;
}

/**
 * Get current conversation context
 * Returns undefined if not in a conversation context
 */
export function getConversationContext():
	| {sessionId: string; messageIndex: number}
	| undefined {
	if (currentSessionId !== undefined && currentMessageIndex !== undefined) {
		return {sessionId: currentSessionId, messageIndex: currentMessageIndex};
	}
	return undefined;
}

/**
 * Clear conversation context
 */
export function clearConversationContext(): void {
	currentSessionId = undefined;
	currentMessageIndex = undefined;
}
