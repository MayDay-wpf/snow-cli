import { useState, useCallback, useEffect, useRef } from 'react';
import { TextBuffer, Viewport } from '../utils/textBuffer.js';

export function useInputBuffer(viewport: Viewport) {
	const [, setForceUpdateState] = useState({});
	const lastUpdateTime = useRef<number>(0);
	const bufferRef = useRef<TextBuffer | null>(null);

	// Stable forceUpdate function using useRef
	const forceUpdateRef = useRef(() => {
		setForceUpdateState({});
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
