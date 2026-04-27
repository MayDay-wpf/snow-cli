import type {HandlerContext} from '../types.js';

export function focusFilterHandler(ctx: HandlerContext): boolean {
	const {input, refs} = ctx;

	// Ignore focus events during the first 500ms after component mount
	// This prevents [I[I artifacts when switching from WelcomeScreen to ChatScreen
	const timeSinceMount = Date.now() - refs.componentMountTime.current;
	if (timeSinceMount < 500) {
		// During initial mount period, aggressively filter any input that could be focus events
		if (
			input.includes('[I') ||
			input.includes('[O') ||
			input === '\x1b[I' ||
			input === '\x1b[O' ||
			/^[\s\x1b\[IO]+$/.test(input)
		) {
			return true;
		}
	}

	// Filter out focus events more robustly
	// Focus events: ESC[I (focus in) or ESC[O (focus out)
	// Some terminals may send these with or without ESC, and they might appear
	// anywhere in the input string (especially during drag-and-drop with Shift held)
	// We need to filter them out but NOT remove legitimate user input
	const focusEventPattern = /(\s|^)\[(?:I|O)(?=(?:\s|$|["'~\\/]|[A-Za-z]:))/;

	if (
		// Complete escape sequences
		input === '\x1b[I' ||
		input === '\x1b[O' ||
		// Standalone sequences (exact match only)
		input === '[I' ||
		input === '[O' ||
		// Filter if input ONLY contains focus events, whitespace, and optional ESC prefix
		(/^[\s\x1b\[IO]+$/.test(input) && focusEventPattern.test(input))
	) {
		return true;
	}

	return false;
}
