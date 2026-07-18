import type {HandlerContext} from '../types.js';

export function newlineHandler(ctx: HandlerContext): boolean {
	const {key, buffer, options, helpers} = ctx;
	const {
		updateCommandPanelState,
		updateFilePickerState,
		updateAgentPickerState,
		updateRunningAgentsPickerState,
	} = options;

	// Ctrl+Enter (Win/Linux) or Option+Enter (macOS) - Insert newline
	// Must be checked before any picker/panel key.return handlers to avoid interception
	if ((key.ctrl || key.meta) && key.return) {
		helpers.flushPendingInput();
		buffer.insert('\n');
		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();
		updateCommandPanelState(text);
		updateFilePickerState(text, cursorPos);
		updateAgentPickerState(text, cursorPos);
		updateRunningAgentsPickerState(text, cursorPos);
		return true;
	}
	return false;
}
