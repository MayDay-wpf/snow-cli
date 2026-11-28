/**
 * Terminal mouse event support (SGR 1006 encoding + legacy X10 fallback).
 *
 * When full-screen mode is active, Ink enables mouse tracking
 * (`\x1b[?1000h\x1b[?1002h\x1b[?1006h`). The terminal then reports mouse
 * activity as escape sequences on stdin. These sequences must NEVER reach
 * `useInput` handlers (they would be typed into the prompt), so the App
 * component strips them out of every stdin chunk via `extractMouseEvents`
 * and re-emits them as structured `mouse` events.
 */

export type MouseButton = 'left' | 'middle' | 'right' | 'none';

export type MouseAction =
	| 'press'
	| 'release'
	| 'drag'
	| 'move'
	| 'wheelUp'
	| 'wheelDown'
	| 'wheelLeft'
	| 'wheelRight';

export type MouseEvent = {
	/**
	 * 1-based terminal column.
	 */
	readonly x: number;
	/**
	 * 1-based terminal row.
	 */
	readonly y: number;
	readonly button: MouseButton;
	readonly action: MouseAction;
	readonly shift: boolean;
	readonly meta: boolean;
	readonly ctrl: boolean;
};

// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /\u001B\[<(\d+);(\d+);(\d+)([Mm])/g;
// eslint-disable-next-line no-control-regex
const X10_MOUSE_RE = /\u001B\[M([\s\S])([\s\S])([\s\S])/g;
// eslint-disable-next-line no-control-regex
const INCOMPLETE_SGR_RE = /\u001B\[<[\d;]*$/;

const WHEEL_ACTIONS: MouseAction[] = [
	'wheelUp',
	'wheelDown',
	'wheelLeft',
	'wheelRight',
];

const BUTTONS: MouseButton[] = ['left', 'middle', 'right', 'none'];

export const decodeMouseEvent = (
	code: number,
	x: number,
	y: number,
	isRelease: boolean,
): MouseEvent | undefined => {
	// Extra buttons (8-11) are not used by the UI.
	if (code & 128) {
		return undefined;
	}

	const shift = (code & 4) !== 0;
	const meta = (code & 8) !== 0;
	const ctrl = (code & 16) !== 0;
	const isMotion = (code & 32) !== 0;
	const low = code & 3;

	if (code & 64) {
		return {
			x,
			y,
			button: 'none',
			action: WHEEL_ACTIONS[low] ?? 'wheelUp',
			shift,
			meta,
			ctrl,
		};
	}

	const button = BUTTONS[low] ?? 'none';
	let action: MouseAction;
	if (isRelease) {
		action = 'release';
	} else if (isMotion) {
		action = button === 'none' ? 'move' : 'drag';
	} else if (button === 'none') {
		// X10 encoding reports releases as button 3.
		action = 'release';
	} else {
		action = 'press';
	}

	return {x, y, button, action, shift, meta, ctrl};
};

export type MouseExtractionResult = {
	/**
	 * Input with all mouse sequences removed.
	 */
	rest: string;
	/**
	 * Parsed mouse events in arrival order.
	 */
	events: MouseEvent[];
	/**
	 * Trailing incomplete SGR mouse sequence that should be prepended to the
	 * next stdin chunk.
	 */
	pending: string;
};

/**
 * Extract every mouse sequence from a raw stdin chunk.
 */
export const extractMouseEvents = (data: string): MouseExtractionResult => {
	// Fast path: nothing that looks like a mouse report.
	if (!data.includes('\u001B[<') && !data.includes('\u001B[M')) {
		return {rest: data, events: [], pending: ''};
	}

	const events: MouseEvent[] = [];

	let rest = data.replace(
		SGR_MOUSE_RE,
		(_match, rawCode: string, rawX: string, rawY: string, kind: string) => {
			const event = decodeMouseEvent(
				Number(rawCode),
				Number(rawX),
				Number(rawY),
				kind === 'm',
			);
			if (event) {
				events.push(event);
			}

			return '';
		},
	);

	let pending = '';
	const incomplete = INCOMPLETE_SGR_RE.exec(rest);
	if (incomplete) {
		pending = incomplete[0];
		rest = rest.slice(0, incomplete.index);
	}

	if (rest.includes('\u001B[M')) {
		rest = rest.replace(
			X10_MOUSE_RE,
			(_match, rawCode: string, rawX: string, rawY: string) => {
				const event = decodeMouseEvent(
					rawCode.charCodeAt(0) - 32,
					rawX.charCodeAt(0) - 32,
					rawY.charCodeAt(0) - 32,
					false,
				);
				if (event) {
					events.push(event);
				}

				return '';
			},
		);
	}

	return {rest, events, pending};
};
