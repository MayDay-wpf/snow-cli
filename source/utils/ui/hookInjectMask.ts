/**
 * Visually hide Trellis / onUserMessage inject wrappers in chat bubbles.
 *
 * Project hook `inject_workflow_state.py` may prepend blocks like:
 *   <snow-mode>...</snow-mode>
 *   <trellis-snow-identity>...</trellis-snow-identity>
 *   <workflow-state>...</workflow-state>
 *
 * Those are for the model only. Showing them in the TUI (especially multi-line
 * inside Ink <Static>) causes layout thrash and leftover ghost fragments such as
 * `...trellis-check sub-agents.</snow-mode>` after re-renders.
 *
 * Raw message.content is preserved for the API; this only affects displayText.
 */

export type HookInjectMaskResult = {
	displayText: string;
	hadInject: boolean;
};

const HOOK_INJECT_BLOCK_RE =
	/<snow-mode\b[^>]*>[\s\S]*?<\/snow-mode>\s*|<trellis-snow-identity\b[^>]*>[\s\S]*?<\/trellis-snow-identity>\s*|<workflow-state\b[^>]*>[\s\S]*?<\/workflow-state>\s*/gi;

/** Strip orphaned / partial tags left by truncated history or terminal ghosts. */
const HOOK_INJECT_ORPHAN_RE =
	/<\/?snow-mode\b[^>]*>|<\/?trellis-snow-identity\b[^>]*>|<\/?workflow-state\b[^>]*>/gi;

export function maskHookInjectedText(text: string): HookInjectMaskResult {
	if (!text) {
		return {displayText: text, hadInject: false};
	}

	const stripped = text
		.replace(HOOK_INJECT_BLOCK_RE, '')
		.replace(HOOK_INJECT_ORPHAN_RE, '')
		// collapse runs of blank lines created by removed blocks
		.replace(/\n{3,}/g, '\n\n')
		.trimStart();

	const hadInject = stripped !== text;
	return {displayText: stripped, hadInject};
}
