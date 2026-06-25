import React from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import {useTheme} from '../../contexts/ThemeContext.js';
import ShimmerText from '../common/ShimmerText.js';

export type ThinkingStatus = {
	isActive: boolean;
	content?: string;
};

interface ThinkingStatusProps {
	status: ThinkingStatus | null;
	terminalWidth: number;
}

const STREAM_VIEWPORT_HEIGHT = 5;
const STREAM_VIEWPORT_RESERVED_COLUMNS = 4;
const STREAM_VIEWPORT_INDENT_WIDTH = 2;
const TITLE_PREFIX = '❆ ';
const TITLE_TEXT = 'Thinking...';

function getSafeLineWidth(terminalWidth: number, reservedColumns = 0): number {
	return Math.max(1, terminalWidth - reservedColumns);
}

function normalizeStreamContent(content: string | undefined): string {
	return (
		content
			?.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.replace(/[\t\v\f]+/g, ' ') ?? ''
	);
}

function sliceByVisualWidth(text: string, maxWidth: number): string {
	if (!text || maxWidth <= 0) {
		return '';
	}

	let result = '';
	let width = 0;

	for (const char of text) {
		const charWidth = stringWidth(char);
		if (width + charWidth > maxWidth) {
			break;
		}

		result += char;
		width += charWidth;
	}

	return result;
}

type StreamViewportLine = {
	text: string;
};

function buildStreamViewportLines(
	content: string | undefined,
	terminalWidth: number,
): StreamViewportLine[] {
	const width = getSafeLineWidth(
		terminalWidth,
		STREAM_VIEWPORT_INDENT_WIDTH + STREAM_VIEWPORT_RESERVED_COLUMNS,
	);
	const logicalLines = normalizeStreamContent(content).split('\n');
	const visibleLines = logicalLines.slice(-STREAM_VIEWPORT_HEIGHT);

	return [
		...Array(Math.max(0, STREAM_VIEWPORT_HEIGHT - visibleLines.length)).fill({
			text: ' ',
		}),
		...visibleLines.map(line => ({
			text: sliceByVisualWidth(line || ' ', width) || ' ',
		})),
	];
}

function buildSafeShimmerText(text: string, terminalWidth: number): string {
	const titleSafeWidth = getSafeLineWidth(terminalWidth, 1);
	const prefixWidth = stringWidth(TITLE_PREFIX);
	const available = Math.max(0, titleSafeWidth - prefixWidth);
	return sliceByVisualWidth(text, available);
}

const THINKING_SHIMMER_BASE = '#1ACEB0';
const THINKING_SHIMMER_COLOR = '#00FFFF';

export function ThinkingStatus({status, terminalWidth}: ThinkingStatusProps) {
	const {theme} = useTheme();

	if (!status || !status.isActive) {
		return null;
	}

	const streamViewportLines = buildStreamViewportLines(
		status.content,
		terminalWidth,
	);
	const safeShimmerText = buildSafeShimmerText(TITLE_TEXT, terminalWidth);

	return (
		<Box
			flexDirection="column"
			width={terminalWidth}
			paddingX={1}
			marginBottom={1}
		>
			<Box height={1}>
				<Text color={THINKING_SHIMMER_BASE} bold wrap="truncate">
					{TITLE_PREFIX}
					<ShimmerText
						text={safeShimmerText}
						baseColor={THINKING_SHIMMER_BASE}
						shimmerColor={THINKING_SHIMMER_COLOR}
					/>
				</Text>
			</Box>

			<Box
				paddingLeft={STREAM_VIEWPORT_INDENT_WIDTH}
				marginTop={1}
				flexDirection="column"
			>
				{streamViewportLines.map((line, index) => (
					<Box key={`thinking-stream-line-${index}`} height={1}>
						<Text
							italic
							dimColor
							color={theme.colors.menuSecondary}
							wrap="truncate"
						>
							{line.text}
						</Text>
					</Box>
				))}
			</Box>
		</Box>
	);
}

export default ThinkingStatus;
