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
	}, []); // 空依赖项确保函数稳定

	const [buffer] = useState(() => new TextBuffer(viewport, triggerUpdate));

	// Update buffer viewport when viewport changes
	useEffect(() => {
		buffer.updateViewport(viewport);
		// 直接调用 forceUpdate 而不是 triggerUpdate，避免依赖问题
		forceUpdate({});
	}, [viewport.width, viewport.height]); // 移除 buffer 和 triggerUpdate 避免循环依赖

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
