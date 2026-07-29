type TerminalTitleStreamLike =
	| Pick<NodeJS.WriteStream, 'write' | 'isTTY'>
	| {
			write: (data: string) => unknown;
			isTTY?: boolean;
	  };

const titleControlCharacters = /[\u0000-\u001F\u007F]/g;

/** Last title written via setTerminalTitle — skip no-op updates. */
let lastWrittenTitle: string | null = null;

export function cleanTerminalTitle(title: string): string {
	return title
		.replaceAll(titleControlCharacters, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim();
}

/**
 * Reset the module-level dedupe cache (tests / process reuse).
 */
export function resetTerminalTitleCache(): void {
	lastWrittenTitle = null;
}

/**
 * Set terminal window/tab title.
 *
 * Cross-platform strategy:
 * 1. process.title — Windows console title updates without OSC
 * 2. OSC ESC]0;<title>BEL — modern terminals (WT, iTerm, …)
 *
 * Important: never write OSC on every identical frame. Frequent OSC through the
 * same stream Ink uses for rendering causes Windows Terminal tab/body flicker
 * (clear+set on every animation tick used to make this much worse).
 */
export function setTerminalTitle(
	title: string,
	stream: TerminalTitleStreamLike = process.stdout,
	options?: {force?: boolean},
): void {
	const safeTitle = cleanTerminalTitle(title);
	if (!options?.force && lastWrittenTitle === safeTitle) {
		return;
	}

	lastWrittenTitle = safeTitle;

	// Process.title works on Windows without injecting escape sequences into
	// the render stream. Always try it first.
	if (safeTitle) {
		try {
			process.title = safeTitle;
		} catch {
			// Some sandboxes reject process.title writes.
		}
	}

	// Prefer the real process stdout for OSC so we do not interleave title
	// escapes with Ink's cursor addressing on a proxied stream.
	const oscStream =
		process.stdout?.isTTY && typeof process.stdout.write === 'function'
			? process.stdout
			: stream;

	if (!oscStream?.isTTY || typeof oscStream.write !== 'function') {
		return;
	}

	try {
		// Empty title clears (used on unmount). Non-empty sets.
		oscStream.write(`\u001B]0;${safeTitle}\u0007`);
	} catch {
		// Stdout may already be closed.
	}
}
