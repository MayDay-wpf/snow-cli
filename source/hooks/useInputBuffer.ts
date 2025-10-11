import { useState, useCallback, useEffect, useRef } from 'react';
import { TextBuffer, Viewport } from '../utils/textBuffer.js';

export function useInputBuffer(viewport: Viewport) {
	const [, forceUpdate] = useState({});
	const lastUpdateTime = useRef<number>(0);

	// Force re-render when buffer changes
	const triggerUpdate = useCallback(() => {
		const now = Date.now();
		lastUpdateTime.current = now;
		forceUpdate({});
	}, []);

	const [buffer] = useState(() => new TextBuffer(viewport, triggerUpdate));

	// Update buffer viewport when viewport changes
	useEffect(() => {
		buffer.updateViewport(viewport);
		triggerUpdate();
	}, [viewport.width, viewport.height, buffer, triggerUpdate]);

	// Cleanup buffer on unmount
	useEffect(() => {
		return () => {
			buffer.destroy();
		};
	}, [buffer]);

	return {
		buffer,
		triggerUpdate,
		forceUpdate,
	};
}
