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
		const hasMultipleVisualLines = buffer.viewportVisualLines.length > 1;

		// For multi-line content, always prioritize cursor movement over history navigation.
		// Only use history navigation when the input is single-line (or empty) and cursor is at position 0.
		if (!hasMultipleVisualLines && (isEmpty || cursorPos === 0)) {
			const navigated = navigateHistoryUp();
			if (navigated) {
				updateFilePickerState(
					buffer.getFullText(),
					buffer.getCursorPosition(),
				);
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
		const hasMultipleVisualLines = buffer.viewportVisualLines.length > 1;

		// For multi-line content, always prioritize cursor movement over history navigation.
		// Only use history navigation when the input is single-line (or empty),
		// cursor is at the end, and we're already in history mode.
		if (
			!hasMultipleVisualLines &&
			(isEmpty || cursorPos === text.length) &&
			currentHistoryIndex !== -1
		) {
			const navigated = navigateHistoryDown();
			if (navigated) {
				updateFilePickerState(
					buffer.getFullText(),
					buffer.getCursorPosition(),
				);
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
