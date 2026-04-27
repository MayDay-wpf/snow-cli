import type {Key} from 'ink';
import {TextBuffer} from '../../../utils/ui/textBuffer.js';
import type {
	HandlerContext,
	HandlerHelpers,
	HandlerRefs,
	KeyboardInputOptions,
} from './types.js';
import {findWordBoundary} from './utils/wordBoundary.js';

export function createHelpers(
	buffer: TextBuffer,
	options: KeyboardInputOptions,
	refs: HandlerRefs,
): HandlerHelpers {
	const {
		updateFilePickerState,
		updateAgentPickerState,
		updateRunningAgentsPickerState,
		updateCommandPanelState,
		forceUpdate,
	} = options;

	// Force immediate state update for critical operations like backspace
	const forceStateUpdate = () => {
		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();

		updateFilePickerState(text, cursorPos);
		updateAgentPickerState(text, cursorPos);
		updateRunningAgentsPickerState(text, cursorPos);
		updateCommandPanelState(text);

		forceUpdate({});
	};

	const flushPendingInput = () => {
		if (!refs.inputBuffer.current) return;

		if (refs.inputTimer.current) {
			clearTimeout(refs.inputTimer.current);
			refs.inputTimer.current = null;
		}

		// Invalidate any queued timer work from older input batches.
		refs.inputSessionId.current += 1;

		const accumulated = refs.inputBuffer.current;
		const savedCursorPosition = refs.inputStartCursorPos.current;
		refs.inputBuffer.current = '';

		// Keep these flags consistent; otherwise a single-char insert can race a pending flush.
		refs.isPasting.current = false;
		refs.isProcessingInput.current = false;

		buffer.setCursorPosition(savedCursorPosition);
		buffer.insert(accumulated);
		refs.inputStartCursorPos.current = buffer.getCursorPosition();
	};

	return {
		forceStateUpdate,
		flushPendingInput,
		findWordBoundary,
	};
}

export function createContext(
	input: string,
	key: Key,
	buffer: TextBuffer,
	options: KeyboardInputOptions,
	refs: HandlerRefs,
	helpers: HandlerHelpers,
): HandlerContext {
	return {input, key, buffer, options, refs, helpers};
}
