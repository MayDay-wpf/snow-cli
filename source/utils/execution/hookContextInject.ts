/**
 * Helpers for applying hook additionalContext to model-bound messages.
 * UI bubbles should keep the user-typed text separately (typedMessage).
 *
 * Prepend-style additionalContext is API-only (same layer as AGENTS inject).
 * Exit-1 replace remains a session fact and is persisted.
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

export type OnUserMessageHookApplyResult = {
	/** Base user body for UI / session / bash (no prepend inject). */
	content: string;
	/** Exit-1 full rewrite — persist as session content. */
	isReplace: boolean;
	/** Prepend-only contexts for the live API payload (not persisted). */
	apiOnlyContext?: string;
};

/**
 * Apply one onUserMessage result after the session-start context has been
 * consumed.
 *
 * - exit 1 replace → content is rewritten; no API-only prepend
 * - additionalContext / session pending → stay on apiOnlyContext (not content)
 */
export function applyOnUserMessageHookResult(
	message: string,
	result: {
		action: 'continue' | 'block' | 'replace' | 'warn';
		replacedContent?: string;
		additionalContext?: string;
	},
	pendingContext?: string,
): OnUserMessageHookApplyResult {
	if (result.action === 'replace' && result.replacedContent) {
		// Exit-1 replacement intentionally discards both prepend contexts.
		return {
			content: result.replacedContent,
			isReplace: true,
		};
	}

	const blocks = [pendingContext, result.additionalContext]
		.map(p => (p && p.trim() ? p.trim() : ''))
		.filter(Boolean);

	return {
		content: message,
		isReplace: false,
		...(blocks.length > 0 ? {apiOnlyContext: blocks.join('\n\n')} : {}),
	};
}
