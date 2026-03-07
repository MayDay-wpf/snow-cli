import React, {useEffect, useMemo, useRef, useState} from 'react';
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

function sanitizePreviewLine(text: string): string {
	return text
		.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
		.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
		.replace(/\t/g, ' ')
		.replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/g, '')
		.trim();
}

function truncateText(text: string, maxWidth: number = 80): string {
	const normalized = text.trim().replace(/\\t/g, '  ');
	if (normalized.length <= maxWidth) {
		return normalized;
	}
	return normalized.slice(0, maxWidth - 3) + '...';
}

const maxOutputLines = 5;
const maxStoredOutputLines = 200;
const maxLineLength = 500;

/**
 * Simple component for displaying custom command execution with real-time output
 */
export function CustomCommandExecutionDisplay({
	command,
	commandName,
	isRunning,
	output,
	exitCode,
	error,
}: CustomCommandExecutionDisplayProps) {
	const {theme} = useTheme();

	const [displayOutputLines, setDisplayOutputLines] = useState<string[]>([]);
	const totalCommittedLineCountRef = useRef(0);
	const lastSeenOutputLengthRef = useRef(0);
	const pendingLinesRef = useRef<string[]>([]);
	const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		lastSeenOutputLengthRef.current = 0;
		totalCommittedLineCountRef.current = 0;
		pendingLinesRef.current = [];
		setDisplayOutputLines([]);
	}, [command]);

	useEffect(() => {
		const prevLen = lastSeenOutputLengthRef.current;
		if (output.length <= prevLen) {
			return;
		}
		const newEntries = output.slice(prevLen);
		lastSeenOutputLengthRef.current = output.length;

		for (const entry of newEntries) {
			const lines = entry.split(/\r?\n/);
			for (const raw of lines) {
				const capped =
					raw.length > maxLineLength ? raw.slice(0, maxLineLength) : raw;
				const cleaned = sanitizePreviewLine(capped);
				if (cleaned.length > 0) {
					pendingLinesRef.current.push(cleaned);
				}
			}
		}

		if (pendingLinesRef.current.length > maxStoredOutputLines * 2) {
			pendingLinesRef.current = pendingLinesRef.current.slice(
				-maxStoredOutputLines,
			);
		}
	}, [output]);

	useEffect(() => {
		flushIntervalRef.current = setInterval(() => {
			if (pendingLinesRef.current.length === 0) {
				return;
			}
			const toCommit = pendingLinesRef.current.splice(
				0,
				pendingLinesRef.current.length,
			);
			totalCommittedLineCountRef.current += toCommit.length;
			setDisplayOutputLines(prev => {
				const next = [...prev, ...toCommit];
				return next.length > maxStoredOutputLines
					? next.slice(-maxStoredOutputLines)
					: next;
			});
		}, 200);

		return () => {
			if (flushIntervalRef.current) {
				clearInterval(flushIntervalRef.current);
			}
		};
	}, []);

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

		const result = [...rawProcessedOutput];
		while (result.length < maxOutputLines) {
			result.unshift('');
		}
		return result;
	}, [displayOutputLines]);

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

			<Box flexDirection="column" paddingLeft={2} height={maxOutputLines}>
				{processedOutput.map((line, index) => (
					<Text key={index} wrap="truncate" dimColor>
						{truncateText(line, 100)}
					</Text>
				))}
			</Box>

			{error && (
				<Box paddingLeft={2}>
					<Text color={theme.colors.error}>{error}</Text>
				</Box>
			)}

			{!isRunning && displayOutputLines.length === 0 && !error && (
				<Text dimColor>(no output)</Text>
			)}
		</Box>
	);
}

export default CustomCommandExecutionDisplay;
