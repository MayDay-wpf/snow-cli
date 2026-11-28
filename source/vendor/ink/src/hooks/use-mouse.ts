import {useEffect, useRef} from 'react';
import reconciler from '../reconciler.js';
import {type MouseEvent} from '../mouse.js';
import useStdin from './use-stdin.js';

type Options = {
	/**
	 * Enable or disable capturing of mouse events.
	 *
	 * @default true
	 */
	isActive?: boolean;
};

/**
 * Subscribe to terminal mouse events (wheel, press, release, drag).
 *
 * Mouse reporting is only enabled by the terminal while Ink runs in
 * full-screen mode (see `enterFullScreen`). Handlers are kept in a ref so
 * that callers don't need to memoize them.
 */
const useMouse = (
	handler: (event: MouseEvent) => void,
	options: Options = {},
): void => {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const {internal_eventEmitter} = useStdin();
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		if (options.isActive === false || !internal_eventEmitter) {
			return;
		}

		const listener = (event: MouseEvent) => {
			reconciler.batchedUpdates(() => {
				handlerRef.current(event);
			});
		};

		internal_eventEmitter.on('mouse', listener);
		return () => {
			internal_eventEmitter.removeListener('mouse', listener);
		};
	}, [options.isActive, internal_eventEmitter]);
};

export default useMouse;
