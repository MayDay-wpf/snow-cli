/**
 * Terminal mouse protocol helpers (SGR + legacy X10).
 * Used for best-effort wheel scrolling in TUI panels.
 */

export type TerminalMouseWheelDirection = 'up' | 'down';

export type TerminalMouseWheelEvent = {
	direction: TerminalMouseWheelDirection;
	/** Always 1 for a single wheel tick; reserved for future multi-line ticks. */
	deltaLines: number;
	column: number;
	row: number;
};

/** CSI sequences: button tracking + SGR encoding (xterm/Windows Terminal). */
export const TERMINAL_MOUSE_ENABLE = '\u001b[?1000h\u001b[?1006h';
export const TERMINAL_MOUSE_DISABLE = '\u001b[?1006l\u001b[?1000l';

// Modifier bits that may be OR'd into wheel button codes.
const MOUSE_MODIFIER_MASK = 0x1c;

function wheelDirectionFromButton(
	button: number,
): TerminalMouseWheelDirection | null {
	const base = button & ~MOUSE_MODIFIER_MASK;
	if (base === 64) {
		return 'up';
	}
	if (base === 65) {
		return 'down';
	}
	return null;
}

/**
 * Parse a single complete SGR mouse report: CSI < Pb ; Px ; Py M|m
 * Returns null when the chunk is not a wheel event or is incomplete.
 */
export function parseSgrMouseWheel(
	chunk: string,
): TerminalMouseWheelEvent | null {
	if (!chunk || typeof chunk !== 'string') {
		return null;
	}

	const match = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/.exec(chunk);
	if (!match) {
		return null;
	}

	const button = Number(match[1]);
	const column = Number(match[2]);
	const row = Number(match[3]);
	// Release reports end with 'm'; wheel ticks use press 'M'.
	if (match[4] !== 'M') {
		return null;
	}

	const direction = wheelDirectionFromButton(button);
	if (!direction) {
		return null;
	}

	return {
		direction,
		deltaLines: 1,
		column: Number.isFinite(column) ? column : 0,
		row: Number.isFinite(row) ? row : 0,
	};
}

/**
 * Parse legacy X10 mouse report: ESC [ M Cb Cx Cy (each coord is char-32).
 */
export function parseX10MouseWheel(
	chunk: string,
): TerminalMouseWheelEvent | null {
	if (!chunk || typeof chunk !== 'string' || chunk.length < 6) {
		return null;
	}

	// May appear anywhere in a larger paste chunk.
	const index = chunk.indexOf('\u001b[M');
	if (index < 0 || chunk.length < index + 6) {
		return null;
	}

	const button = chunk.charCodeAt(index + 3) - 32;
	const column = chunk.charCodeAt(index + 4) - 32;
	const row = chunk.charCodeAt(index + 5) - 32;
	const direction = wheelDirectionFromButton(button);
	if (!direction) {
		return null;
	}

	return {
		direction,
		deltaLines: 1,
		column,
		row,
	};
}

/** Prefer SGR, then X10. */
export function parseTerminalMouseWheel(
	chunk: string,
): TerminalMouseWheelEvent | null {
	return parseSgrMouseWheel(chunk) ?? parseX10MouseWheel(chunk);
}

let mouseTrackingRefCount = 0;

/**
 * Enable mouse tracking with ref-count. Safe to call from multiple panels.
 * Returns a disposer that decrements the count and disables when zero.
 */
export function acquireTerminalMouseTracking(
	write: (data: string) => void,
): () => void {
	if (mouseTrackingRefCount === 0) {
		try {
			write(TERMINAL_MOUSE_ENABLE);
		} catch {
			// Non-TTY / restricted stdout — leave tracking off.
		}
	}
	mouseTrackingRefCount += 1;

	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		mouseTrackingRefCount = Math.max(0, mouseTrackingRefCount - 1);
		if (mouseTrackingRefCount === 0) {
			try {
				write(TERMINAL_MOUSE_DISABLE);
			} catch {
				// Ignore cleanup failures.
			}
		}
	};
}

/** Test helper: reset module ref-count between AVA cases. */
export function resetTerminalMouseTrackingForTests(): void {
	mouseTrackingRefCount = 0;
}
