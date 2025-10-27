import {useState, useEffect} from 'react';
import type {UsageInfo} from '../api/chat.js';

export type RetryStatus = {
	isRetrying: boolean;
	attempt: number;
	nextDelay: number;
	remainingSeconds?: number;
	errorMessage?: string;
};

export function useStreamingState() {
	const [isStreaming, setIsStreaming] = useState(false);
	const [streamTokenCount, setStreamTokenCount] = useState(0);
	const [isReasoning, setIsReasoning] = useState(false);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	const [contextUsage, setContextUsage] = useState<UsageInfo | null>(null);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [timerStartTime, setTimerStartTime] = useState<number | null>(null);
	const [retryStatus, setRetryStatus] = useState<RetryStatus | null>(null);
	const [animationFrame, setAnimationFrame] = useState(0);

	// Animation for streaming/saving indicator
	useEffect(() => {
		if (!isStreaming) return;

		const interval = setInterval(() => {
			setAnimationFrame(prev => (prev + 1) % 5);
		}, 300);

		return () => {
			clearInterval(interval);
			setAnimationFrame(0);
		};
	}, [isStreaming]);

	// Timer for tracking request duration
	useEffect(() => {
		if (isStreaming && timerStartTime === null) {
			// Start timer when streaming begins
			setTimerStartTime(Date.now());
			setElapsedSeconds(0);
		} else if (!isStreaming && timerStartTime !== null) {
			// Stop timer when streaming ends
			setTimerStartTime(null);
		}
	}, [isStreaming, timerStartTime]);

	// Update elapsed time every second
	useEffect(() => {
		if (timerStartTime === null) return;

		const interval = setInterval(() => {
			const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
			setElapsedSeconds(elapsed);
		}, 1000);

		return () => clearInterval(interval);
	}, [timerStartTime]);

	// Initialize remaining seconds when retry starts
	useEffect(() => {
		if (!retryStatus || !retryStatus.isRetrying) return;
		if (retryStatus.remainingSeconds !== undefined) return;

		// Initialize remaining seconds from nextDelay (only once)
		setRetryStatus(prev =>
			prev
				? {
						...prev,
						remainingSeconds: Math.ceil(prev.nextDelay / 1000),
				  }
				: null,
		);
	}, [retryStatus?.isRetrying, retryStatus?.nextDelay]);

	// Countdown timer for retry delays
	useEffect(() => {
		if (!retryStatus || !retryStatus.isRetrying) return;
		if (retryStatus.remainingSeconds === undefined) return;

		// Countdown every second
		const interval = setInterval(() => {
			setRetryStatus(prev => {
				if (!prev || prev.remainingSeconds === undefined) return prev;

				const newRemaining = prev.remainingSeconds - 1;
				if (newRemaining <= 0) {
					return {
						...prev,
						remainingSeconds: 0,
					};
				}

				return {
					...prev,
					remainingSeconds: newRemaining,
				};
			});
		}, 1000);

		return () => clearInterval(interval);
	}, [retryStatus?.isRetrying]); // ✅ 移除 remainingSeconds 避免循环

	return {
		isStreaming,
		setIsStreaming,
		streamTokenCount,
		setStreamTokenCount,
		isReasoning,
		setIsReasoning,
		abortController,
		setAbortController,
		contextUsage,
		setContextUsage,
		elapsedSeconds,
		retryStatus,
		setRetryStatus,
		animationFrame,
	};
}
