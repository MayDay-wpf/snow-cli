import {useState, useEffect, useCallback, useRef} from 'react';
import {useInput} from 'ink';

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
 *
 * Auto-focus recovery: If user input is detected while in unfocused state,
 * automatically restore focus state to ensure cursor visibility during
 * operations like Shift+drag file drop where focus events may be delayed.
 *
 * IMPORTANT: Uses Ink's useInput instead of direct process.stdin listeners
 * to avoid switching stdin between flowing/paused modes, which causes
 * stream conflicts with Ink's internal readable-event-based input handling.
 */
export function useTerminalFocus(): {
	hasFocus: boolean;
	isFocusEvent: (input: string) => boolean;
	ensureFocus: () => void;
} {
	const [hasFocus, setHasFocus] = useState(true); // Default to focused
	const hasFocusRef = useRef(true);

	const handleInput = useCallback((input: string) => {
		// Ink strips the ESC prefix, so ESC[I arrives as '[I' and ESC[O as '[O'
		if (input === '[I' || input === '\x1b[I') {
			hasFocusRef.current = true;
			setHasFocus(true);
			return;
		}

		if (input === '[O' || input === '\x1b[O') {
			hasFocusRef.current = false;
			setHasFocus(false);
			return;
		}

		// Auto-recovery: If we receive printable input while in unfocused state,
		// treat it as an implicit focus gain.
		// This handles cases where focus events are delayed (e.g., Shift+drag operations)
		if (!hasFocusRef.current) {
			const isPrintableInput =
				input.length > 0 &&
				!input.startsWith('\x1b') &&
				!input.startsWith('[') &&
				!/^[\x00-\x1f\x7f]+$/.test(input);

			if (isPrintableInput) {
				hasFocusRef.current = true;
				setHasFocus(true);
			}
		}
	}, []);

	useInput(handleInput);

	// Enable/disable focus reporting
	useEffect(() => {
		let syncTimer: NodeJS.Timeout | null = null;

		const enableTimer = setTimeout(() => {
			// ESC[?1004h - Enable focus events
			process.stdout.write('\x1b[?1004h');

			// After enabling focus reporting, assume terminal has focus
			// This ensures cursor is visible after component remount (e.g., after /clear)
			// The terminal will send ESC[O if it doesn't have focus
			syncTimer = setTimeout(() => {
				hasFocusRef.current = true;
				setHasFocus(true);
			}, 100);
		}, 50);

		return () => {
			clearTimeout(enableTimer);
			if (syncTimer) {
				clearTimeout(syncTimer);
			}
			// Disable focus reporting on cleanup
			// ESC[?1004l - Disable focus events
			process.stdout.write('\x1b[?1004l');
		};
	}, []);

	// Helper function to check if input is a focus event
	const isFocusEvent = (input: string): boolean => {
		return input === '\x1b[I' || input === '\x1b[O';
	};

	// Manual focus restoration function (can be called externally if needed)
	const ensureFocus = () => {
		hasFocusRef.current = true;
		setHasFocus(true);
	};

	return {hasFocus, isFocusEvent, ensureFocus};
}
