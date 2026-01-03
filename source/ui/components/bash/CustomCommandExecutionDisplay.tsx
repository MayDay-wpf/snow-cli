import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';

interface CustomCommandExecutionDisplayProps {
	command: string;
	commandName: string;
	isRunning: boolean;
	output: string[];
	exitCode?: number | null;
	error?: string;
}

/**
 * Truncate text to prevent overflow
 */
function truncateText(text: string, maxWidth: number = 80): string {
	if (text.length <= maxWidth) {
		return text;
	}
	return text.slice(0, maxWidth - 3) + '...';
}

/**
 * Simple component for displaying custom command execution with real-time output
 */
export function CustomCommandExecutionDisplay({
	commandName,
	isRunning,
	output,
	exitCode,
	error,
}: CustomCommandExecutionDisplayProps) {
	const {theme} = useTheme();

	return (
		<Box flexDirection="column">
			{/* Header line */}
			<Box>
				<Text dimColor>/{commandName} </Text>
				{isRunning ? (
					<Text color={theme.colors.menuInfo}>
						<Spinner type="dots" />
					</Text>
				) : exitCode === 0 ? (
					<Text color={theme.colors.success}>✔</Text>
				) : (
					<>
						<Text color={theme.colors.error}>✘</Text>
						{exitCode !== null && exitCode !== undefined && (
							<Text color={theme.colors.error}> (exit: {exitCode})</Text>
						)}
					</>
				)}
			</Box>

			{/* Output lines - fixed height to prevent layout jitter, handle multi-line output */}
			<Box flexDirection="column" paddingLeft={2} height={5}>
				{output
					.flatMap(line => line.split(/\r?\n/))
					.slice(-5)
					.map((line, index) => (
						<Text key={index} wrap="truncate" dimColor>
							{truncateText(line, 100)}
						</Text>
					))}
			</Box>

			{/* Error message */}
			{error && (
				<Box paddingLeft={2}>
					<Text color={theme.colors.error}>{error}</Text>
				</Box>
			)}

			{/* No output message */}
			{!isRunning && output.length === 0 && !error && (
				<Text dimColor>(no output)</Text>
			)}
		</Box>
	);
}

export default CustomCommandExecutionDisplay;
