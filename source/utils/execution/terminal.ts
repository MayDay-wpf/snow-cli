type WritableStreamLike =
	| Pick<NodeJS.WriteStream, 'write'>
	| {
			write: (data: string) => unknown;
	  };

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
