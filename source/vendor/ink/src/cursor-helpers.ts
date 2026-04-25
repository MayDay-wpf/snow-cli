import ansiEscapes from 'ansi-escapes';

export type CursorPosition = {
	x: number;
	y: number;
};

export const showCursorEscape = '\u001B[?25h';
export const hideCursorEscape = '\u001B[?25l';

export const cursorPositionChanged = (
	a: CursorPosition | undefined,
	b: CursorPosition | undefined,
): boolean => a?.x !== b?.x || a?.y !== b?.y;

/**
 * After writing output (cursor is at col 0 of the line past the last visible line),
 * move cursor to the target position and show it.
 */
export const buildCursorSuffix = (
	visibleLineCount: number,
	cursorPosition: CursorPosition | undefined,
): string => {
	if (!cursorPosition) {
		return '';
	}

	const moveUp = visibleLineCount - cursorPosition.y;
	return (
		(moveUp > 0 ? ansiEscapes.cursorUp(moveUp) : '') +
		ansiEscapes.cursorTo(cursorPosition.x) +
		showCursorEscape
	);
};

/**
 * Move cursor from previousCursorPosition back to the bottom-left of the output block.
 */
export const buildReturnToBottom = (
	previousLineCount: number,
	previousCursorPosition: CursorPosition | undefined,
): string => {
	if (!previousCursorPosition) {
		return '';
	}

	const down = previousLineCount - 1 - previousCursorPosition.y;
	return (
		(down > 0 ? ansiEscapes.cursorDown(down) : '') + ansiEscapes.cursorTo(0)
	);
};

export const buildReturnToBottomPrefix = (
	cursorWasShown: boolean,
	previousLineCount: number,
	previousCursorPosition: CursorPosition | undefined,
): string => {
	if (!cursorWasShown) {
		return '';
	}

	return (
		hideCursorEscape +
		buildReturnToBottom(previousLineCount, previousCursorPosition)
	);
};

export const buildCursorOnlySequence = (input: {
	cursorWasShown: boolean;
	previousLineCount: number;
	previousCursorPosition: CursorPosition | undefined;
	visibleLineCount: number;
	cursorPosition: CursorPosition | undefined;
}): string => {
	const hidePrefix = input.cursorWasShown ? hideCursorEscape : '';
	const returnToBottom = buildReturnToBottom(
		input.previousLineCount,
		input.previousCursorPosition,
	);
	const cursorSuffix = buildCursorSuffix(
		input.visibleLineCount,
		input.cursorPosition,
	);
	return hidePrefix + returnToBottom + cursorSuffix;
};
