import {useState, useEffect, useSyncExternalStore, useRef} from 'react';
import type {UsageInfo} from '../../api/chat.js';
import {pauseGate, type PauseState} from '../../utils/execution/pauseGate.js';

export type RetryStatus = {
	isRetrying: boolean;
	attempt: number;
	nextDelay: number;
	maxRetries?: number;
	remainingSeconds?: number;
	errorMessage?: string;
};

export type CodebaseSearchStatus = {
	isSearching: boolean;
	attempt: number;
	maxAttempts: number;
	currentTopN: number;
	message: string;
	query?: string;
	originalResultsCount?: number;
	suggestion?: string;
};

export type StreamStatus = 'idle' | 'streaming' | 'stopping';

export function useStreamingState() {
	const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
	const isStreaming = streamStatus === 'streaming';
	const isStopping = streamStatus === 'stopping';

	// PauseGate subscription
	const subscribeToPauseGate = (cb: () => void) => pauseGate.subscribe(cb);
	const getPauseSnapshot = (): PauseState => pauseGate.state;
	const pauseState = useSyncExternalStore(
		subscribeToPauseGate,
		getPauseSnapshot,
	);
	const isPaused = pauseState === 'paused';

	const setIsStreaming: React.Dispatch<
		React.SetStateAction<boolean>
	> = action => {
		setStreamStatus(prev => {
			const currentIsStreaming = prev === 'streaming';
			const nextIsStreaming =
				typeof action === 'function' ? action(currentIsStreaming) : action;

			if (nextIsStreaming) return 'streaming';
			// When streaming ends (setIsStreaming(false)), always go to idle.
			// This includes the 'stopping' state - if stream has ended, we're done.
			return 'idle';
		});
	};

	const setIsStopping: React.Dispatch<
		React.SetStateAction<boolean>
	> = action => {
		setStreamStatus(prev => {
			const currentIsStopping = prev === 'stopping';
			const nextIsStopping =
				typeof action === 'function' ? action(currentIsStopping) : action;

			if (nextIsStopping) return 'stopping';
			if (prev === 'stopping') return 'idle';
			return prev;
		});
	};

	const [streamTokenCount, setStreamTokenCount] = useState(0);
	const [isReasoning, setIsReasoning] = useState(false);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	const [contextUsage, setContextUsage] = useState<UsageInfo | null>(null);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [timerStartTime, setTimerStartTime] = useState<number | null>(null);
	const pauseStartRef = useRef<number | null>(null);
	const pauseAccumulatedMsRef = useRef(0);
	const [retryStatus, setRetryStatus] = useState<RetryStatus | null>(null);
	const [animationFrame, setAnimationFrame] = useState(0);
	const [codebaseSearchStatus, setCodebaseSearchStatus] =
		useState<CodebaseSearchStatus | null>(null);
	const [currentModel, setCurrentModel] = useState<string | null>(null);
	const [isAutoCompressing, setIsAutoCompressing] = useState(false);
	const [compressBlockToast, setCompressBlockToast] = useState<string | null>(
		null,
	);

	// Auto-clear compress block toast after 2 seconds
	useEffect(() => {
		if (!compressBlockToast) return;
		const timeoutId = setTimeout(() => {
			setCompressBlockToast(null);
		}, 2000);
		return () => clearTimeout(timeoutId);
	}, [compressBlockToast]);

	// Animation for streaming/saving indicator
	useEffect(() => {
		if (!isStreaming || isPaused) return;

		const interval = setInterval(() => {
			setAnimationFrame(prev => (prev + 1) % 2);
		}, 500);

		return () => {
			clearInterval(interval);
			setAnimationFrame(0);
		};
	}, [isStreaming, isPaused]);

	// Track pause intervals to compensate elapsed time
	useEffect(() => {
		if (isPaused) {
			pauseStartRef.current = Date.now();
		} else if (pauseStartRef.current !== null) {
			pauseAccumulatedMsRef.current += Date.now() - pauseStartRef.current;
			pauseStartRef.current = null;
		}
	}, [isPaused]);

	// Timer for tracking request duration
	useEffect(() => {
		if (isStreaming && timerStartTime === null) {
			// Start timer when streaming begins
			setTimerStartTime(Date.now());
			pauseAccumulatedMsRef.current = 0;
			pauseStartRef.current = null;
			setElapsedSeconds(0);
		} else if (!isStreaming && timerStartTime !== null) {
			// Stop timer when streaming ends
			setTimerStartTime(null);
		}
	}, [isStreaming, timerStartTime]);

	// Update elapsed time every second (frozen during pause)
	useEffect(() => {
		if (timerStartTime === null) return;

		const interval = setInterval(() => {
			if (pauseStartRef.current !== null) return; // frozen during pause
			const elapsed = Math.floor(
				(Date.now() - timerStartTime - pauseAccumulatedMsRef.current) / 1000,
			);
			setElapsedSeconds(elapsed);
		}, 1000);

		return () => clearInterval(interval);
	}, [timerStartTime]);

	// Initialize remaining seconds when retry starts / attempt changes.
	// 注意：仅依赖 isRetrying 时，remainingSeconds 后置初始化不会触发 countdown 重启。
	useEffect(() => {
		if (!retryStatus?.isRetrying) return;
		if (retryStatus.remainingSeconds !== undefined) return;

		// Initialize remaining seconds from nextDelay (only once per attempt)
		setRetryStatus(prev =>
			prev
				? {
						...prev,
						remainingSeconds: Math.max(0, Math.ceil(prev.nextDelay / 1000)),
				  }
				: null,
		);
	}, [
		retryStatus?.isRetrying,
		retryStatus?.attempt,
		retryStatus?.remainingSeconds,
	]);

	// Countdown timer for retry delays.
	// 依赖 attempt：同一轮 isRetrying 保持 true 时，新一次重试也要重置并重新开表。
	// 不依赖 remainingSeconds，避免每秒重建 interval。
	useEffect(() => {
		if (!retryStatus || !retryStatus.isRetrying) return;
		if (retryStatus.remainingSeconds === undefined) return;

		const interval = setInterval(() => {
			setRetryStatus(prev => {
				if (!prev || !prev.isRetrying || prev.remainingSeconds === undefined) {
					return prev;
				}

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
	}, [
		retryStatus?.isRetrying,
		retryStatus?.attempt,
		retryStatus?.remainingSeconds === undefined,
	]);

	return {
		streamStatus,
		setStreamStatus,
		isStreaming,
		setIsStreaming,
		isStopping,
		setIsStopping,
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
		codebaseSearchStatus,
		setCodebaseSearchStatus,
		currentModel,
		setCurrentModel,
		isAutoCompressing,
		setIsAutoCompressing,
		compressBlockToast,
		setCompressBlockToast,
		isPaused,
		pauseGate,
	};
}
