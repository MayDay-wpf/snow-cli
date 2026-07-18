import {type Writable} from 'node:stream';
import ansiEscapes from 'ansi-escapes';
import cliCursor from 'cli-cursor';
import {
	type CursorPosition,
	cursorPositionChanged,
	buildCursorSuffix,
	buildCursorOnlySequence,
	buildReturnToBottomPrefix,
} from './cursor-helpers.js';

export type {CursorPosition} from './cursor-helpers.js';

export type LogUpdate = {
	clear: () => void;
	done: () => void;
	setCursorPosition: (position: CursorPosition | undefined) => void;
	isCursorDirty: () => boolean;
	(str: string): void;
};

const visibleLineCount = (lines: string[], str: string): number =>
	str.endsWith('\n') ? lines.length - 1 : lines.length;

const isStreamWriteError = (error: unknown): boolean => {
	if (!(error instanceof Error)) {
		return false;
	}

	const code = (error as NodeJS.ErrnoException).code;
	return (
		code === 'ERR_STREAM_DESTROYED' ||
		code === 'ERR_STREAM_WRITE_AFTER_END' ||
		error.message.includes('stream was destroyed') ||
		error.message.includes('write after end')
	);
};

export const writeSafely = (stream: Writable, data: string): boolean => {
	if (stream.destroyed || stream.writableEnded) {
		return false;
	}

	try {
		return stream.write(data);
	} catch (error: unknown) {
		if (isStreamWriteError(error)) {
			return false;
		}

		throw error;
	}
};

const create = (stream: Writable, {showCursor = false} = {}): LogUpdate => {
	let previousLineCount = 0;
	let previousOutput = '';
	let hasHiddenCursor = false;
	let cursorPosition: CursorPosition | undefined;
	let cursorDirty = false;
	let previousCursorPosition: CursorPosition | undefined;
	let cursorWasShown = false;

	const render = (str: string) => {
		if (!showCursor && !hasHiddenCursor) {
			cliCursor.hide();
			hasHiddenCursor = true;
		}

		const activeCursor = cursorDirty ? cursorPosition : undefined;
		cursorDirty = false;
		const cursorChanged = cursorPositionChanged(
			activeCursor,
			previousCursorPosition,
		);

		const output = str + '\n';
		if (output === previousOutput && !cursorChanged) {
			return;
		}

		const lines = output.split('\n');
		const visibleCount = visibleLineCount(lines, output);

		if (output === previousOutput && cursorChanged) {
			writeSafely(
				stream,
				buildCursorOnlySequence({
					cursorWasShown,
					previousLineCount,
					previousCursorPosition,
					visibleLineCount: visibleCount,
					cursorPosition: activeCursor,
				}),
			);
		} else {
			previousOutput = output;
			const returnPrefix = buildReturnToBottomPrefix(
				cursorWasShown,
				previousLineCount,
				previousCursorPosition,
			);
			const cursorSuffix = buildCursorSuffix(visibleCount, activeCursor);
			writeSafely(
				stream,
				returnPrefix +
					ansiEscapes.eraseLines(previousLineCount) +
					output +
					cursorSuffix,
			);
			previousLineCount = lines.length;
		}

		previousCursorPosition = activeCursor ? {...activeCursor} : undefined;
		cursorWasShown = activeCursor !== undefined;
	};

	render.clear = () => {
		const prefix = buildReturnToBottomPrefix(
			cursorWasShown,
			previousLineCount,
			previousCursorPosition,
		);
		writeSafely(stream, prefix + ansiEscapes.eraseLines(previousLineCount));
		previousOutput = '';
		previousLineCount = 0;
		previousCursorPosition = undefined;
		cursorWasShown = false;
	};

	render.done = () => {
		previousOutput = '';
		previousLineCount = 0;
		previousCursorPosition = undefined;
		cursorWasShown = false;

		if (!showCursor) {
			cliCursor.show();
			hasHiddenCursor = false;
		}
	};

	render.setCursorPosition = (position: CursorPosition | undefined) => {
		cursorPosition = position;
		cursorDirty = true;
	};

	render.isCursorDirty = () => cursorDirty;

	return render;
};

const logUpdate = {create};
export default logUpdate;
