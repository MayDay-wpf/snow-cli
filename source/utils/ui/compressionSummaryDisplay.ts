import {toCodePoints, visualWidth} from '../core/textUtils.js';

const AUTO_COMPRESSION_SUMMARY_MARKER =
	'## Previous Context (Auto-Compressed Summary)';
const MANUAL_COMPRESSION_SUMMARY_MARKER =
	'[Context Summary from Previous Conversation]';
const AUTO_COMPRESSION_FOOTER_PREFIX =
	'*The above is a compressed summary of earlier conversation.';
const PRESERVED_INTERACTION_MARKER =
	'[Last Interaction - Preserved Below for Continuity]';

export type CompressionSummaryKind = 'auto' | 'manual';

export type CompressionSummaryDisplay = {
	kind: CompressionSummaryKind;
	lineCount: number;
	charCount: number;
	previewLines: string[];
};

type CompressionSummaryDisplayOptions = {
	maxPreviewLines?: number;
	maxPreviewWidth?: number;
};

export function getCompressionSummaryKind(
	content: string,
): CompressionSummaryKind | null {
	if (content.includes(AUTO_COMPRESSION_SUMMARY_MARKER)) {
		return 'auto';
	}

	if (content.includes(MANUAL_COMPRESSION_SUMMARY_MARKER)) {
		return 'manual';
	}

	return null;
}

export function getCompressionSummaryDisplay(
	content: string,
	options: CompressionSummaryDisplayOptions = {},
): CompressionSummaryDisplay | null {
	const kind = getCompressionSummaryKind(content);
	if (!kind) {
		return null;
	}

	const normalizedContent = content.replace(/\r\n/g, '\n');
	const lines = normalizedContent.split('\n');
	const summaryStartIndex = findSummaryStartIndex(lines, kind);
	const previewLines = lines
		.slice(summaryStartIndex)
		.map(sanitizePreviewLine)
		.filter(line => shouldKeepPreviewLine(line))
		.slice(0, options.maxPreviewLines ?? 3)
		.map(line => clipToVisualWidth(line, options.maxPreviewWidth ?? 96));

	return {
		kind,
		lineCount: lines.length,
		charCount: toCodePoints(normalizedContent).length,
		previewLines,
	};
}

function findSummaryStartIndex(
	lines: string[],
	kind: CompressionSummaryKind,
): number {
	const marker =
		kind === 'auto'
			? AUTO_COMPRESSION_SUMMARY_MARKER
			: MANUAL_COMPRESSION_SUMMARY_MARKER;
	const markerIndex = lines.findIndex(line => line.includes(marker));

	return markerIndex >= 0 ? markerIndex + 1 : 0;
}

function sanitizePreviewLine(line: string): string {
	return line
		.replace(/^#{1,6}\s+/, '')
		.replace(/^[-*]\s+/, '')
		.replace(/^`{3,}\w*\s*$/, '')
		.replace(/`/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function shouldKeepPreviewLine(line: string): boolean {
	return (
		line.length > 0 &&
		line !== '---' &&
		line !== AUTO_COMPRESSION_SUMMARY_MARKER &&
		line !== MANUAL_COMPRESSION_SUMMARY_MARKER &&
		line !== PRESERVED_INTERACTION_MARKER &&
		!line.startsWith(AUTO_COMPRESSION_FOOTER_PREFIX)
	);
}

function clipToVisualWidth(text: string, maxWidth: number): string {
	const safeWidth = Math.max(maxWidth, 8);
	if (visualWidth(text) <= safeWidth) {
		return text;
	}

	let currentWidth = 0;
	let clipped = '';
	const suffix = '...';
	const contentWidth = Math.max(safeWidth - visualWidth(suffix), 1);

	for (const char of toCodePoints(text)) {
		const charWidth = Math.max(visualWidth(char), 1);
		if (currentWidth + charWidth > contentWidth) {
			break;
		}

		clipped += char;
		currentWidth += charWidth;
	}

	return `${clipped}${suffix}`;
}
