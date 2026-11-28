/**
 * Full-screen (alternate screen) rendering helpers.
 *
 * In full-screen mode Ink no longer appends output to the terminal's
 * scrollback. Instead it switches to the alternate screen buffer, keeps the
 * whole frame at exactly `rows` lines and repaints only the lines that
 * changed (absolute cursor addressing). Memory usage is therefore bounded
 * by the viewport size regardless of how long the session runs.
 */

/**
 * Enter alternate screen, disable auto-wrap (prevents accidental scrolling
 * when a line is exactly `columns` wide), enable mouse tracking
 * (press/release + drag + wheel, SGR encoding) and hide the cursor.
 */
export const ENTER_FULLSCREEN_SEQUENCE =
	'\u001B[?1049h\u001B[?7l\u001B[?1000h\u001B[?1002h\u001B[?1006h\u001B[?25l\u001B[2J\u001B[H';

/**
 * Disable mouse tracking, restore auto-wrap and leave the alternate screen.
 */
export const LEAVE_FULLSCREEN_SEQUENCE =
	'\u001B[?1006l\u001B[?1002l\u001B[?1000l\u001B[?7h\u001B[?1049l';

// Synchronized output (DEC mode 2026). Terminals that don't support it
// simply ignore the sequence; supporting terminals present the frame
// atomically which removes tearing during partial repaints.
const BEGIN_SYNC = '\u001B[?2026h';
const END_SYNC = '\u001B[?2026l';

const SHOW_CURSOR = '\u001B[?25h';
const HIDE_CURSOR = '\u001B[?25l';

/**
 * Process-wide controller shared with application code (e.g. terminal reset
 * helpers) that must behave differently while full-screen mode is active.
 * Stored on globalThis via Symbol.for so every module copy sees the same one.
 */
export type FullScreenController = {
	isActive: () => boolean;
	requestRepaint: () => void;
	leave: () => void;
};

export const FULLSCREEN_CONTROLLER_KEY = Symbol.for(
	'snow-cli.ink.fullscreen-controller',
);

export const registerFullScreenController = (
	controller: FullScreenController | undefined,
): void => {
	(globalThis as Record<symbol, unknown>)[FULLSCREEN_CONTROLLER_KEY] =
		controller;
};

export type FullScreenFrameState = {
	previousLines: string[];
	previousCursor: string;
	needsClear: boolean;
};

export const createFullScreenFrameState = (): FullScreenFrameState => ({
	previousLines: [],
	previousCursor: '',
	needsClear: true,
});

/**
 * Build the escape sequence that brings the screen from `state` to the new
 * frame. Returns an empty string when nothing changed. Mutates `state`.
 *
 * @param output Rendered frame (lines joined by `\n`).
 * @param rows Terminal height.
 * @param cursor Absolute cursor position relative to the top of `output`.
 */
export const buildFullScreenFrame = (
	state: FullScreenFrameState,
	output: string,
	rows: number,
	cursor: {x: number; y: number} | undefined,
): {sequence: string; cropTop: number} => {
	const safeRows = Math.max(1, rows);
	let lines = output.split('\n');
	let cropTop = 0;

	// Frame taller than the screen: keep the bottom part (input box lives
	// there), exactly like a normal terminal would after scrolling.
	if (lines.length > safeRows) {
		cropTop = lines.length - safeRows;
		lines = lines.slice(cropTop);
	}

	let body = '';

	if (state.needsClear) {
		body += '\u001B[2J';
		state.previousLines = [];
		state.needsClear = false;
	}

	const nextLines: string[] = [];
	for (let row = 0; row < safeRows; row++) {
		const line = lines[row] ?? '';
		nextLines.push(line);

		if (state.previousLines[row] !== line) {
			// Erase the whole line first, then draw. Erasing *after* drawing
			// (EL 0) would wipe the last column when the line is exactly
			// `columns` wide because the cursor is in the pending-wrap state.
			body += `\u001B[${row + 1};1H\u001B[2K${line}\u001B[0m`;
		}
	}

	state.previousLines = nextLines;

	let cursorSequence = HIDE_CURSOR;
	if (cursor) {
		const y = cursor.y - cropTop;
		if (y >= 0 && y < safeRows) {
			cursorSequence = `\u001B[${y + 1};${
				Math.max(0, cursor.x) + 1
			}H${SHOW_CURSOR}`;
		}
	}

	if (body.length === 0 && cursorSequence === state.previousCursor) {
		return {sequence: '', cropTop};
	}

	state.previousCursor = cursorSequence;

	// Hide the cursor while painting so it doesn't visibly jump around.
	return {
		sequence: BEGIN_SYNC + HIDE_CURSOR + body + cursorSequence + END_SYNC,
		cropTop,
	};
};
