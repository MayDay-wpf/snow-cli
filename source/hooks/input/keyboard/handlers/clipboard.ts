import type {HandlerContext} from '../types.js';

export function clipboardHandler(ctx: HandlerContext): boolean {
	const {input, key, options, refs} = ctx;
	const {pasteFromClipboard} = options;

	// Existing image paste shortcut:
	//   macOS: Ctrl+V
	//   Windows/Linux: Alt+V (Ink reports Alt as meta)
	const isLegacyImagePasteShortcut =
		process.platform === 'darwin'
			? key.ctrl && input === 'v'
			: key.meta && input === 'v';

	if (isLegacyImagePasteShortcut) {
		refs.lastPasteShortcutAt.current = Date.now();
		pasteFromClipboard();
		return true;
	}
	return false;
}
