import {setPickerActive} from '../../../../../utils/ui/pickerState.js';
import type {HandlerContext} from '../../types.js';

export function argsPickerHandler(ctx: HandlerContext): boolean {
	const {key, buffer, options} = ctx;
	const {
		showArgsPicker,
		argsPickerContext,
		argsSelectedIndex,
		setArgsSelectedIndex,
		setShowArgsPicker,
		triggerUpdate,
	} = options;

	if (!showArgsPicker) return false;
	const argOptions = argsPickerContext.options;

	if (key.upArrow) {
		setArgsSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, argOptions.length - 1),
		);
		return true;
	}

	if (key.downArrow) {
		const maxIndex = Math.max(0, argOptions.length - 1);
		setArgsSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Tab closes the panel
	if (key.tab) {
		setShowArgsPicker(false);
		setArgsSelectedIndex(0);
		setPickerActive(true);
		return true;
	}

	if (key.return) {
		if (argOptions.length > 0 && argsSelectedIndex < argOptions.length) {
			const selected = argOptions[argsSelectedIndex];
			if (selected) {
				const text = buffer.text;
				const hasTrailingSpace = /^\/[a-zA-Z0-9_-]+\s+$/.test(text);
				const suffix = hasTrailingSpace ? selected : ' ' + selected;
				buffer.insert(suffix);
				buffer.setCursorPosition(buffer.text.length);
				setShowArgsPicker(false);
				setArgsSelectedIndex(0);
				triggerUpdate();
			}
		}
		return true;
	}

	// Backspace silently closes (not shown in hint text)
	if (key.backspace || key.delete) {
		setShowArgsPicker(false);
		setArgsSelectedIndex(0);
		return true;
	}

	return true;
}
