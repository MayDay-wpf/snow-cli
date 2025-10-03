/**
 * Windows Terminal specific rendering utilities
 * Handles the issue where content exceeding viewport causes duplicate rendering
 *
 * NOTE: We don't use alternate screen buffer because it disables scrollback.
 * For an interactive CLI that may have long output, we need terminal scrolling.
 */

export function setupWindowsTerminal() {
	// For Windows Terminal with scrollback support:
	// - Don't use alternate screen buffer (it disables scrollback)
	// - Rely on Ink's built-in rendering optimization
	// - Use React.memo and useCallback to minimize re-renders

	// Return a no-op cleanup function
	return () => {};
}
