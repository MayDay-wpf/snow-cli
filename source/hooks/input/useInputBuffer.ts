import {useReducer, useCallback, useEffect, useRef} from 'react';
import {TextBuffer, Viewport} from '../../utils/ui/textBuffer.js';

export function useInputBuffer(viewport: Viewport) {
	// Use useReducer for faster synchronous updates
	const [, forceRender] = useReducer((x: number) => x + 1, 0);
	const lastUpdateTime = useRef<number>(0);
	const bufferRef = useRef<TextBuffer | null>(null);

	// Stable forceUpdate function using useRef
	const forceUpdateRef = useRef(() => {
		forceRender();
	});

	// Stable triggerUpdate function using useRef
	const triggerUpdateRef = useRef(() => {
		const now = Date.now();
		lastUpdateTime.current = now;
		forceUpdateRef.current();
	});

	// Initialize buffer once
	if (!bufferRef.current) {
		bufferRef.current = new TextBuffer(viewport, triggerUpdateRef.current);
	}
	const buffer = bufferRef.current;

	// Expose stable callback functions
	const forceUpdate = useCallback(() => {
		forceUpdateRef.current();
	}, []);

	const triggerUpdate = useCallback(() => {
		triggerUpdateRef.current();
	}, []);

	// Update buffer viewport when viewport changes
	useEffect(() => {
		buffer.updateViewport(viewport);
		forceUpdateRef.current();
	}, [viewport.width, viewport.height, buffer]);

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
