import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/I18nContext.js';
import {useTheme} from '../../contexts/ThemeContext.js';

interface SchedulerCountdownProps {
	description: string;
	totalDuration: number;
	remainingSeconds: number;
	terminalWidth: number;
}

/**
 * Format seconds into mm:ss format
 */
function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins.toString().padStart(2, '0')}:${secs
		.toString()
		.padStart(2, '0')}`;
}

/**
 * Get progress bar characters based on completion percentage
 */
function getProgressBar(
	progress: number,
	width: number,
	filledChar: string,
	emptyChar: string,
): string {
	const filled = Math.round((progress / 100) * width);
	const empty = width - filled;
	return filledChar.repeat(filled) + emptyChar.repeat(empty);
}

export function SchedulerCountdown({
	description,
	totalDuration,
	remainingSeconds,
	terminalWidth,
}: SchedulerCountdownProps) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [elapsedMs, setElapsedMs] = useState(0);

	// Update elapsed time every 100ms for smooth progress display
	useEffect(() => {
		const interval = setInterval(() => {
			setElapsedMs(prev => prev + 100);
		}, 100);
		return () => clearInterval(interval);
	}, []);

	// Calculate progress percentage
	const elapsedSeconds = totalDuration - remainingSeconds;
	const subSecondProgress = Math.min(elapsedMs / 1000, 1);
	const totalProgressSeconds = elapsedSeconds + subSecondProgress;
	const progressPercent = Math.min(
		100,
		(totalProgressSeconds / totalDuration) * 100,
	);

	// Progress bar width (leave space for padding and borders)
	const progressBarWidth = Math.max(20, terminalWidth - 30);
	const progressBar = getProgressBar(
		progressPercent,
		progressBarWidth,
		'█',
		'░',
	);

	// Format display strings
	const remainingFormatted = formatDuration(remainingSeconds);
	const totalFormatted = formatDuration(totalDuration);

	// Truncate description if too long
	const maxDescWidth = Math.max(40, terminalWidth - 20);
	const displayDescription =
		description.length > maxDescWidth
			? description.slice(0, maxDescWidth - 3) + '...'
			: description;

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box>
				<Text bold color={theme.colors.menuInfo}>
					<Spinner type="dots" /> {t.scheduler?.title || '预约任务'}
				</Text>
			</Box>
			<Box paddingLeft={2} marginTop={1}>
				<Text color={theme.colors.menuInfo}>任务: </Text>
				<Text dimColor wrap="truncate">
					{displayDescription}
				</Text>
			</Box>
			<Box paddingLeft={2} marginTop={1}>
				<Text color={theme.colors.menuInfo}>进度: </Text>
				<Text color={theme.colors.success}>{progressBar}</Text>
			</Box>
			<Box paddingLeft={2}>
				<Text dimColor>
					{remainingFormatted} / {totalFormatted} ({Math.round(progressPercent)}
					%)
				</Text>
			</Box>
			<Box paddingLeft={2} marginTop={1}>
				<Text dimColor>
					{t.scheduler?.hint || 'AI 流程已暂停，等待倒计时结束...'}
				</Text>
			</Box>
		</Box>
	);
}
