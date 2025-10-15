type WritableStreamLike = Pick<NodeJS.WriteStream, 'write'> | {
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

	// DO NOT re-enable focus reporting here
	// Let useTerminalFocus handle it when ChatScreen mounts
	// This avoids the race condition where focus event arrives before listener is ready
}
