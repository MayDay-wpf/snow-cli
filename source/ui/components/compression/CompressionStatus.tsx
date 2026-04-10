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

export function CompressionStatus({
	status,
	terminalWidth,
}: CompressionStatusProps) {
	const {theme} = useTheme();

	if (!status) {
		return null;
	}

	const {step, message, sessionId, retryAttempt, maxRetries} = status;
	const isActive =
		step === 'saving' || step === 'loading' || step === 'compressing';
	const isRetrying = step === 'retrying';
	const isCompleted = step === 'completed';
	const isFailed = step === 'failed' || step === 'skipped';

	const stepInfo = stepIcons[step];
	const label = isRetrying && retryAttempt && maxRetries
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
						{step === 'compressing' && 'Optimizing context for token limit...'}
					</Text>
				</Box>
			)}
		</Box>
	);
}

export default CompressionStatus;
