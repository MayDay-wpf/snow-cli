import {COMMAND_ARGS_OPTIONS} from '../../../ui/useCommandPanel.js';
import {findInlineCommandTrigger} from '../utils/inlineCommandTrigger.js';
import type {HandlerContext} from '../types.js';

export function tabArgsPickerHandler(ctx: HandlerContext): boolean {
	const {key, buffer, options} = ctx;
	const {
		showCommands,
		showFilePicker,
		showArgsPicker,
		setShowArgsPicker,
		setArgsSelectedIndex,
	} = options;

	// Tab to open command args picker when hints are visible
	if (key.tab && !showCommands && !showFilePicker && !showArgsPicker) {
		const text = buffer.text;
		const rootMatch = text.match(/^\/([a-zA-Z0-9_-]+)\s*$/);
		const inlineTrigger = findInlineCommandTrigger(
			text,
			buffer.getCursorPosition(),
		);
		const cmdName = rootMatch?.[1] ?? inlineTrigger?.query ?? '';
		const cmdOpts = COMMAND_ARGS_OPTIONS[cmdName];
		if (cmdOpts && cmdOpts.length > 0) {
			setShowArgsPicker(true);
			setArgsSelectedIndex(0);
			return true;
		}
	}
	return false;
}
