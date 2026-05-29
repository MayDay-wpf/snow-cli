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
