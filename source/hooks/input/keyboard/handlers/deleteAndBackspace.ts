import type {HandlerContext} from '../types.js';

export function deleteAndBackspaceHandler(ctx: HandlerContext): boolean {
	const {input, key, buffer, refs, helpers} = ctx;

	// Delete key - delete character after cursor
	// Detected via raw stdin listener because ink doesn't distinguish Delete from Backspace
	if (refs.deleteKeyPressed.current) {
		refs.deleteKeyPressed.current = false;
		helpers.flushPendingInput();
		buffer.delete();
		helpers.forceStateUpdate();
		return true;
	}

	// Backspace - delete character before cursor
	// Check both ink's key detection and raw input codes
	const isBackspace =
		key.backspace || key.delete || input === '\x7f' || input === '\x08';
	if (isBackspace) {
		helpers.flushPendingInput();
		buffer.backspace();
		helpers.forceStateUpdate();
		return true;
	}

	return false;
}
