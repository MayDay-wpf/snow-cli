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

export function resetTerminal(stream?: WritableStreamLike): void {
	const target = stream ?? process.stdout;

	if (!target || typeof target.write !== 'function') {
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
			target.write(TERMINAL_EXIT_SEQUENCES);
		} catch (e) {
			log.debug('Failed to emit terminal exit sequence (stream error)', {
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}
}
