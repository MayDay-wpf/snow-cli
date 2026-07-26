import {useEffect, useRef} from 'react';
import {useStdin, useStdout} from 'ink';
import type {EventEmitter} from 'node:events';
import {
	acquireTerminalMouseTracking,
	parseTerminalMouseWheel,
	type TerminalMouseWheelEvent,
} from '../../utils/ui/terminalMouse.js';

export type UseTerminalMouseWheelOptions = {
	/** When false, tracking is disabled and the listener is removed. */
	isActive?: boolean;
	/** Called for each recognized wheel tick. */
	onWheel: (event: TerminalMouseWheelEvent) => void;
};

/**
 * Best-effort terminal mouse-wheel listener.
 *
 * Enables xterm SGR mouse tracking while active and reads wheel events from
 * Ink's internal input emitter (same path as useKeyboardInput Delete detect).
 * Does NOT attach process.stdin 'data' listeners — that would fight Ink's
 * readable-based raw mode handling.
 */
export function useTerminalMouseWheel({
	isActive = true,
	onWheel,
}: UseTerminalMouseWheelOptions): void {
	const {stdout} = useStdout();
	const stdinContext = useStdin() as {
		setRawMode?: (value: boolean) => void;
		isRawModeSupported?: boolean;
		internal_eventEmitter?: EventEmitter;
	};
	const {
		setRawMode,
		isRawModeSupported,
		internal_eventEmitter: inkEmitter,
	} = stdinContext;

	// Keep latest callback without re-subscribing every render.
	const onWheelRef = useRef(onWheel);
	onWheelRef.current = onWheel;

	useEffect(() => {
		if (!isActive) {
			return;
		}

		if (!stdout?.isTTY || !isRawModeSupported || !inkEmitter) {
			return;
		}

		setRawMode?.(true);
		const releaseMouse = acquireTerminalMouseTracking(data => {
			stdout.write(data);
		});

		const handleInput = (chunk: string) => {
			const event = parseTerminalMouseWheel(chunk);
			if (!event) {
				return;
			}
			onWheelRef.current(event);
		};

		inkEmitter.on('input', handleInput);

		return () => {
			inkEmitter.removeListener('input', handleInput);
			releaseMouse();
			setRawMode?.(false);
		};
	}, [isActive, stdout, setRawMode, isRawModeSupported, inkEmitter]);
}
