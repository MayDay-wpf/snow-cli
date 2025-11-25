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
	// The RIS command (\x1bc) disables focus reporting, so we must re-enable it
	// This ensures focus state tracking continues to work after /clear command
	target.write('\x1b[?1004h');
}
