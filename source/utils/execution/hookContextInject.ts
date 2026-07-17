/**
 * Helpers for applying hook additionalContext to model-bound messages.
 * UI bubbles should keep the user-typed text separately (typedMessage).
 */

/**
 * Prepend additionalContext to a model-bound message.
 * Empty context is a no-op.
 */
export function prependAdditionalContext(
	message: string,
	additionalContext?: string,
): string {
	if (!additionalContext || !additionalContext.trim()) {
		return message;
	}
	return `${additionalContext.trim()}\n\n${message}`;
}

/**
 * Merge session-start pending context with per-message hook context.
 * Session context is prepended first, then message-level context.
 */
export function mergeInjectedContexts(
	message: string,
	parts: Array<string | undefined>,
): string {
	const blocks = parts
		.map(p => (p && p.trim() ? p.trim() : ''))
		.filter(Boolean);
	if (blocks.length === 0) {
		return message;
	}
	return `${blocks.join('\n\n')}\n\n${message}`;
}
