import type {HandlerContext} from '../types.js';

export function clipboardHandler(ctx: HandlerContext): boolean {
	const {input, key, options, refs} = ctx;
	const {pasteFromClipboard} = options;

	// Windows: Alt+V, macOS: Ctrl+V - Paste from clipboard (including images)
	const isPasteShortcut =
		process.platform === 'darwin'
			? key.ctrl && input === 'v'
			: key.meta && input === 'v';

	if (isPasteShortcut) {
		refs.lastPasteShortcutAt.current = Date.now();
		pasteFromClipboard();
		return true;
	}
	return false;
}
