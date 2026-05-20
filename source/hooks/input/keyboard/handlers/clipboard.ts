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

	// System paste shortcut compatibility for terminals that forward Ctrl+V to the app.
	// macOS Cmd+V is normally handled by the terminal/webview before it reaches Ink.
	const isForwardedSystemPasteShortcut =
		process.platform !== 'darwin' && key.ctrl && input === 'v';

	if (isLegacyImagePasteShortcut || isForwardedSystemPasteShortcut) {
		refs.lastPasteShortcutAt.current = Date.now();
		pasteFromClipboard();
		return true;
	}
	return false;
}
