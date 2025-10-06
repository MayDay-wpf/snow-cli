import React from 'react';
import { Box, Text } from 'ink';
import * as Diff from 'diff';

interface Props {
	oldContent?: string;
	newContent: string;
	filename?: string;
	maxLines?: number;
}

export default function DiffViewer({
	oldContent = '',
	newContent,
	filename,
	maxLines = 100
}: Props) {
	// If no old content, show as new file creation
	const isNewFile = !oldContent || oldContent.trim() === '';

	if (isNewFile) {
		const lines = newContent.split('\n').slice(0, maxLines);
		const totalLines = newContent.split('\n').length;
		const lineNumberWidth = String(totalLines).length;

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color="green">
						[New File]
					</Text>
					{filename && (
						<Text color="cyan">
							{' '}
							{filename}
						</Text>
					)}
				</Box>
				<Box flexDirection="column">
					{lines.map((line, index) => (
						<Box key={index}>
							<Text color="gray" dimColor>
								{String(index + 1).padStart(lineNumberWidth, ' ')}{' '}
							</Text>
							<Text color="white" backgroundColor="green">
								+ {line}
							</Text>
						</Box>
					))}
					{totalLines > maxLines && (
						<Box marginTop={1}>
							<Text dimColor>
								... {totalLines - maxLines} more lines
							</Text>
						</Box>
					)}
				</Box>
			</Box>
		);
	}

	// Generate diff
	const diffResult = Diff.diffLines(oldContent, newContent);

	// Calculate line numbers
	let oldLineNum = 1;
	let newLineNum = 1;
	const totalOldLines = oldContent.split('\n').length;
	const totalNewLines = newContent.split('\n').length;
	const lineNumberWidth = Math.max(String(totalOldLines).length, String(totalNewLines).length);

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color="yellow">
					[File Modified]
				</Text>
				{filename && (
					<Text color="cyan">
						{' '}
						{filename}
					</Text>
				)}
			</Box>
			<Box flexDirection="column">
				{diffResult.slice(0, maxLines).map((part, index) => {
					const lines = part.value.replace(/\n$/, '').split('\n');

					return lines.map((line, lineIndex) => {
						if (part.added) {
							const currentLineNum = newLineNum++;
							return (
								<Box key={`${index}-${lineIndex}`}>
									<Text color="gray" dimColor>
										{' '.repeat(lineNumberWidth)}{' '}
									</Text>
									<Text color="gray" dimColor>
										{String(currentLineNum).padStart(lineNumberWidth, ' ')}{' '}
									</Text>
									<Text color="white" backgroundColor="green">
										+ {line}
									</Text>
								</Box>
							);
						}

						if (part.removed) {
							const currentLineNum = oldLineNum++;
							return (
								<Box key={`${index}-${lineIndex}`}>
									<Text color="gray" dimColor>
										{String(currentLineNum).padStart(lineNumberWidth, ' ')}{' '}
									</Text>
									<Text color="gray" dimColor>
										{' '.repeat(lineNumberWidth)}{' '}
									</Text>
									<Text color="white" backgroundColor="red">
										- {line}
									</Text>
								</Box>
							);
						}

						// Unchanged lines
						const currentOldLineNum = oldLineNum++;
						const currentNewLineNum = newLineNum++;
						return (
							<Box key={`${index}-${lineIndex}`}>
								<Text color="gray" dimColor>
									{String(currentOldLineNum).padStart(lineNumberWidth, ' ')}{' '}
								</Text>
								<Text color="gray" dimColor>
									{String(currentNewLineNum).padStart(lineNumberWidth, ' ')}{' '}
								</Text>
								<Text dimColor>
									  {line}
								</Text>
							</Box>
						);
					});
				}).flat()}
				{diffResult.length > maxLines && (
					<Box marginTop={1}>
						<Text dimColor>
							... {diffResult.length - maxLines} more lines
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
