import React from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import {useTheme} from '../../contexts/ThemeContext.js';

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
	const normalized = normalizeStreamContent(content);
	// 没有实际思考内容时不渲染空白占位行，避免“空思考”面板。
	if (!normalized.trim()) {
		return [];
	}

	const logicalLines = normalized.split('\n');
	const visibleLines = logicalLines.slice(-STREAM_VIEWPORT_HEIGHT);

	return [
		// 仅在已有内容时补齐高度，保证流式滚动视口稳定；
		// 空内容上面已 early-return，不会再出现 5 行空白。
		...Array(Math.max(0, STREAM_VIEWPORT_HEIGHT - visibleLines.length)).fill({
			text: ' ',
		}),
		...visibleLines.map(line => ({
			text: sliceByVisualWidth(line || ' ', width) || ' ',
		})),
	];
}

export function ThinkingStatus({status, terminalWidth}: ThinkingStatusProps) {
	const {theme} = useTheme();

	if (!status || !status.isActive) {
		return null;
	}

	const streamViewportLines = buildStreamViewportLines(
		status.content,
		terminalWidth,
	);
	// 思考内容为空时不渲染，避免出现空思考面板；
	// “Thinking...” 流光标题已移除，该状态统一由 LoadingIndicator 承担，避免重复。
	if (streamViewportLines.length === 0) {
		return null;
	}

	return (
		<Box
			flexDirection="column"
			width={terminalWidth}
			paddingX={1}
			marginBottom={1}
		>
			<Box paddingLeft={STREAM_VIEWPORT_INDENT_WIDTH} flexDirection="column">
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
