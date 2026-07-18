import type {HandlerContext} from '../types.js';

export function arrowKeysHandler(ctx: HandlerContext): boolean {
	const {key, buffer, options, helpers} = ctx;
	const {
		showCommands,
		showFilePicker,
		disableKeyboardNavigation,
		updateFilePickerState,
		updateAgentPickerState,
		updateRunningAgentsPickerState,
		currentHistoryIndex,
		navigateHistoryUp,
		navigateHistoryDown,
		triggerUpdate,
	} = options;

	// Arrow keys for cursor movement
	if (key.leftArrow) {
		helpers.flushPendingInput();

		buffer.moveLeft();
		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();
		updateFilePickerState(text, cursorPos);
		updateAgentPickerState(text, cursorPos);
		updateRunningAgentsPickerState(text, cursorPos);
		// No need to call triggerUpdate() - buffer.moveLeft() already triggers update via scheduleUpdate()
		return true;
	}

	if (key.rightArrow) {
		helpers.flushPendingInput();

		buffer.moveRight();
		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();
		updateFilePickerState(text, cursorPos);
		updateAgentPickerState(text, cursorPos);
		updateRunningAgentsPickerState(text, cursorPos);
		// No need to call triggerUpdate() - buffer.moveRight() already triggers update via scheduleUpdate()
		return true;
	}

	if (
		key.upArrow &&
		!showCommands &&
		!showFilePicker &&
		!disableKeyboardNavigation
	) {
		helpers.flushPendingInput();

		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();
		const isEmpty = text.trim() === '';

		// Allow history navigation whenever the cursor is at the very beginning
		// of the input (position 0). For multi-line content this means the cursor
		// is on the first visual line at column 0 — pressing Up there cannot move
		// further up, so we fall through to history navigation instead.
		if (isEmpty || cursorPos === 0) {
			const navigated = navigateHistoryUp();
			if (navigated) {
				updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
				updateAgentPickerState(
					buffer.getFullText(),
					buffer.getCursorPosition(),
				);
				updateRunningAgentsPickerState(
					buffer.getFullText(),
					buffer.getCursorPosition(),
				);
				triggerUpdate();
				return true;
			}
		}

		buffer.moveUp();
		updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
		updateAgentPickerState(buffer.getFullText(), buffer.getCursorPosition());
		updateRunningAgentsPickerState(
			buffer.getFullText(),
			buffer.getCursorPosition(),
		);
		triggerUpdate();
		return true;
	}

	if (
		key.downArrow &&
		!showCommands &&
		!showFilePicker &&
		!disableKeyboardNavigation
	) {
		helpers.flushPendingInput();

		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();
		const isEmpty = text.trim() === '';

		// Allow history navigation whenever the cursor is at the very end of the
		// input (position text.length). For multi-line content this means the
		// cursor is on the last visual line at the final column — pressing Down
		// there cannot move further down, so we fall through to history navigation
		// (only when already in history mode, matching the original behavior).
		if ((isEmpty || cursorPos === text.length) && currentHistoryIndex !== -1) {
			const navigated = navigateHistoryDown();
			if (navigated) {
				updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
				updateAgentPickerState(
					buffer.getFullText(),
					buffer.getCursorPosition(),
				);
				updateRunningAgentsPickerState(
					buffer.getFullText(),
					buffer.getCursorPosition(),
				);
				triggerUpdate();
				return true;
			}
		}

		buffer.moveDown();
		updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
		updateAgentPickerState(buffer.getFullText(), buffer.getCursorPosition());
		updateRunningAgentsPickerState(
			buffer.getFullText(),
			buffer.getCursorPosition(),
		);
		triggerUpdate();
		return true;
	}

	return false;
}
