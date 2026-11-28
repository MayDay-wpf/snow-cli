import {useLayoutEffect, useRef, useState} from 'react';
import {
	useStdout,
	enterFullScreen,
	leaveFullScreen,
	isFullScreenActive,
} from 'ink';

/**
 * Switch Ink into full-screen (alternate screen) mode while `enabled` is
 * true, and restore the inline renderer when it turns false / on unmount.
 *
 * Full-screen mode keeps the frame at exactly `rows` lines and repaints
 * changed lines only, so nothing accumulates in the terminal scrollback and
 * memory stays bounded for long sessions. Mouse tracking is enabled as well
 * (see `useMouse`).
 *
 * Returns whether Ink is ACTUALLY in full-screen mode. This can differ from
 * `enabled`: Ink refuses to enter full-screen in CI, debug mode or when
 * stdout is not a TTY. Callers must drive their layout from the returned
 * value, never from the requested mode, otherwise a fixed-height layout
 * would be rendered by the inline renderer (which clears the terminal on
 * every frame once the output reaches `rows`).
 *
 * `onActiveChange` fires (synchronously, inside a layout effect) whenever the
 * ACTUAL state changes - including entering full-screen on mount - and only
 * after the renderer has really switched (alternate screen entered / main
 * screen restored). It does NOT fire when the requested mode cannot be
 * applied. That is the right moment to clear the screen and remount
 * <Static>: when going
 * back to classic mode the main screen is current again, so the remounted
 * <Static> history lands in the real scrollback instead of being discarded
 * by the full-screen renderer.
 */
export function useFullScreen(
	enabled: boolean,
	onActiveChange?: (active: boolean) => void,
): boolean {
	const {stdout} = useStdout();
	const [active, setActive] = useState(false);
	const activeRef = useRef(false);
	const onActiveChangeRef = useRef(onActiveChange);
	onActiveChangeRef.current = onActiveChange;

	useLayoutEffect(() => {
		if (enabled) {
			enterFullScreen(stdout);
		}

		const nowActive = isFullScreenActive(stdout);
		if (nowActive !== activeRef.current) {
			activeRef.current = nowActive;
			setActive(nowActive);
			onActiveChangeRef.current?.(nowActive);
		}

		return () => {
			if (enabled) {
				leaveFullScreen(stdout);
			}
		};
	}, [enabled, stdout]);

	return active;
}
