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
function sanitizePreviewLine(text: string): string {
	// Remove ANSI/control sequences and normalize whitespace to keep preview rendering stable.
	// This preview is not meant to be an exact terminal emulator.
	const withoutOsc = text.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '');
	const withoutAnsi = withoutOsc.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
	const withoutControls = withoutAnsi.replace(
		/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
		'',
	);
	const withoutTabs = withoutControls.replace(/\t/g, ' ');
	return withoutTabs
		.replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/g, '')
		.trim();
}

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
	const maxCommandWidth = Math.max(40, terminalWidth - 20);
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
				<Text color={theme.colors.menuInfo} wrap="truncate">
					{displayCommand}
				</Text>
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
	output?: string[];
}

/**
 * Truncate text to prevent overflow
 * Strips leading/trailing whitespace and normalizes tabs to prevent render jitter
 */
function truncateText(text: string, maxWidth: number = 80): string {
	// Normalize: trim and replace tabs with spaces (tab width varies in terminals)
	const normalized = text.trim().replace(/\t/g, '  ');
	if (normalized.length <= maxWidth) {
		return normalized;
	}
	return normalized.slice(0, maxWidth - 3) + '...';
}

export function BashCommandExecutionStatus({
	command,
	timeout = 30000,
	terminalWidth,
	output = [],
}: BashCommandExecutionStatusProps) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const timeoutSeconds = Math.round(timeout / 1000);

	// Calculate max command display width (leave space for padding and borders)
	const maxCommandWidth = Math.max(40, terminalWidth - 20);
	const displayCommand = truncateCommand(command, maxCommandWidth);

	// Process output: split by newlines, trim per-line trailing whitespace, and clamp to a fixed-height window.
	// IMPORTANT: render a fixed number of rows with stable keys to avoid Ink diff jitter.
	const maxOutputLines = 5;
	const allOutputLines = output
		.flatMap(line => line.split(/\r?\n/))
		.map(line => sanitizePreviewLine(line))
		.filter(line => line.length > 0);

	const omittedCount = Math.max(0, allOutputLines.length - maxOutputLines);
	const visibleOutputLines =
		omittedCount > 0
			? allOutputLines.slice(-(maxOutputLines - 1))
			: allOutputLines.slice(-maxOutputLines);
	const rawProcessedOutput =
		omittedCount > 0
			? [...visibleOutputLines, `... (${omittedCount} lines omitted)`]
			: visibleOutputLines;

	const processedOutput = [...rawProcessedOutput];
	while (processedOutput.length < maxOutputLines) {
		processedOutput.unshift('');
	}

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box>
				<Text bold color={theme.colors.menuInfo}>
					<Spinner type="dots" /> {t.bash.executingCommand}
				</Text>
			</Box>
			<Box paddingLeft={2}>
				<Text dimColor wrap="truncate">
					{displayCommand}
				</Text>
			</Box>
			{/* Real-time output lines - fixed height to prevent layout jitter */}
			<Box
				flexDirection="column"
				paddingLeft={2}
				marginTop={1}
				height={maxOutputLines}
			>
				{processedOutput.map((line, index) => (
					<Text key={index} wrap="truncate" dimColor>
						{truncateText(sanitizePreviewLine(line), maxCommandWidth)}
					</Text>
				))}
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
