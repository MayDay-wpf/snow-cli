import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';

export type CompressionStep =
	| 'saving'
	| 'loading'
	| 'compressing'
	| 'completed'
	| 'failed'
	| 'skipped';

export type CompressionStatus = {
	step: CompressionStep;
	message?: string;
	sessionId?: string;
};

interface CompressionStatusProps {
	status: CompressionStatus | null;
	terminalWidth: number;
}

const stepIcons: Record<CompressionStep, {icon: string; color: string}> = {
	saving: {icon: '◉', color: 'yellow'},
	loading: {icon: '◉', color: 'cyan'},
	compressing: {icon: '◉', color: 'blue'},
	completed: {icon: '✓', color: 'green'},
	failed: {icon: '✗', color: 'red'},
	skipped: {icon: '○', color: 'gray'},
};

const stepLabels: Record<CompressionStep, string> = {
	saving: 'Saving session',
	loading: 'Loading session',
	compressing: 'Compressing context',
	completed: 'Compression complete',
	failed: 'Compression failed',
	skipped: 'Compression skipped',
};

export function CompressionStatus({
	status,
	terminalWidth,
}: CompressionStatusProps) {
	const {theme} = useTheme();

	if (!status) {
		return null;
	}

	const {step, message, sessionId} = status;
	const isActive =
		step === 'saving' || step === 'loading' || step === 'compressing';
	const isCompleted = step === 'completed';
	const isFailed = step === 'failed' || step === 'skipped';

	const stepInfo = stepIcons[step];
	const label = stepLabels[step];

	// Get theme color
	const getColor = () => {
		if (isFailed) return theme.colors.error;
		if (isCompleted) return theme.colors.success;
		return theme.colors.menuInfo;
	};

	const color = getColor();

	return (
		<Box flexDirection="column" paddingX={1} width={terminalWidth}>
			<Box>
				<Text bold color={color}>
					{isActive ? (
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
				<Box paddingLeft={2} marginTop={isActive ? 0 : 1}>
					<Text dimColor>Session: </Text>
					<Text color={theme.colors.menuSecondary}>{sessionId}</Text>
				</Box>
			)}

			{message && (
				<Box paddingLeft={2} marginTop={1}>
					<Text dimColor wrap="truncate">
						{message}
					</Text>
				</Box>
			)}

			{/* Progress indicator for active steps */}
			{isActive && (
				<Box paddingLeft={2} marginTop={1}>
					<Text color={theme.colors.menuSecondary}>
						{step === 'saving' && 'Persisting conversation data...'}
						{step === 'loading' && 'Reading session from disk...'}
						{step === 'compressing' && 'Optimizing context for token limit...'}
					</Text>
				</Box>
			)}
		</Box>
	);
}

export default CompressionStatus;
