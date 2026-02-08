/**
 * Shared picker state for cross-component ESC key coordination.
 *
 * Problem: In ink, multiple useInput hooks receive the same keypress.
 * When a picker panel is open in ChatInput and the user presses ESC,
 * both ChatInput's handler (close picker) and ChatScreen's handler
 * (abort streaming) fire simultaneously.
 *
 * Solution: ChatInput sets this flag when a picker is active.
 * ChatScreen checks this flag before handling ESC for stream abort.
 */

let _isPickerActive = false;

/**
 * Mark that a picker panel is currently active and consuming ESC.
 * Called by ChatInput/useKeyboardInput when a picker is shown.
 */
export function setPickerActive(active: boolean): void {
	_isPickerActive = active;
}

/**
 * Check if a picker panel is currently active.
 * Called by ChatScreen before handling ESC for stream abort.
 */
export function isPickerActive(): boolean {
	return _isPickerActive;
}
