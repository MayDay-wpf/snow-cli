import React from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/I18nContext.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {BackgroundProcess} from '../../../hooks/execution/useBackgroundProcesses.js';

interface BackgroundProcessPanelProps {
	processes: BackgroundProcess[];
	selectedIndex: number;
	terminalWidth: number;
}

/**
 * Truncate command text to prevent overflow
 */
function truncateCommand(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) {
		return text;
	}
	const ellipsis = '...';
	const halfWidth = Math.floor((maxWidth - ellipsis.length) / 2);
	return text.slice(0, halfWidth) + ellipsis + text.slice(-halfWidth);
}

/**
 * Format duration from start to now or end
 */
function formatDuration(start: Date, end?: Date): string {
	const endTime = end || new Date();
	const seconds = Math.floor((endTime.getTime() - start.getTime()) / 1000);

	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

export function BackgroundProcessPanel({
	processes,
	selectedIndex,
	terminalWidth,
}: BackgroundProcessPanelProps) {
	const {t} = useI18n();
	const {theme} = useTheme();

	// Only show running processes first, then completed/failed
	const sortedProcesses = [...processes].sort((a, b) => {
		if (a.status === 'running' && b.status !== 'running') return -1;
		if (a.status !== 'running' && b.status === 'running') return 1;
		return b.startedAt.getTime() - a.startedAt.getTime();
	});

	// Calculate max command width
	const maxCommandWidth = Math.max(30, terminalWidth - 35);

	// Max visible items in scrollable list
	const maxVisibleItems = 5;
	const totalItems = sortedProcesses.length;

	// Calculate scroll offset based on selected index
	let scrollOffset = 0;
	if (totalItems > maxVisibleItems) {
		scrollOffset = Math.max(
			0,
			Math.min(selectedIndex - 2, totalItems - maxVisibleItems),
		);
	}

	const visibleProcesses = sortedProcesses.slice(
		scrollOffset,
		scrollOffset + maxVisibleItems,
	);

	const getStatusText = (process: BackgroundProcess) => {
		if (process.status === 'running') {
			return t.backgroundProcesses.statusRunning;
		}
		if (process.status === 'completed') {
			return t.backgroundProcesses.statusCompleted;
		}
		return t.backgroundProcesses.statusFailed;
	};

	const getStatusColor = (status: string) => {
		if (status === 'running') return theme.colors.menuInfo;
		if (status === 'completed') return theme.colors.success;
		return theme.colors.error;
	};

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={0}
			paddingY={0}
			width={terminalWidth}
		>
			<Box paddingTop={1} paddingX={1}>
				<Text bold color={theme.colors.menuInfo}>
					{t.backgroundProcesses.title} ({sortedProcesses.length})
				</Text>
			</Box>

			{sortedProcesses.length === 0 ? (
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>{t.backgroundProcesses.emptyHint}</Text>
				</Box>
			) : (
				<>
					{visibleProcesses.map((process, visibleIndex) => {
						const actualIndex = scrollOffset + visibleIndex;
						const isSelected = actualIndex === selectedIndex;

						return (
							<Box key={process.id} flexDirection="column" paddingY={0}>
								<Box paddingX={1}>
									<Text
										color={isSelected ? theme.colors.warning : undefined}
										bold={isSelected}
									>
										{isSelected ? '> ' : '  '}
									</Text>
									<Text dimColor={!isSelected}>
										{truncateCommand(process.command, maxCommandWidth)}
									</Text>
								</Box>
								<Box paddingX={1}>
									<Text dimColor>
										{'    '}PID: {process.pid} | {t.backgroundProcesses.status}:{' '}
									</Text>
									<Text color={getStatusColor(process.status)}>
										{getStatusText(process)}
									</Text>
									<Text dimColor>
										{' '}
										| {t.backgroundProcesses.duration}:{' '}
										{formatDuration(process.startedAt, process.completedAt)}
									</Text>
								</Box>
							</Box>
						);
					})}

					{totalItems > maxVisibleItems && (
						<Box paddingX={1} paddingBottom={1}>
							<Text dimColor>
								{t.backgroundProcesses.navigateHint} | Showing{' '}
								{scrollOffset + 1}-
								{Math.min(scrollOffset + maxVisibleItems, totalItems)} of{' '}
								{totalItems}
							</Text>
						</Box>
					)}
				</>
			)}

			{totalItems <= maxVisibleItems && (
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>{t.backgroundProcesses.navigateHint}</Text>
				</Box>
			)}
		</Box>
	);
}
