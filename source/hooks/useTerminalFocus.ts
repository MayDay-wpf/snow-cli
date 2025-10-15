import {useState, useEffect} from 'react';

/**
 * Hook to detect terminal window focus state.
 * Returns true when terminal has focus, false otherwise.
 *
 * Uses ANSI escape sequences to detect focus events:
 * - ESC[I (\x1b[I) - Focus gained
 * - ESC[O (\x1b[O) - Focus lost
 *
 * Cross-platform support:
 * - ✅ Windows Terminal
 * - ✅ macOS Terminal.app, iTerm2
 * - ✅ Linux: GNOME Terminal, Konsole, Alacritty, kitty, etc.
 *
 * Note: Older or minimal terminals that don't support focus reporting
 * will simply ignore the escape sequences and cursor will remain visible.
 *
 * Also provides a function to check if input contains focus events
 * so they can be filtered from normal input processing.
 */
export function useTerminalFocus(): {
	hasFocus: boolean;
	isFocusEvent: (input: string) => boolean;
} {
	const [hasFocus, setHasFocus] = useState(true); // Default to focused

	useEffect(() => {
		// Set up listener first
		const handleData = (data: Buffer) => {
			const str = data.toString();

			// Focus gained: ESC[I
			if (str === '\x1b[I') {
				setHasFocus(true);
			}

			// Focus lost: ESC[O
			if (str === '\x1b[O') {
				setHasFocus(false);
			}
		};

		// Listen to stdin data
		process.stdin.on('data', handleData);

		// Enable focus reporting AFTER listener is set up
		// Add a small delay to ensure listener is fully registered
		const timer = setTimeout(() => {
			// ESC[?1004h - Enable focus events
			process.stdout.write('\x1b[?1004h');
		}, 50);

		return () => {
			clearTimeout(timer);
			// Disable focus reporting on cleanup
			// ESC[?1004l - Disable focus events
			process.stdout.write('\x1b[?1004l');
			process.stdin.off('data', handleData);
		};
	}, []);

	// Helper function to check if input is a focus event
	const isFocusEvent = (input: string): boolean => {
		return input === '\x1b[I' || input === '\x1b[O';
	};

	return {hasFocus, isFocusEvent};
}
