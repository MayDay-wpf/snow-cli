import {useEffect, useRef} from 'react';
import {useStdout} from 'ink';
import {
	cleanTerminalTitle,
	setTerminalTitle,
} from '../../utils/ui/terminalTitle.js';

/**
 * Set terminal window/tab title. Clears only when the consuming screen unmounts.
 *
 * Cross-platform strategy (see setTerminalTitle):
 * 1. process.title — Windows console title
 * 2. OSC ESC]0;<title>BEL — modern terminals
 *
 * CRITICAL: cleanup must NOT run on every title change. Action Required blinks
 * update the title every ~500ms; the old implementation restored process.title
 * and wrote an empty OSC on each cleanup, which made Windows Terminal flash
 * the whole pane (title clear → set → clear → set).
 *
 * @param title Title to show; empty string clears on write
 */
export function useTerminalTitle(title: string): void {
	const {stdout} = useStdout();
	const originalProcessTitleRef = useRef<string | undefined>(undefined);
	const capturedOriginalRef = useRef(false);
	const lastAppliedTitleRef = useRef<string | null>(null);

	// Apply title when it changes. No per-update cleanup.
	useEffect(() => {
		if (!stdout?.isTTY) {
			return;
		}

		if (!capturedOriginalRef.current) {
			try {
				originalProcessTitleRef.current = process.title;
			} catch {
				// Restricted environments may throw on process.title read.
			}
			capturedOriginalRef.current = true;
		}

		const safeTitle = cleanTerminalTitle(title);
		if (lastAppliedTitleRef.current === safeTitle) {
			return;
		}
		lastAppliedTitleRef.current = safeTitle;
		setTerminalTitle(safeTitle, stdout);
	}, [stdout, title]);

	// Unmount-only: restore previous process title and clear OSC once.
	useEffect(() => {
		if (!stdout?.isTTY) {
			return;
		}

		return () => {
			if (!stdout?.isTTY) {
				return;
			}

			const previous = originalProcessTitleRef.current;
			if (previous !== undefined) {
				try {
					process.title = previous;
				} catch {
					// Ignore restore failures.
				}
			}

			// Force clear even if dedupe cache matches empty string from a prior clear.
			setTerminalTitle('', stdout, {force: true});
			lastAppliedTitleRef.current = null;
		};
	}, [stdout]);
}
