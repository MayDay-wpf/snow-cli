import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
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
	const barWidth = Math.max(20, Math.min(46, terminalWidth - 12));
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

function buildStreamViewportLines(
	content: string | undefined,
	terminalWidth: number,
): string[] {
	const visualWidth = Math.max(24, terminalWidth - 4);
	const normalizedContent = content?.replace(/\r\n/g, '\n') ?? '';
	const logicalLines = normalizedContent ? normalizedContent.split('\n') : [];
	const visualLines = logicalLines.flatMap(line => {
		if (!line) {
			return [''];
		}

		const segments: string[] = [];
		for (let index = 0; index < line.length; index += visualWidth) {
			segments.push(line.slice(index, index + visualWidth));
		}
		return segments;
	});
	const visibleLines = visualLines.slice(-STREAM_VIEWPORT_HEIGHT);

	return [
		...Array(Math.max(0, STREAM_VIEWPORT_HEIGHT - visibleLines.length)).fill(
			'',
		),
		...visibleLines,
	];
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

		return (
			<Box flexDirection="column" width={terminalWidth}>
				<Box>
					<Text color={theme.colors.menuInfo}>
						✵ Compacting conversation...
					</Text>
				</Box>

				<Box
					paddingLeft={2}
					marginTop={1}
					height={STREAM_VIEWPORT_HEIGHT}
					flexDirection="column"
				>
					{streamViewportLines.map((line, index) => (
						<Text
							key={`compression-stream-line-${index}`}
							italic
							dimColor
							color={theme.colors.menuSecondary}
							wrap="truncate"
						>
							{line || ' '}
						</Text>
					))}
				</Box>

				{sessionId && (
					<Box paddingLeft={2} marginTop={1}>
						<Text dimColor>Session: </Text>
						<Text color={theme.colors.menuSecondary}>{sessionId}</Text>
					</Box>
				)}

				<Box paddingLeft={2} marginTop={1}>
					<Text color={theme.colors.text}>{filledBar}</Text>
					<Text dimColor>{emptyBar}</Text>
					<Text dimColor> {progress}%</Text>
				</Box>

				{message && (
					<Box paddingLeft={2} marginTop={1}>
						<Text dimColor wrap="truncate">
							{message}
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
