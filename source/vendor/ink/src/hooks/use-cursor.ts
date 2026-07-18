import {useContext, useRef, useCallback, useEffect} from 'react';
import CursorContext from '../components/CursorContext.js';
import {type DOMElement} from '../dom.js';

type CursorOffset = {
	x: number;
	y: number;
};

/**
 * Hook that controls the real terminal cursor position.
 *
 * Returns a ref to attach to the `<Box>` that contains the cursor,
 * and a function to set the cursor offset within that box.
 *
 * Pass `undefined` to hide the cursor.
 */
const useCursor = () => {
	const {registerCursor} = useContext(CursorContext);
	const nodeRef = useRef<DOMElement | null>(null);

	const setCursorPosition = useCallback(
		(position: CursorOffset | undefined) => {
			if (position) {
				registerCursor({
					nodeRef,
					offsetX: position.x,
					offsetY: position.y,
				});
			} else {
				registerCursor(undefined);
			}
		},
		[registerCursor],
	);

	useEffect(() => {
		return () => {
			registerCursor(undefined);
		};
	}, [registerCursor]);

	return {setCursorPosition, cursorRef: nodeRef};
};

export default useCursor;
