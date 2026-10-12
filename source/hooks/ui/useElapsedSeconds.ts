import {useEffect, useRef, useState} from 'react';

/**
 * Issue #215：为非流式 busy 态提供 elapsed 秒数（每秒递增）。
 *
 * - active=false 时归零并停止计时（避免空闲空转）。
 * - active=true 时从 0 开始计时，直到 active 变回 false 重置。
 *
 * 用于让常驻动画指示同时展示“还活着”（动画）与“没卡死”（数字）两类语义。
 */
export function useElapsedSeconds(active: boolean): number {
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const startTimeRef = useRef<number | null>(null);

	useEffect(() => {
		if (!active) {
			startTimeRef.current = null;
			setElapsedSeconds(0);
			return undefined;
		}

		startTimeRef.current = Date.now();
		setElapsedSeconds(0);

		const interval = setInterval(() => {
			if (startTimeRef.current === null) {
				return;
			}

			setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
		}, 1000);

		return () => clearInterval(interval);
	}, [active]);

	return elapsedSeconds;
}
