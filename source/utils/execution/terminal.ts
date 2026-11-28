import {logger} from '../core/logger.js';

const log = logger.child('execution:terminal');

type WritableStreamLike =
	| Pick<NodeJS.WriteStream, 'write'>
	| {
			write: (data: string) => unknown;
	  };

const DEFAULT_TERMINAL_COLUMNS = 80;

type TerminalColumnsStreamLike = Partial<Pick<NodeJS.WriteStream, 'columns'>>;

export function getTerminalColumns(
	stream: TerminalColumnsStreamLike = process.stdout,
): number {
	const columns = stream.columns;

	return typeof columns === 'number' && Number.isFinite(columns) && columns > 0
		? Math.floor(columns)
		: DEFAULT_TERMINAL_COLUMNS;
}

export function getAvailableTerminalColumns(
	reservedColumns = 0,
	stream: TerminalColumnsStreamLike = process.stdout,
): number {
	const safeReservedColumns =
		Number.isFinite(reservedColumns) && reservedColumns > 0
			? Math.floor(reservedColumns)
			: 0;

	return Math.max(1, getTerminalColumns(stream) - safeReservedColumns);
}

type FullScreenControllerLike = {
	isActive: () => boolean;
	requestRepaint: () => void;
	leave: () => void;
};

// Must match FULLSCREEN_CONTROLLER_KEY in source/vendor/ink/src/fullscreen.ts.
const FULLSCREEN_CONTROLLER_KEY = Symbol.for(
	'snow-cli.ink.fullscreen-controller',
);

function getFullScreenController(): FullScreenControllerLike | undefined {
	const controller = (globalThis as Record<symbol, unknown>)[
		FULLSCREEN_CONTROLLER_KEY
	] as FullScreenControllerLike | undefined;
	return controller && controller.isActive() ? controller : undefined;
}

/**
 * Whether the Ink renderer currently owns the alternate screen.
 */
export function isFullScreenTUI(): boolean {
	return getFullScreenController() !== undefined;
}

/**
 * Clear the visible screen in a way that is safe for both render modes.
 * - Full-screen: ask Ink to repaint the whole frame (no raw escape writes).
 * - Inline: emit the classic clearTerminal sequence.
 */
export function clearTerminalScreen(stream?: WritableStreamLike): void {
	const controller = getFullScreenController();
	if (controller) {
		controller.requestRepaint();
		return;
	}

	const target = stream ?? process.stdout;
	if (target && typeof target.write === 'function') {
		target.write('\x1B[2J\x1B[3J\x1B[H');
	}
}

export function resetTerminal(stream?: WritableStreamLike): void {
	const target = stream ?? process.stdout;

	if (!target || typeof target.write !== 'function') {
		return;
	}

	// In full-screen mode a RIS would drop the alternate screen, mouse
	// tracking and every other mode Ink set up. A forced repaint is enough
	// because nothing accumulates outside the viewport.
	const controller = getFullScreenController();
	if (controller) {
		controller.requestRepaint();
		return;
	}

	// RIS (Reset to Initial State) clears scrollback and resets terminal modes
	target.write('\x1bc');
	target.write('\x1B[3J\x1B[2J\x1B[H');

	// Re-enable focus reporting immediately after terminal reset
	target.write('\x1b[?1004h');

	// Clear Ink's internal fullStaticOutput buffer to reclaim memory.
	// Uses dynamic import so tsc doesn't need to resolve the vendor path.
	(import('ink') as Promise<any>)
		.then((mod: any) => {
			if (typeof mod.clearInkStaticOutput === 'function') {
				mod.clearInkStaticOutput(target);
			}
		})
		.catch(() => {});
}

/**
 * Standard terminal sequences to restore terminal state on process termination:
 * - \x1b[?1004l : Disable terminal focus reporting events (prevents stray ^[[I / ^[[O bracketed garbage)
 * - \x1b[?2004l : Disable bracketed paste mode
 * - \x1b[?25h   : Restore cursor visibility
 * - \x1b[0 q    : Restore cursor shape to terminal default (DECSCUSR 0)
 */
export const TERMINAL_EXIT_SEQUENCES =
	'\x1b[?1004l\x1b[?2004l\x1b[?25h\x1b[0 q';

/**
 * Write exit cleanup sequences to the target stream safely.
 */
export function emitTerminalExitSequence(stream?: WritableStreamLike): void {
	const target = stream ?? process.stdout;
	if (target && typeof target.write === 'function') {
		try {
			// If the process exits while the full-screen TUI is still active
			// (e.g. process.exit without Ink unmount), restore the main screen
			// and disable mouse tracking first.
			const controller = getFullScreenController();
			if (controller) {
				controller.leave();
			}

			target.write(TERMINAL_EXIT_SEQUENCES);
		} catch (e) {
			log.debug('Failed to emit terminal exit sequence (stream error)', {
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}
}
