import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import stringWidth from 'string-width';
import {useTheme} from '../../contexts/ThemeContext.js';

export type CompressionStep =
	| 'saving'
	| 'loading'
	| 'compressing'
	| 'retrying'
	| 'completed'
	| 'failed'
	| 'skipped';

export type CompressionStatus = {
	step: CompressionStep;
	message?: string;
	sessionId?: string;
	retryAttempt?: number;
	maxRetries?: number;
	progress?: number;
	streamStarted?: boolean;
	streamContent?: string;
};

interface CompressionStatusProps {
	status: CompressionStatus | null;
	terminalWidth: number;
}

const stepIcons: Record<CompressionStep, {icon: string; color: string}> = {
	saving: {icon: '◉', color: 'yellow'},
	loading: {icon: '◉', color: 'cyan'},
	compressing: {icon: '◉', color: 'blue'},
	retrying: {icon: '⟳', color: 'yellow'},
	completed: {icon: '✓', color: 'green'},
	failed: {icon: '✗', color: 'red'},
	skipped: {icon: '○', color: 'gray'},
};

const stepLabels: Record<CompressionStep, string> = {
	saving: 'Saving session',
	loading: 'Loading session',
	compressing: 'Compressing context',
	retrying: 'Retrying compression',
	completed: 'Compression complete',
	failed: 'Compression failed',
	skipped: 'Compression skipped',
};

function clampProgress(progress: number): number {
	return Math.max(0, Math.min(100, Math.round(progress)));
}

function buildProgressBar(progress: number, terminalWidth: number) {
	const barWidth = Math.max(4, Math.min(46, terminalWidth - 12));
	const filled = Math.max(
		0,
		Math.min(barWidth, Math.round((progress / 100) * barWidth)),
	);
	const empty = barWidth - filled;

	return {
		filledBar: '▰'.repeat(filled),
		emptyBar: '▱'.repeat(empty),
	};
}

const STREAM_VIEWPORT_HEIGHT = 5;
const STREAM_VIEWPORT_RESERVED_COLUMNS = 8;
const STREAM_VIEWPORT_INDENT_WIDTH = 2;
const INDENT_WIDTH = 2;

type StreamViewportLine = {
	text: string;
};

function getSafeLineWidth(terminalWidth: number, reservedColumns = 0): number {
	return Math.max(1, terminalWidth - reservedColumns);
}

function getSafeIndentedLineWidth(terminalWidth: number): number {
	return getSafeLineWidth(
		terminalWidth,
		INDENT_WIDTH + STREAM_VIEWPORT_RESERVED_COLUMNS,
	);
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

function buildSafeInlineText(text: string, terminalWidth: number): string {
	return sliceByVisualWidth(text, getSafeLineWidth(terminalWidth, 1)) || ' ';
}

function buildSafeIndentedText(text: string, terminalWidth: number): string {
	return (
		sliceByVisualWidth(text, getSafeIndentedLineWidth(terminalWidth)) || ' '
	);
}

export function CompressionStatus({
	status,
	terminalWidth,
}: CompressionStatusProps) {
	const {theme} = useTheme();
	const [animatedProgress, setAnimatedProgress] = React.useState(0);

	React.useEffect(() => {
		if (!status) {
			setAnimatedProgress(0);
			return;
		}

		if (status.step === 'completed') {
			setAnimatedProgress(100);
			return;
		}

		if (status.step !== 'compressing') {
			setAnimatedProgress(0);
			return;
		}

		setAnimatedProgress(previous =>
			Math.max(previous, clampProgress(status.progress ?? 0)),
		);
	}, [status?.step, status?.progress]);

	React.useEffect(() => {
		if (!status || status.step !== 'compressing' || !status.streamStarted) {
			return;
		}

		setAnimatedProgress(previous => Math.max(previous, 10));
	}, [status?.step, status?.streamStarted]);

	if (!status) {
		return null;
	}

	const {step, message, sessionId, retryAttempt, maxRetries} = status;
	const isActive = step === 'saving' || step === 'loading';
	const isRetrying = step === 'retrying';
	const isCompleted = step === 'completed';
	const isFailed = step === 'failed' || step === 'skipped';

	if (step === 'compressing') {
		const progress = clampProgress(animatedProgress);
		const {filledBar, emptyBar} = buildProgressBar(progress, terminalWidth);
		const streamViewportLines = buildStreamViewportLines(
			status.streamContent,
			terminalWidth,
		);
		const safeTitle = buildSafeInlineText(
			'✵ Compacting conversation...',
			terminalWidth,
		);
		const sessionLine = sessionId
			? buildSafeIndentedText(`Session: ${sessionId}`, terminalWidth)
			: undefined;
		const progressLine = buildSafeIndentedText(
			`${filledBar}${emptyBar} ${progress}%`,
			terminalWidth,
		);
		const messageLine = message
			? buildSafeIndentedText(message, terminalWidth)
			: undefined;

		return (
			<Box flexDirection="column" width={terminalWidth}>
				<Box height={1}>
					<Text color={theme.colors.menuInfo} wrap="truncate">
						{safeTitle}
					</Text>
				</Box>

				<Box
					paddingLeft={STREAM_VIEWPORT_INDENT_WIDTH}
					marginTop={1}
					flexDirection="column"
				>
					{streamViewportLines.map((line, index) => (
						<Box key={`compression-stream-line-${index}`} height={1}>
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

				{sessionLine && (
					<Box paddingLeft={2} marginTop={1} height={1}>
						<Text color={theme.colors.menuSecondary} wrap="truncate">
							{sessionLine}
						</Text>
					</Box>
				)}

				<Box paddingLeft={2} marginTop={1} height={1}>
					<Text color={theme.colors.text} wrap="truncate">
						{progressLine}
					</Text>
				</Box>

				{messageLine && (
					<Box paddingLeft={2} marginTop={1} height={1}>
						<Text dimColor wrap="truncate">
							{messageLine}
						</Text>
					</Box>
				)}
			</Box>
		);
	}

	const stepInfo = stepIcons[step];
	const label =
		isRetrying && retryAttempt && maxRetries
			? `Retrying compression (${retryAttempt}/${maxRetries})`
			: stepLabels[step];

	const getColor = () => {
		if (isFailed) return theme.colors.error;
		if (isCompleted) return theme.colors.success;
		if (isRetrying) return theme.colors.warning;
		return theme.colors.menuInfo;
	};

	const color = getColor();

	return (
		<Box flexDirection="column" paddingX={1} width={terminalWidth}>
			<Box>
				<Text bold color={color}>
					{isActive || isRetrying ? (
						<>
							<Spinner type="dots" /> {label}
						</>
					) : (
						<>
							<Text color={stepInfo.color}>{stepInfo.icon}</Text> {label}
						</>
					)}
				</Text>
			</Box>

			{sessionId && (
				<Box paddingLeft={2} marginTop={isActive || isRetrying ? 0 : 1}>
					<Text dimColor>Session: </Text>
					<Text color={theme.colors.menuSecondary}>{sessionId}</Text>
				</Box>
			)}

			{message && (
				<Box paddingLeft={2} marginTop={1}>
					<Text
						dimColor={!isRetrying}
						color={isRetrying ? theme.colors.warning : undefined}
						wrap="truncate"
					>
						{message}
					</Text>
				</Box>
			)}

			{isActive && (
				<Box paddingLeft={2} marginTop={1}>
					<Text color={theme.colors.menuSecondary}>
						{step === 'saving' && 'Persisting conversation data...'}
						{step === 'loading' && 'Reading session from disk...'}
					</Text>
				</Box>
			)}
		</Box>
	);
}

export default CompressionStatus;
