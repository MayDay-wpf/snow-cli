import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/I18nContext.js';
import {isSensitiveCommand} from '../../../utils/execution/sensitiveCommandManager.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {unifiedHooksExecutor} from '../../../utils/execution/unifiedHooksExecutor.js';
import {sendTerminalInput} from '../../../hooks/execution/useTerminalExecutionState.js';

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
	// Optimized: combine multiple replace operations to reduce regex overhead
	return text
		.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
		.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
		.replace(/\t/g, ' ')
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
	needsInput?: boolean;
	inputPrompt?: string | null;
}

/**
 * Truncate text to prevent overflow
 * Strips leading/trailing whitespace and normalizes tabs to prevent render jitter
 */
function truncateText(text: string, maxWidth: number = 80): string {
	// Normalize: trim and replace tabs with spaces (tab width varies in terminals)
	const normalized = text.trim().replace(/\\t/g, '  ');
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
	needsInput = false,
	inputPrompt = null,
}: BashCommandExecutionStatusProps) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const timeoutSeconds = Math.round(timeout / 1000);
	const [inputValue, setInputValue] = useState('');

	// Calculate max command display width (leave space for padding and borders)
	const maxCommandWidth = Math.max(40, terminalWidth - 20);
	const displayCommand = truncateCommand(command, maxCommandWidth);

	const maxOutputLines = 5;

	// Batch output updates to reduce Ink re-render churn when the command streams output line-by-line.
	// We buffer incoming lines and only commit to rendered state in groups of 5, with a short
	// debounce flush for the final <5 lines so the UI doesn't "stick".
	const maxStoredOutputLines = 200;
	const [displayOutputLines, setDisplayOutputLines] = useState<string[]>([]);
	const totalCommittedLineCountRef = useRef(0);
	const lastSeenInputLineCountRef = useRef(0);
	const pendingLinesRef = useRef<string[]>([]);
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Reset buffers when command changes (avoid mixing outputs across commands).
	useEffect(() => {
		lastSeenInputLineCountRef.current = 0;
		totalCommittedLineCountRef.current = 0;
		pendingLinesRef.current = [];
		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		setDisplayOutputLines([]);
	}, [command]);

	useEffect(() => {
		const incomingLines = output
			.flatMap(line => line.split(/\r?\n/))
			.map(line => sanitizePreviewLine(line))
			.filter(line => line.length > 0);

		const prevCount = lastSeenInputLineCountRef.current;
		if (incomingLines.length <= prevCount) {
			return;
		}

		const newLines = incomingLines.slice(prevCount);
		lastSeenInputLineCountRef.current = incomingLines.length;
		pendingLinesRef.current.push(...newLines);

		// Commit full groups of 5 lines immediately.
		const fullBatchCount =
			pendingLinesRef.current.length - (pendingLinesRef.current.length % 5);
		if (fullBatchCount > 0) {
			const toCommit = pendingLinesRef.current.splice(0, fullBatchCount);
			totalCommittedLineCountRef.current += toCommit.length;
			setDisplayOutputLines(prev => {
				const next = [...prev, ...toCommit];
				return next.length > maxStoredOutputLines
					? next.slice(-maxStoredOutputLines)
					: next;
			});
		}

		// Debounce-flush any remainder (<5) so it still shows up when output pauses.
		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current);
		}
		flushTimerRef.current = setTimeout(() => {
			flushTimerRef.current = null;
			if (pendingLinesRef.current.length === 0) {
				return;
			}
			const remainder = pendingLinesRef.current.splice(
				0,
				pendingLinesRef.current.length,
			);
			totalCommittedLineCountRef.current += remainder.length;
			setDisplayOutputLines(prev => {
				const next = [...prev, ...remainder];
				return next.length > maxStoredOutputLines
					? next.slice(-maxStoredOutputLines)
					: next;
			});
		}, 150);
		// NOTE: No cleanup here - we intentionally keep the debounce timer running
		// across output updates. Cleanup is handled by the unmount effect below.
	}, [output]);

	// Cleanup timer only on component unmount
	useEffect(() => {
		return () => {
			if (flushTimerRef.current) {
				clearTimeout(flushTimerRef.current);
				flushTimerRef.current = null;
			}
		};
	}, []);

	// Use useMemo to cache processed output and avoid recalculation on every render
	const processedOutput = useMemo(() => {
		const omittedCount = Math.max(
			0,
			totalCommittedLineCountRef.current - maxOutputLines,
		);
		const visibleOutputLines =
			omittedCount > 0
				? displayOutputLines.slice(-(maxOutputLines - 1))
				: displayOutputLines.slice(-maxOutputLines);
		const rawProcessedOutput =
			omittedCount > 0
				? [...visibleOutputLines, `... (${omittedCount} lines omitted)`]
				: visibleOutputLines;

		const output = [...rawProcessedOutput];
		while (output.length < maxOutputLines) {
			output.unshift('');
		}
		return output;
	}, [displayOutputLines, maxOutputLines]);

	// Handle input submission
	const handleInputSubmit = (value: string) => {
		sendTerminalInput(value);
		setInputValue('');
	};

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
						{truncateText(line, maxCommandWidth)}
					</Text>
				))}
			</Box>
			{/* Interactive input area - shown when command needs input */}
			{needsInput && (
				<Box flexDirection="column" marginTop={1} paddingLeft={2}>
					<Box>
						<Text color={theme.colors.warning}>{t.bash.inputRequired}</Text>
					</Box>
					{inputPrompt && (
						<Box>
							<Text dimColor>{inputPrompt}</Text>
						</Box>
					)}
					<Box>
						<Text color={theme.colors.menuInfo}>&gt; </Text>
						<TextInput
							value={inputValue}
							onChange={setInputValue}
							onSubmit={handleInputSubmit}
							placeholder={t.bash.inputPlaceholder}
						/>
					</Box>
					<Box>
						<Text dimColor>{t.bash.inputHint}</Text>
					</Box>
				</Box>
			)}
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
