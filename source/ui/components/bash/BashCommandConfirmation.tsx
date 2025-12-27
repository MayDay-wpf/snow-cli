import React, {useEffect} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/I18nContext.js';
import {isSensitiveCommand} from '../../../utils/execution/sensitiveCommandManager.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {unifiedHooksExecutor} from '../../../utils/execution/unifiedHooksExecutor.js';

interface BashCommandConfirmationProps {
	command: string;
	onConfirm: (proceed: boolean) => void;
	terminalWidth: number;
}

/**
 * Truncate command text to prevent overflow
 * @param text - Command text to truncate
 * @param maxWidth - Maximum width (defaults to 100)
 * @returns Truncated text with ellipsis if needed
 */
function truncateCommand(text: string, maxWidth: number = 100): string {
	if (text.length <= maxWidth) {
		return text;
	}
	const ellipsis = '...';
	const halfWidth = Math.floor((maxWidth - ellipsis.length) / 2);
	return text.slice(0, halfWidth) + ellipsis + text.slice(-halfWidth);
}

export function BashCommandConfirmation({
	command,
	terminalWidth,
}: BashCommandConfirmationProps) {
	const {t} = useI18n();
	const {theme} = useTheme();

	// Check if this is a sensitive command
	const sensitiveCheck = isSensitiveCommand(command);

	// Trigger toolConfirmation Hook when component mounts
	useEffect(() => {
		const context = {
			toolName: 'terminal-execute',
			args: JSON.stringify({command}),
			isSensitive: sensitiveCheck.isSensitive,
			matchedPattern: sensitiveCheck.matchedCommand?.pattern,
			matchedReason: sensitiveCheck.matchedCommand?.description,
		};

		// Execute hook and handle exit code
		unifiedHooksExecutor
			.executeHooks('toolConfirmation', context)
			.then((result: any) => {
				// Check for command failures
				const commandError = result.results.find(
					(r: any) => r.type === 'command' && !r.success,
				);

				if (commandError && commandError.type === 'command') {
					const {exitCode, command, output, error} = commandError;

					if (exitCode === 1) {
						// Warning: print to console
						const combinedOutput =
							[output, error].filter(Boolean).join('\n\n') || '(no output)';
						console.warn(
							`[Hook Warning] toolConfirmation Hook returned warning:\nCommand: ${command}\nOutput: ${combinedOutput}`,
						);
					} else if (exitCode >= 2 || exitCode < 0) {
						// Critical error: print to console (user will see in terminal output)
						const combinedOutput =
							[output, error].filter(Boolean).join('\n\n') || '(no output)';
						console.error(
							`[Hook Error] toolConfirmation Hook failed (exitCode ${exitCode}):\nCommand: ${command}\nOutput: ${combinedOutput}`,
						);
					}
				}
			})
			.catch((error: any) => {
				console.error('Failed to execute toolConfirmation hook:', error);
			});
	}, [command, sensitiveCheck.isSensitive]);

	// Calculate max command display width (leave space for padding and borders)
	const maxCommandWidth = Math.max(40, terminalWidth - 10);
	const displayCommand = truncateCommand(command, maxCommandWidth);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.error}
			paddingX={2}
			paddingY={0}
			width={terminalWidth - 2}
		>
			<Box>
				<Text bold color={theme.colors.error}>
					{t.bash.sensitiveCommandDetected}
				</Text>
			</Box>
			<Box paddingLeft={2}>
				<Text color={theme.colors.menuInfo}>{displayCommand}</Text>
			</Box>
			{sensitiveCheck.isSensitive && sensitiveCheck.matchedCommand && (
				<>
					<Box>
						<Text color={theme.colors.warning}>{t.bash.sensitivePattern} </Text>
						<Text dimColor>{sensitiveCheck.matchedCommand.pattern}</Text>
					</Box>
					<Box>
						<Text color={theme.colors.warning}>{t.bash.sensitiveReason} </Text>
						<Text dimColor>{sensitiveCheck.matchedCommand.description}</Text>
					</Box>
				</>
			)}
			<Box>
				<Text color={theme.colors.warning}>{t.bash.executeConfirm}</Text>
			</Box>
			<Box>
				<Text dimColor>{t.bash.confirmHint}</Text>
			</Box>
		</Box>
	);
}

interface BashCommandExecutionStatusProps {
	command: string;
	timeout?: number;
	terminalWidth: number;
}

export function BashCommandExecutionStatus({
	command,
	timeout = 30000,
	terminalWidth,
}: BashCommandExecutionStatusProps) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const timeoutSeconds = Math.round(timeout / 1000);

	// Calculate max command display width (leave space for padding and borders)
	const maxCommandWidth = Math.max(40, terminalWidth - 10);
	const displayCommand = truncateCommand(command, maxCommandWidth);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={2}
			paddingY={0}
			width={terminalWidth - 2}
		>
			<Box>
				<Text bold color={theme.colors.menuInfo}>
					<Spinner type="dots" /> {t.bash.executingCommand}
				</Text>
			</Box>
			<Box paddingLeft={2}>
				<Text dimColor>{displayCommand}</Text>
			</Box>
			<Box flexDirection="column" gap={0}>
				<Box>
					<Text dimColor>
						{t.bash.timeout} {timeoutSeconds}s{' '}
						{timeout > 60000 && (
							<Text color={theme.colors.warning}>{t.bash.customTimeout}</Text>
						)}
					</Text>
				</Box>
				<Box>
					<Text dimColor>{t.bash.backgroundHint}</Text>
				</Box>
			</Box>
		</Box>
	);
}
