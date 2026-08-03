import sliceAnsi from 'slice-ansi';
import stringWidth from 'string-width';

export type TimelineWindow = {
	visibleLines: string[];
	offset: number;
	moreAbove: number;
	moreBelow: number;
};

const finiteInteger = (value: number, fallback: number): number =>
	Number.isFinite(value) ? Math.trunc(value) : fallback;

/** Clamp a single-line string by terminal display columns. */
export function clampSubAgentLine(text: string, maxCols: number): string {
	if (maxCols <= 0) return '';
	if (stringWidth(text) <= maxCols) return text;
	if (maxCols <= 3) return sliceAnsi(text, 0, maxCols);
	return `${sliceAnsi(text, 0, maxCols - 3)}...`;
}

export function getSubAgentPanelLayout(terminalWidth: number): {
	panelWidth: number;
	maxLineCols: number;
} {
	const width = finiteInteger(terminalWidth, 80);
	const panelWidth = Math.max(1, width - 2);
	return {panelWidth, maxLineCols: Math.max(1, panelWidth - 5)};
}

export function getTimelineWindow(
	timeline: string[],
	timelineOffset: number,
	maxHeight = 5,
): TimelineWindow {
	const normalizedHeight = finiteInteger(maxHeight, 5);
	const visibleCount = Math.min(5, Math.max(4, normalizedHeight));
	const maxOffset = Math.max(0, timeline.length - visibleCount);
	const normalizedOffset = finiteInteger(timelineOffset, 0);
	const offset = Math.min(Math.max(0, normalizedOffset), maxOffset);

	return {
		visibleLines: timeline.slice(offset, offset + visibleCount),
		offset,
		moreAbove: offset,
		moreBelow: Math.max(0, timeline.length - (offset + visibleCount)),
	};
}
