import React, {useState, useEffect, memo} from 'react';
import {Text} from 'ink';
import chalk from 'chalk';

interface ShimmerTextProps {
	text: string;
	baseColor?: string;
	shimmerColor?: string;
}

const DEFAULT_SHIMMER_COLOR = '#00FFFF';
const DEFAULT_BASE_COLOR = '#1ACEB0';

/**
 * Width of the shimmer highlight window (in characters).
 * A value of 3 means the highlight covers 3 characters at a time,
 * producing a soft "glow band" instead of a single hard pixel.
 */
const SHIMMER_WINDOW = 3;
/**
 * Animation interval in ms. 200ms keeps the glow visibly flowing while
 * drastically reducing repaint frequency vs the previous 100ms, which
 * mitigates terminal flicker caused by excessive ANSI re-emission.
 */
const SHIMMER_INTERVAL_MS = 200;

/**
 * ShimmerText component that displays text with a shimmer effect flowing through base text.
 *
 * Optimization notes:
 * - Renders the text in up to 3 contiguous segments (prefix / highlight / suffix)
 *   instead of per-character chalk calls, dramatically cutting the number of
 *   ANSI escape sequences emitted each frame.
 * - The frame state is driven by a dedicated interval (200ms) decoupled from
 *   parent re-renders; combined with React.memo this prevents cascading
 *   repaints when the parent (e.g. LoadingIndicator) updates token counts.
 */
function ShimmerText({
	text,
	baseColor = DEFAULT_BASE_COLOR,
	shimmerColor = DEFAULT_SHIMMER_COLOR,
}: ShimmerTextProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (text.length === 0) return;

		const totalFrames = text.length + SHIMMER_WINDOW;
		const interval = setInterval(() => {
			setFrame(prev => (prev + 1) % totalFrames);
		}, SHIMMER_INTERVAL_MS);

		return () => clearInterval(interval);
	}, [text.length]);

	// Highlight window: [frame-1 .. frame+1] clamped to text bounds.
	const halfWindow = Math.floor(SHIMMER_WINDOW / 2);
	const highlightStart = Math.max(0, frame - halfWindow);
	const highlightEnd = Math.min(text.length, frame + halfWindow + 1);

	const prefix = text.slice(0, highlightStart);
	const highlight = text.slice(highlightStart, highlightEnd);
	const suffix = text.slice(highlightEnd);

	return (
		<Text>
			{prefix && <Text bold>{chalk.hex(baseColor)(prefix)}</Text>}
			{highlight && <Text bold>{chalk.hex(shimmerColor)(highlight)}</Text>}
			{suffix && <Text bold>{chalk.hex(baseColor)(suffix)}</Text>}
		</Text>
	);
}

export default memo(ShimmerText);
